import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix?version=2.0';
import GLib from 'gi://GLib';
import System from 'system';
import {decode, executable, invalid, readBounded} from './io.js';
import {projectPayload, storeSnapshot} from './storage.js';

const HELP = `UsageScope Claude statusline bridge\nUsage: gjs -m build/claude/bridge.js [--renderer /absolute/executable]\nReads at most 256 KiB of statusline JSON from stdin. Stores quota fields only\nin owned 0700 $XDG_RUNTIME_DIR/usagescope-gnome; files are private 0600.\nSession IDs are hashed. Two immutable snapshots per source, at most 16 sources.\nInvocation ordering uses monotonic time captured before reading stdin.\nA renderer receives the original bounded input as argv-spawned executable,\nwithout shell evaluation. Its stdout is preserved byte for byte (256 KiB max).\nExport failures are nonfatal to the renderer. Input/renderer deadline: 5 seconds.\nExplicit setup: gjs -m build/claude/setup.js --preview | --apply | --restore\nWriters use unique immutable files without persistent locks. Runtime data\nnever survives logout.\n`;
function writeInput(stream: Gio.OutputStream, bytes: Uint8Array, cancel: Gio.Cancellable): Promise<void> {
    return new Promise((resolve, reject) => stream.write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancel, (_s, result) => {
        try { stream.write_all_finish(result!); stream.close(null); resolve(); } catch (error) { reject(error); }
    }));
}
async function render(path: string, bytes: Uint8Array): Promise<void> {
    const resolved = executable(path);
    const child = Gio.Subprocess.new([resolved], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    const cancel = new Gio.Cancellable();
    let timedOut = false;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => { timedOut = true; cancel.cancel(); child.force_exit(); return GLib.SOURCE_REMOVE; });
    try {
        const output = readBounded(child.get_stdout_pipe()!, cancel);
        const sent = writeInput(child.get_stdin_pipe()!, bytes, cancel);
        const exited = new Promise<void>((resolve, reject) => child.wait_async(cancel, (_c, result) => {
            try { child.wait_finish(result!); if (!child.get_successful()) throw invalid(); resolve(); } catch (error) { reject(error); }
        }));
        const results = await Promise.all([output, sent, exited]);
        const stdout = new GioUnix.OutputStream({fd: 1, close_fd: false});
        stdout.write_all(results[0], null);
    } catch {
        child.force_exit();
        cancel.cancel();
        throw invalid();
    } finally {
        if (!timedOut) GLib.source_remove(timer);
        try { child.get_stdout_pipe()!.close(null); } catch { /* no raw errors */ }
        try { child.get_stdin_pipe()!.close(null); } catch { /* no raw errors */ }
    }
}
export async function runBridge(renderer: string | null = null): Promise<number> {
    const order = GLib.get_monotonic_time();
    const cancel = new Gio.Cancellable();
    let timedOut = false;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => { timedOut = true; cancel.cancel(); return GLib.SOURCE_REMOVE; });
    let bytes: Uint8Array;
    try { bytes = await readBounded(new GioUnix.InputStream({fd: 0, close_fd: false}), cancel); }
    catch { printerr('Claude bridge input is invalid or unavailable.'); return 1; }
    finally { if (!timedOut) GLib.source_remove(timer); }
    const receivedAt = Date.now();
    const exported = (async () => { await storeSnapshot(projectPayload(JSON.parse(decode(bytes))), order, receivedAt); })();
    if (renderer) {
        const [display] = await Promise.allSettled([render(renderer, bytes), exported]);
        if (display.status === 'rejected') { printerr('Claude renderer failed or exceeded its bounds.'); return 1; }
        return 0;
    }
    try { await exported; return 0; }
    catch { printerr('Claude quota export unavailable; check input and private runtime storage.'); return 1; }
}
async function main(args: string[]): Promise<number> {
    if (args.length === 1 && args[0] === '--help') { print(HELP); return 0; }
    if (args.length === 0) return runBridge();
    if (args.length === 2 && args[0] === '--renderer' && GLib.path_is_absolute(args[1]!)) return runBridge(args[1]);
    printerr('Usage: gjs -m bridge.js [--help | --renderer /absolute/executable]');
    return 1;
}
if (System.programPath && Gio.File.new_for_path(System.programPath).get_uri() === import.meta.url) {
    let status = 1;
    try { status = await main(System.programArgs); } catch { printerr('Claude bridge unavailable.'); }
    System.exit(status);
}
