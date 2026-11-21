import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type {ProviderController, ProviderView, Publish, UsageSnapshot} from '../core/types.js';
import {parseClaudeUsage} from '../core/normalize.js';
import {ATTRIBUTES, NOFOLLOW, decode, invalid, missing, privateDirectory, readPrivate, record, sameFile} from './io.js';
import {MAX_ENTRIES, MAX_SOURCES, SNAPSHOT_NAME, runtimeDirectory} from './storage.js';

export interface ClaudeOptions { publish: Publish; sourceId?: string; }
interface Candidate { name: string; sourceId: string; order: number; }
interface Good { snapshot: UsageSnapshot; order: number; name: string; }
const SETUP = 'Claude setup: run gjs -m build/claude/setup.js --preview, then --apply explicitly. Sign in to Claude Code in your terminal. Usage arrives only when Claude Code invokes its statusline.';

export class ClaudeController implements ProviderController {
    private readonly publish: Publish;
    private running = false;
    private generation = 0;
    private cancel: Gio.Cancellable | null = null;
    private monitor: Gio.FileMonitor | null = null;
    private monitorSignal = 0;
    private scheduled = 0;
    private sources: string[] = [];
    private explicit: string | null;
    private selected: string | null = null;
    private good = new Map<string, Good>();

    constructor(options: ClaudeOptions) {
        this.publish = options.publish;
        this.explicit = options.sourceId ?? null;
        if (this.explicit !== null && !/^[a-f0-9]{64}$/.test(this.explicit)) throw invalid();
    }
    start(): void {
        if (this.running) return;
        this.running = true;
        void this.refresh();
    }
    listSources(): string[] { return [...this.sources]; }
    async selectSource(sourceId: string | null): Promise<void> {
        if (sourceId !== null && !/^[a-f0-9]{64}$/.test(sourceId)) throw invalid();
        this.explicit = sourceId;
        this.selected = null;
        await this.refresh();
    }
    private current(): UsageSnapshot | null {
        return this.selected ? this.good.get(this.selected)?.snapshot ?? null : null;
    }
    private emit(view: ProviderView, generation = this.generation): void {
        if (this.running && generation === this.generation) this.publish(view);
    }
    private watch(directory: Gio.File): void {
        if (this.monitor) return;
        this.monitor = directory.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this.monitorSignal = this.monitor.connect('changed', (_m, file, other) => {
            const name = file?.get_basename() ?? '';
            const otherName = other?.get_basename() ?? '';
            if (!this.running || (!SNAPSHOT_NAME.test(name) && !SNAPSHOT_NAME.test(otherName))) return;
            if (this.scheduled) return;
            this.scheduled = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
                this.scheduled = 0;
                void this.refresh();
                return GLib.SOURCE_REMOVE;
            });
        });
    }
    private async scan(directory: Gio.File, cancel: Gio.Cancellable): Promise<Candidate[]> {
        const iterator = await new Promise<Gio.FileEnumerator>((resolve, reject) => directory.enumerate_children_async(
            `standard::name,${ATTRIBUTES}`, NOFOLLOW, GLib.PRIORITY_DEFAULT, cancel, (_f, result) => {
                try { resolve(directory.enumerate_children_finish(result!)); } catch (error) { reject(error); }
            }));
        const found: Candidate[] = [];
        let count = 0;
        try {
            for (;;) {
                const batch = await new Promise<Gio.FileInfo[]>((resolve, reject) => iterator.next_files_async(16, GLib.PRIORITY_DEFAULT, cancel, (_it, result) => {
                    try { resolve(iterator.next_files_finish(result!)); } catch (error) { reject(error); }
                }));
                if (!batch.length) break;
                for (const info of batch) {
                    if (++count > MAX_ENTRIES) throw invalid();
                    const name = info.get_name();
                    const match = SNAPSHOT_NAME.exec(name);
                    if (!match) continue;
                    // The entry is still listed on malformed metadata, so it cannot silently
                    // disappear and cause an unrelated session to be selected automatically.
                    found.push({name, sourceId: match[1]!, order: Number(match[2])});
                }
            }
        } finally { iterator.close(null); }
        if (found.length > MAX_SOURCES * 2 + 1 || new Set(found.map(entry => entry.sourceId)).size > MAX_SOURCES) throw invalid();
        return found.sort((a, b) => b.order - a.order || b.name.localeCompare(a.name));
    }
    async refresh(): Promise<void> {
        if (!this.running) return;
        const generation = ++this.generation;
        this.cancel?.cancel();
        const cancel = new Gio.Cancellable();
        this.cancel = cancel;
        let timedOut = false;
        const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => { timedOut = true; cancel.cancel(); return GLib.SOURCE_REMOVE; });
        const active = (): boolean => this.running && generation === this.generation && !cancel.is_cancelled();
        try {
            const directory = runtimeDirectory();
            const identity = privateDirectory(directory);
            this.watch(directory); // Install before the first asynchronous enumeration.
            const candidates = await this.scan(directory, cancel);
            if (!active()) return;
            sameFile(identity, privateDirectory(directory));
            this.sources = [...new Set(candidates.map(entry => entry.sourceId))].sort();
            const source = this.explicit ?? (this.sources.length === 1 ? this.sources[0]! : null);
            this.selected = source && this.sources.includes(source) ? source : null;
            if (!this.selected) {
                this.emit({status: 'waiting', snapshot: null, message: this.sources.length > 1 ? 'Multiple Claude sessions found. Select a source explicitly.' : 'Waiting for Claude statusline quota data. Use Claude setup to connect.'}, generation);
                return;
            }
            let malformed = false;
            let newest = true;
            for (const candidate of candidates.filter(entry => entry.sourceId === this.selected)) {
                if (!active()) return;
                try {
                    const file = directory.get_child(candidate.name);
                    const value = record(JSON.parse(decode(await readPrivate(file, cancel))));
                    if (!active()) return;
                    if (value.version !== 1 || value.sourceId !== candidate.sourceId || value.order !== candidate.order ||
                        !Number.isSafeInteger(value.order) || candidate.order <= 0 ||
                        typeof value.receivedAt !== 'number' || !Number.isSafeInteger(value.receivedAt) || value.receivedAt < 0 ||
                        value.receivedAt > Date.now() + 5000) throw invalid();
                    const snapshot = parseClaudeUsage(value.payload, candidate.sourceId, value.receivedAt);
                    // Identity stays local to the session hash, never a payload account field.
                    snapshot.accountId = null;
                    const prior = this.good.get(candidate.sourceId);
                    if (!prior || candidate.order > prior.order || (candidate.order === prior.order && candidate.name > prior.name)) {
                        this.good.set(candidate.sourceId, {snapshot, order: candidate.order, name: candidate.name});
                    }
                    break;
                } catch (error) {
                    if (!active()) return;
                    if (!missing(error) && newest) malformed = true;
                }
                newest = false;
            }
            sameFile(identity, privateDirectory(directory));
            if (!active()) return;
            // Remove retired sources from memory as well as the current view.
            for (const key of this.good.keys()) if (!this.sources.includes(key)) this.good.delete(key);
            const snapshot = this.current();
            this.emit({status: malformed || !snapshot ? 'error' : 'ready', snapshot,
                message: malformed || !snapshot ? 'Claude quota data is invalid or unavailable. Last valid receipt is retained when available.' : 'Claude statusline quota receipt; updates only when Claude Code invokes its statusline.'}, generation);
        } catch {
            this.emit({status: 'error', snapshot: this.current(), message: 'Claude quota storage is unavailable. Check private XDG_RUNTIME_DIR storage and setup.'}, generation);
        } finally {
            if (!timedOut) GLib.source_remove(timeout);
            if (this.cancel === cancel) this.cancel = null;
        }
    }
    async connect(): Promise<void> {
        this.emit({status: this.current() ? 'ready' : 'waiting', snapshot: this.current(), message: SETUP});
    }
    stop(): void {
        this.running = false;
        this.generation++;
        this.cancel?.cancel(); this.cancel = null;
        if (this.scheduled) { GLib.source_remove(this.scheduled); this.scheduled = 0; }
        if (this.monitorSignal && this.monitor) this.monitor.disconnect(this.monitorSignal);
        this.monitor?.cancel(); this.monitor = null; this.monitorSignal = 0;
        this.sources = []; this.selected = null; this.good.clear();
    }
}
