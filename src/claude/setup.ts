import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {ATTRIBUTES, NOFOLLOW, MAX_BYTES, decode, encode, executable, invalid, missing, noSymlinkDirectories, privateDirectory, readBounded, readPrivate, record, sameFile, uid, writeNew} from './io.js';

const TRANSACTION = '.usagescope-setup';
const WRAPPER = 'statusline';
const RECOVERY_PREFIX = '.usagescope-recovery-';
const MAX_RECOVERIES = 16;
const ATOMIC_MOVE = Gio.FileCopyFlags.NOFOLLOW_SYMLINKS | Gio.FileCopyFlags.NO_FALLBACK_FOR_MOVE;
const MANUAL = 'Existing Claude statusline is unsupported. No settings changed. For manual integration, preserve your renderer yourself and feed the same JSON to the bridge; never replace an arbitrary shell command automatically.';
const HELP = `Usage: gjs -m build/claude/setup.js --preview | --apply | --restore\nOptional with preview/apply: --renderer /absolute/executable --claude /absolute/executable\nSettings: $CLAUDE_CONFIG_DIR/settings.json (default ~/.claude/settings.json).\nPreview is read-only. Apply creates private .usagescope-setup in that directory,\nwith exact original.json backup, manifest.json, and a GJS statusline wrapper.\nOnly an absent statusline or an exact single absolute executable command is\nautomatically supported. --renderer must match that existing command exactly.\nThe wrapper spawns the renderer using argv, without a shell or eval.\nApply discovers and validates claude on PATH when --claude is absent, storing\nits canonical path. Setup never runs Claude. The bridge may read only its\nauth status --json subscriptionType, cached per config directory for 300s.\nIf Claude is absent, the wrapper exports quotas without subscription metadata.\nRestore refuses concurrent edits and restores original settings bytes and mode,\nor removes settings.json if it did not exist before apply. Restore retains\ncaptured settings (including late writes through open descriptors) and, on\nsuccess, the old transaction in a private .usagescope-recovery-* directory.\nConflicts preserve live wrappers and never overwrite concurrent settings.\nAt most 16 recovery archives are allowed; inspect/preserve them manually\nbefore reaching the cap. All changes occur only when you explicitly run apply\nor restore; neither is performed by the GNOME extension.\n`;
interface Original { bytes: Uint8Array | null; mode: number; etag: string | null; identity: string | null; }
interface Manifest { version: 1; originalExists: boolean; originalHash: string | null; originalMode: number; installedHash: string; wrapperHash: string; }
const hash = (bytes: Uint8Array): string => {
    const checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);
    checksum.update(bytes); return checksum.get_string()!;
};
function configPath(): string {
    const override = GLib.getenv('CLAUDE_CONFIG_DIR');
    const path = override ?? GLib.build_filenamev([GLib.get_home_dir(), '.claude']);
    if (!path || !GLib.path_is_absolute(path) || path !== GLib.canonicalize_filename(path, null)) throw invalid();
    return path;
}
function configDirectory(create: boolean): Gio.File | null {
    const path = configPath();
    let directory: Gio.File;
    try { directory = noSymlinkDirectories(path); }
    catch (error) {
        if (!missing(error)) throw error;
        if (!create) return null;
        let part = Gio.File.new_for_path('/');
        for (const name of path.split('/').filter(Boolean)) {
            part = part.get_child(name);
            try { noSymlinkDirectories(part.get_path()!); }
            catch (problem) {
                if (!missing(problem)) throw problem;
                if (GLib.mkdir(part.get_path()!, 0o700) !== 0) throw invalid();
                noSymlinkDirectories(part.get_path()!);
            }
        }
        directory = noSymlinkDirectories(path);
    }
    const info = directory.query_info(ATTRIBUTES, NOFOLLOW, null);
    if (info.get_attribute_uint32('unix::uid') !== uid() || (info.get_attribute_uint32('unix::mode') & 0o022) !== 0) throw invalid();
    return directory;
}
async function readOriginal(file: Gio.File): Promise<Original> {
    let info: Gio.FileInfo;
    try { info = file.query_info(`${ATTRIBUTES},etag::value`, NOFOLLOW, null); }
    catch (error) { if (missing(error)) return {bytes: null, mode: 0o600, etag: null, identity: null}; throw error; }
    const mode = info.get_attribute_uint32('unix::mode') & 0o7777;
    if (info.get_file_type() !== Gio.FileType.REGULAR ||
        (info.has_attribute('standard::is-symlink') && info.get_is_symlink()) ||
        info.get_attribute_uint32('unix::uid') !== uid() || info.get_attribute_uint32('unix::nlink') !== 1 ||
        (mode & 0o7022) !== 0 || info.get_size() > MAX_BYTES) throw invalid();
    const cancel = new Gio.Cancellable();
    const stream = file.read(cancel);
    try {
        sameFile(info, stream.query_info(ATTRIBUTES, cancel));
        const bytes = await readBounded(stream, cancel);
        const after = file.query_info(`${ATTRIBUTES},etag::value`, NOFOLLOW, cancel);
        sameFile(info, after);
        if (info.get_attribute_string('etag::value') !== after.get_attribute_string('etag::value')) throw invalid();
        return {bytes, mode, etag: info.get_attribute_string('etag::value'), identity: info.get_attribute_string('id::file')};
    } finally { stream.close(null); }
}
function rendererFor(settings: Record<string, unknown>, requested: string | null): string | null {
    if (settings.statusLine == null) {
        if (requested !== null) throw new Error(MANUAL);
        return null;
    }
    let status: Record<string, unknown>;
    try { status = record(settings.statusLine); } catch { throw new Error(MANUAL); }
    if (status.type !== 'command' || typeof status.command !== 'string') throw new Error(MANUAL);
    const command = status.command;
    if (!/^\/[A-Za-z0-9_./:@%+,=-]+$/.test(command) || (requested !== null && requested !== command)) throw new Error(MANUAL);
    try { executable(command); } catch { throw new Error(MANUAL); }
    return command;
}
function shellQuote(path: string): string { return `'${path.split("'").join("'\\''")}'`; }
function cleanup(transaction: Gio.File): void {
    privateDirectory(transaction);
    const iterator = transaction.enumerate_children('standard::name', NOFOLLOW, null);
    const names: string[] = [];
    try { let info; while ((info = iterator.next_file(null))) { if (names.length >= 4) throw invalid(); names.push(info.get_name()); } }
    finally { iterator.close(null); }
    if (names.some(name => !['original.json', 'manifest.json', WRAPPER].includes(name))) throw invalid();
    for (const name of names) transaction.get_child(name).delete(null);
    transaction.delete(null);
}
async function unchanged(file: Gio.File, before: Original): Promise<void> {
    const current = await readOriginal(file);
    if (!sameOriginal(before, current)) throw invalid();
}
function sameOriginal(before: Original, after: Original): boolean {
    if (before.bytes === null || after.bytes === null) return before.bytes === after.bytes;
    return before.identity === after.identity && before.etag === after.etag && before.mode === after.mode && hash(before.bytes) === hash(after.bytes);
}
function publishExclusive(file: Gio.File, bytes: Uint8Array, mode = 0o600): void {
    const temporary = file.get_parent()!.get_child(`.usagescope-settings-${GLib.uuid_string_random()}`);
    try {
        writeNew(temporary, bytes);
        if (GLib.chmod(temporary.get_path()!, mode) !== 0) throw invalid();
        // No OVERWRITE and no copy/delete fallback: never replace a file that
        // appeared while the captured settings were being validated.
        temporary.move(file, ATOMIC_MOVE, null, null);
    } finally { try { temporary.delete(null); } catch { /* may already have moved */ } }
}
function replace(file: Gio.File, bytes: Uint8Array, original: Original): void {
    if (original.bytes === null) {
        publishExclusive(file, bytes);
    } else {
        // GIO replaces in the same directory and checks the observed version.
        file.replace_contents(bytes, original.etag, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }
}
function recoveryCount(directory: Gio.File): number {
    const iterator = directory.enumerate_children('standard::name', NOFOLLOW, null);
    let entries = 0, count = 0;
    try {
        let info;
        while ((info = iterator.next_file(null))) {
            if (++entries > 256) throw invalid();
            if (!info.get_name().startsWith(RECOVERY_PREFIX)) continue;
            privateDirectory(directory.get_child(info.get_name()));
            if (++count > MAX_RECOVERIES) throw invalid();
        }
    } finally { iterator.close(null); }
    return count;
}
function newRecovery(directory: Gio.File): Gio.File {
    if (recoveryCount(directory) >= MAX_RECOVERIES) throw invalid();
    const recovery = directory.get_child(`${RECOVERY_PREFIX}${GLib.uuid_string_random()}`);
    if (GLib.mkdir(recovery.get_path()!, 0o700) !== 0) throw invalid();
    try {
        privateDirectory(recovery);
        // Withdraw only this empty reservation if concurrent restores exceed
        // the cap; no settings or transaction has been moved yet.
        recoveryCount(directory);
        return recovery;
    } catch (error) {
        try { recovery.delete(null); } catch { /* only our empty reservation */ }
        throw error;
    }
}
function requireAbsent(file: Gio.File): void {
    try { file.query_info(ATTRIBUTES, NOFOLLOW, null); }
    catch (error) { if (missing(error)) return; throw error; }
    throw invalid();
}
async function restore(directory: Gio.File): Promise<string> {
    const transaction = directory.get_child(TRANSACTION);
    const transactionIdentity = privateDirectory(transaction);
    const directoryIdentity = directory.query_info(ATTRIBUTES, NOFOLLOW, null);
    const cancel = new Gio.Cancellable();
    const manifest = record(JSON.parse(decode(await readPrivate(transaction.get_child('manifest.json'), cancel))));
    if (manifest.version !== 1 || typeof manifest.originalExists !== 'boolean' || typeof manifest.originalMode !== 'number' ||
        !Number.isInteger(manifest.originalMode) || (manifest.originalMode & 0o7022) !== 0 || manifest.originalMode < 0 || manifest.originalMode > 0o777 ||
        typeof manifest.installedHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.installedHash) ||
        typeof manifest.wrapperHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.wrapperHash) ||
        (manifest.originalExists && (typeof manifest.originalHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.originalHash)))) throw invalid();
    if (hash(await readPrivate(transaction.get_child(WRAPPER), cancel, 0o700)) !== manifest.wrapperHash) throw invalid();
    const settings = directory.get_child('settings.json');
    const current = await readOriginal(settings);
    const original = manifest.originalExists ? await readPrivate(transaction.get_child('original.json'), cancel) : null;
    if (original && hash(original) !== manifest.originalHash) throw invalid();
    // A prepared transaction can be restored after an interrupted apply before publication.
    const beforePublication = original === null ? current.bytes === null : current.bytes !== null && hash(current.bytes) === manifest.originalHash;
    if (!beforePublication && (!current.bytes || hash(current.bytes) !== manifest.installedHash)) throw invalid();
    const recovery = newRecovery(directory);
    const captured = recovery.get_child('settings.json');
    const archivedTransaction = recovery.get_child(TRANSACTION);
    let transactionMoved = false;
    try {
        noSymlinkDirectories(directory.get_path()!);
        sameFile(directoryIdentity, directory.query_info(ATTRIBUTES, NOFOLLOW, null));
        sameFile(transactionIdentity, privateDirectory(transaction));
        // Rename first and validate the captured version. Retain this inode:
        // an editor can still write through an FD after our final check.
        try { settings.move(captured, ATOMIC_MOVE, null, null); }
        catch (error) { if (!missing(error) || current.bytes !== null) throw error; }
        if (!sameOriginal(current, await readOriginal(captured))) throw invalid();
        noSymlinkDirectories(directory.get_path()!);
        sameFile(directoryIdentity, directory.query_info(ATTRIBUTES, NOFOLLOW, null));
        if (original === null) requireAbsent(settings);
        else publishExclusive(settings, original, manifest.originalMode as number);
        // Keep the live wrapper at its old path until publication succeeds;
        // concurrent edits may still reference that exact statusLine command.
        sameFile(transactionIdentity, privateDirectory(transaction));
        transaction.move(archivedTransaction, ATOMIC_MOVE, null, null);
        transactionMoved = true;
        sameFile(transactionIdentity, privateDirectory(archivedTransaction));
        return recovery.get_basename()!;
    } catch (error) {
        // Retain the wrapper for settings which still reference it. Never
        // overwrite a new transaction or any concurrent settings file.
        try {
            noSymlinkDirectories(directory.get_path()!);
            sameFile(directoryIdentity, directory.query_info(ATTRIBUTES, NOFOLLOW, null));
            if (transactionMoved) archivedTransaction.move(transaction, ATOMIC_MOVE, null, null);
        } catch { /* all artifacts remain recoverable */ }
        try {
            noSymlinkDirectories(directory.get_path()!);
            sameFile(directoryIdentity, directory.query_info(ATTRIBUTES, NOFOLLOW, null));
            const retained = await readOriginal(captured);
            if (retained.bytes !== null) publishExclusive(settings, retained.bytes, retained.mode);
        } catch { /* captured inode is still in the private archive */ }
        printerr(`Claude restore stopped; recovery data retained in ${recovery.get_basename()} inside the Claude config directory. Existing setup artifacts are preserved on conflict.`);
        throw error;
    }
}
export async function runSetup(args: string[]): Promise<number> {
    if (args.length === 1 && args[0] === '--help') { print(HELP); return 0; }
    const mode = args[0];
    let requested: string | null = null, requestedClaude: string | null = null;
    for (let i = 1; i < args.length; i += 2) {
        const value = args[i + 1];
        if (mode === '--restore' || !value || !GLib.path_is_absolute(value)) { printerr(HELP); return 1; }
        if (args[i] === '--renderer' && requested === null) requested = value;
        else if (args[i] === '--claude' && requestedClaude === null) requestedClaude = value;
        else { printerr(HELP); return 1; }
    }
    if (!['--preview', '--apply', '--restore'].includes(mode!)) { printerr(HELP); return 1; }
    try {
        let directory = configDirectory(false);
        if (mode === '--restore') {
            if (!directory) throw invalid();
            const recovery = await restore(directory);
            print(`Claude settings restored; captured settings and prior setup retained in ${recovery} inside the Claude config directory.`);
            return 0;
        }
        const settingsFile = directory?.get_child('settings.json') ?? Gio.File.new_for_path(GLib.build_filenamev([configPath(), 'settings.json']));
        const original = await readOriginal(settingsFile);
        const settings = original.bytes === null ? {} : record(JSON.parse(decode(original.bytes)));
        const renderer = rendererFor(settings, requested);
        // Discovery only validates a path. Setup never executes Claude or signs in.
        const discoveredClaude = requestedClaude ?? (mode === '--apply' ? GLib.find_program_in_path('claude') : null);
        const claude = discoveredClaude === null ? null : executable(discoveredClaude);
        if (mode === '--preview') {
            print(`Preview only: ${renderer ? 'preserve existing executable renderer' : 'add quota-only statusline'}; apply stores a private exact backup and wrapper in the Claude user config directory. No settings changed.`);
            return 0;
        }
        directory ??= configDirectory(true)!;
        const directoryIdentity = directory.query_info(ATTRIBUTES, NOFOLLOW, null);
        const transaction = directory.get_child(TRANSACTION);
        // Exclusive transaction directory prevents accidental double-apply or backup overwrite.
        if (GLib.mkdir(transaction.get_path()!, 0o700) !== 0) throw invalid();
        let prepared = false;
        try {
            privateDirectory(transaction);
            const discovered = GLib.find_program_in_path('gjs');
            if (!discovered) throw invalid();
            const gjs = executable(discovered);
            const wrapper = transaction.get_child(WRAPPER);
            const wrapperBytes = encode(`#!${gjs} -m\nimport System from 'system';\nimport {runBridge} from ${JSON.stringify(Gio.File.new_for_uri(import.meta.url).get_parent()!.get_child('bridge.js').get_uri())};\nSystem.exit(await runBridge(${JSON.stringify(renderer)}, ${JSON.stringify(claude)}));\n`);
            const installed = {...settings, statusLine: {...(settings.statusLine == null ? {} : record(settings.statusLine)), type: 'command', command: shellQuote(wrapper.get_path()!)}};
            const installedBytes = encode(`${JSON.stringify(installed, null, 2)}\n`);
            if (installedBytes.length > MAX_BYTES) throw invalid();
            if (original.bytes !== null) writeNew(transaction.get_child('original.json'), original.bytes);
            writeNew(wrapper, wrapperBytes, true);
            const manifest: Manifest = {version: 1, originalExists: original.bytes !== null, originalMode: original.mode,
                originalHash: original.bytes === null ? null : hash(original.bytes), installedHash: hash(installedBytes), wrapperHash: hash(wrapperBytes)};
            writeNew(transaction.get_child('manifest.json'), encode(JSON.stringify(manifest)));
            prepared = true;
            await unchanged(settingsFile, original);
            sameFile(directoryIdentity, directory.query_info(ATTRIBUTES, NOFOLLOW, null));
            noSymlinkDirectories(configPath());
            privateDirectory(transaction);
            replace(settingsFile, installedBytes, original);
        } catch (error) {
            // Keep a complete backup if publication might have happened; --restore can
            // recover either the original or installed state without overwriting edits.
            if (!prepared) { try { cleanup(transaction); } catch { /* fail closed */ } }
            throw error;
        }
        print('Claude statusline configured. Private backup and wrapper are in .usagescope-setup; run --restore to undo.');
        return 0;
    } catch (error) {
        printerr(error instanceof Error && error.message === MANUAL ? MANUAL : 'Claude setup refused: invalid, changed, unsafe, or already configured settings. No automatic overwrite; inspect the user config directory or use --restore.');
        return 1;
    }
}
if (System.programPath && Gio.File.new_for_path(System.programPath).get_uri() === import.meta.url) {
    let status = 1;
    try { status = await runSetup(System.programArgs); } catch { printerr('Claude setup unavailable.'); }
    System.exit(status);
}
