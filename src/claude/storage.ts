import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parseClaudeUsage} from '../core/normalize.js';
import {planName} from '../core/subscription.js';
import {ATTRIBUTES, NOFOLLOW, MAX_BYTES, privateDirectory, privateFile, noSymlinkDirectories, sameFile, missing, invalid, record, encode, writeNew} from './io.js';

export const MAX_SOURCES = 16;
export const MAX_ENTRIES = 64;
export const SNAPSHOT_NAME = /^s-([a-f0-9]{64})-([0-9]{16})-([a-f0-9-]{36})\.json$/;
export interface Projection { sourceId: string; payload: {rate_limits: Record<string, {used_percentage: number; resets_at?: number | null}>; subscription_type?: string}; }
export interface StoredSnapshot extends Projection { version: 1; order: number; receivedAt: number; }
export function projectPayload(input: unknown, planType: unknown = null): Projection {
    const raw = record(input);
    if (typeof raw.session_id !== 'string' || !raw.session_id.trim() || encode(raw.session_id).length > 512) throw invalid();
    const sourceId = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, raw.session_id, -1)!;
    const rates = raw.rate_limits == null ? {} : record(raw.rate_limits);
    const payload: Projection['payload'] = {rate_limits: {}};
    // Internal metadata supplied by the bounded CLI probe only. Raw statusline
    // subscription_type and model fields are deliberately never copied.
    const name = planName('claude', planType);
    if (name) payload.subscription_type = name.toLowerCase();
    for (const name of ['five_hour', 'seven_day']) {
        if (!(name in rates) || rates[name] === null) continue;
        const quota = record(rates[name]);
        if (typeof quota.used_percentage !== 'number' || !Number.isFinite(quota.used_percentage) || quota.used_percentage < 0 || quota.used_percentage > 100) throw invalid();
        const projected: {used_percentage: number; resets_at?: number | null} = {used_percentage: quota.used_percentage};
        if (quota.resets_at !== undefined) {
            if (quota.resets_at !== null && (typeof quota.resets_at !== 'number' || !Number.isSafeInteger(quota.resets_at) || quota.resets_at < 0)) throw invalid();
            projected.resets_at = quota.resets_at as number | null;
        }
        payload.rate_limits[name] = projected;
    }
    parseClaudeUsage(payload, sourceId, Date.now());
    return {sourceId, payload};
}
export function runtimeDirectory(create = true): Gio.File {
    const path = GLib.getenv('XDG_RUNTIME_DIR');
    if (!path) throw invalid();
    const runtime = noSymlinkDirectories(path);
    privateDirectory(runtime);
    const directory = runtime.get_child('usagescope-gnome');
    if (create) {
        try { privateDirectory(directory); } catch (error) {
            if (!missing(error)) throw error;
            // A racing creator is accepted only after the same ownership/mode checks.
            GLib.mkdir(directory.get_path()!, 0o700);
        }
    }
    privateDirectory(directory);
    return directory;
}
interface Entry { name: string; sourceId: string; order: number; }
function entries(directory: Gio.File): Entry[] {
    const iterator = directory.enumerate_children(`standard::name,${ATTRIBUTES}`, NOFOLLOW, null);
    const list: Entry[] = [];
    let count = 0;
    try {
        let info;
        while ((info = iterator.next_file(null))) {
            if (++count > MAX_ENTRIES) throw invalid();
            const match = SNAPSHOT_NAME.exec(info.get_name());
            if (!match) continue;
            privateFile(info);
            list.push({name: info.get_name(), sourceId: match[1]!, order: Number(match[2])});
        }
    } finally { iterator.close(null); }
    return list;
}
export async function storeSnapshot(projection: Projection, order: number, receivedAt: number): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(projection.sourceId) || !Number.isSafeInteger(order) || order <= 0 || !Number.isSafeInteger(receivedAt) || receivedAt < 0) throw invalid();
    parseClaudeUsage(projection.payload, projection.sourceId, receivedAt);
    const directory = runtimeDirectory();
    const identity = privateDirectory(directory);
    let temporary: Gio.File | null = null;
    let committed: Gio.File | null = null;
    try {
        sameFile(identity, privateDirectory(directory));
        const existing = entries(directory);
        const sources = new Set(existing.map(entry => entry.sourceId));
        if (!sources.has(projection.sourceId) && sources.size >= MAX_SOURCES) throw invalid();
        const name = `s-${projection.sourceId}-${String(order).padStart(16, '0')}-${GLib.uuid_string_random()}.json`;
        if (!SNAPSHOT_NAME.test(name)) throw invalid();
        const envelope: StoredSnapshot = {version: 1, order, receivedAt, sourceId: projection.sourceId, payload: projection.payload};
        const bytes = encode(JSON.stringify(envelope));
        if (bytes.length > MAX_BYTES) throw invalid();
        temporary = directory.get_child(`.pending-${GLib.uuid_string_random()}`);
        writeNew(temporary, bytes);
        sameFile(identity, privateDirectory(directory));
        // Both paths share a private directory; a unique final name is never rewritten.
        const final = directory.get_child(name);
        temporary.move(final, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS, null, null);
        committed = final;
        temporary = null;
        const after = entries(directory);
        if (new Set(after.map(entry => entry.sourceId)).size > MAX_SOURCES) throw invalid();
        const retained = after.filter(entry => entry.sourceId === projection.sourceId)
            .sort((a, b) => b.order - a.order || b.name.localeCompare(a.name));
        for (const entry of retained.slice(2)) {
            const old = directory.get_child(entry.name);
            try {
                privateFile(old.query_info(ATTRIBUTES, NOFOLLOW, null));
                old.delete(null);
            } catch (error) { if (!missing(error)) throw error; }
        }
        sameFile(identity, privateDirectory(directory));
        committed = null;
    } catch (error) {
        // Post-publication inventory or retention may fail under contention.
        // Withdraw only this invocation's immutable commit, without scanning
        // an overfull directory or disturbing other sources/caches.
        if (committed) {
            sameFile(identity, privateDirectory(directory));
            try { committed.delete(null); } catch (problem) { if (!missing(problem)) throw problem; }
        }
        throw error;
    } finally {
        if (temporary) { try { temporary.delete(null); } catch { /* no raw errors */ } }
    }
}
