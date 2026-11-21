import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {planName} from '../core/subscription.js';
import {ATTRIBUTES, NOFOLLOW, decode, encode, executable, invalid, missing, privateDirectory, privateFile, readBounded, readPrivate, record, sameFile, writeNew} from './io.js';
import {runtimeDirectory} from './storage.js';

const TTL_MS = 300_000;
const CACHE_NAME = /^p-[a-f0-9]{64}\.json$/;
const hash = (value: string): string => GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, value, -1)!;
interface Cache { version: 1; checkedAt: number; planType: string | null; executableId: string; }

function profileId(): string {
    const path = GLib.getenv('CLAUDE_CONFIG_DIR') ?? GLib.build_filenamev([GLib.get_home_dir(), '.claude']);
    if (!path || !GLib.path_is_absolute(path)) throw invalid();
    // Hash the exact environment value: lexical normalization of '..' through a
    // symlink could merge different profiles. Never open configuration/credentials.
    return hash(path);
}

async function probe(path: string): Promise<string | null> {
    const child = Gio.Subprocess.new([path, 'auth', 'status', '--json'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    const cancel = new Gio.Cancellable();
    let timedOut = false;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
        timedOut = true; cancel.cancel(); child.force_exit(); return GLib.SOURCE_REMOVE;
    });
    const exited = new Promise<void>((resolve, reject) => child.wait_async(null, (_child, result) => {
        try { child.wait_finish(result!); if (!child.get_successful()) throw invalid(); resolve(); } catch (error) { reject(error); }
    }));
    try {
        const [bytes] = await Promise.all([readBounded(child.get_stdout_pipe()!, cancel, 64 * 1024), exited]);
        if (timedOut) return null;
        const value = record(JSON.parse(decode(bytes)));
        // Only this field leaves the probe. No email/org/auth method/raw output is stored.
        return planName('claude', value.subscriptionType)?.toLowerCase() ?? null;
    } catch {
        child.force_exit(); cancel.cancel(); await exited.catch(() => {});
        return null;
    } finally {
        if (!timedOut) GLib.source_remove(timer);
        try { child.get_stdout_pipe()!.close(null); } catch { /* no raw output/errors */ }
    }
}

function cacheInventoryAllowed(directory: Gio.File, adding: boolean): boolean {
    const iterator = directory.enumerate_children('standard::name', NOFOLLOW, null);
    let total = 0, caches = 0;
    try {
        let info;
        while ((info = iterator.next_file(null))) {
            if (++total > 64 - (adding ? 1 : 0)) return false;
            if (CACHE_NAME.test(info.get_name()) && ++caches > 16 - (adding ? 1 : 0)) return false;
        }
        return true;
    } finally { iterator.close(null); }
}

/** Best-effort profile-scoped tier; null never prevents the independent quota export.
 * The caller must explicitly supply a trusted CLI. No PATH lookup or account probe
 * occurs for legacy bridges. Inherit the emitting process environment unchanged.
 */
export async function readSubscriptionPlan(claudeExecutable: string | null): Promise<string | null> {
    if (claudeExecutable === null) return null;
    let temporary: Gio.File | null = null;
    try {
        // Validate again before cache hits as well as before spawning.
        const path = executable(claudeExecutable);
        const executableId = hash(path);
        const directory = runtimeDirectory();
        const identity = privateDirectory(directory);
        const file = directory.get_child(`p-${profileId()}.json`);
        const cancel = new Gio.Cancellable();
        let exists = false;
        let cached: Cache | null = null;
        try {
            const bytes = await readPrivate(file, cancel);
            exists = true;
            if (bytes.length <= 1024) {
                try {
                    const value = record(JSON.parse(decode(bytes)));
                    if (value.version === 1 && value.executableId === executableId && typeof value.checkedAt === 'number' &&
                        Number.isSafeInteger(value.checkedAt) && value.checkedAt > 0 && value.checkedAt <= Date.now() &&
                        (value.planType === null || (typeof value.planType === 'string' && planName('claude', value.planType)?.toLowerCase() === value.planType))) {
                        cached = value as unknown as Cache;
                    }
                } catch { /* malformed cache is a miss, never an arbitrary tier */ }
            }
        } catch (error) { if (!missing(error)) throw error; }
        sameFile(identity, privateDirectory(directory));
        if (cached && Date.now() - cached.checkedAt < TTL_MS) return cached.planType;
        if (!cacheInventoryAllowed(directory, !exists)) return null;
        const planType = await probe(path);
        const cache: Cache = {version: 1, checkedAt: Date.now(), planType, executableId};
        sameFile(identity, privateDirectory(directory));
        // Refuse a substituted symlink/permissive target; publication itself is atomic.
        try { privateFile(file.query_info(ATTRIBUTES, NOFOLLOW, null)); } catch (error) { if (!missing(error)) throw error; }
        temporary = directory.get_child(`.pending-plan-${GLib.uuid_string_random()}`);
        writeNew(temporary, encode(JSON.stringify(cache)));
        sameFile(identity, privateDirectory(directory));
        temporary.move(file, Gio.FileCopyFlags.OVERWRITE | Gio.FileCopyFlags.NOFOLLOW_SYMLINKS, null, null);
        temporary = null;
        // Concurrent profile writers may all have observed room before probing.
        // Withdraw only this profile's cache if publication exceeded the bound.
        if (!cacheInventoryAllowed(directory, false)) { file.delete(null); return null; }
        return planType;
    } catch { return null; }
    finally { if (temporary) { try { temporary.delete(null); } catch { /* no raw errors */ } } }
}
