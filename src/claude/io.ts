import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {trustedExecutable} from '../runtime/executable.js';

export const MAX_BYTES = 256 * 1024;
export const ATTRIBUTES = 'standard::type,standard::is-symlink,standard::size,unix::uid,unix::mode,unix::nlink,id::file';
export const NOFOLLOW = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;
export const uid = (): number => new Gio.Credentials().get_unix_user();
export const invalid = (): Error => new Error('Claude integration data or storage is invalid.');
export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
export const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', {fatal: true}).decode(bytes);
export function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    return value as Record<string, unknown>;
}
export function missing(error: unknown): boolean {
    return error instanceof GLib.Error && error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND);
}
export function noSymlinkDirectories(path: string): Gio.File {
    if (!GLib.path_is_absolute(path) || GLib.canonicalize_filename(path, null) !== path) throw invalid();
    let current = Gio.File.new_for_path('/');
    for (const part of path.split('/').filter(Boolean)) {
        current = current.get_child(part);
        const info = current.query_info(ATTRIBUTES, NOFOLLOW, null);
        if ((info.has_attribute('standard::is-symlink') && info.get_is_symlink()) || info.get_file_type() !== Gio.FileType.DIRECTORY) throw invalid();
    }
    return current;
}
export function privateDirectory(file: Gio.File): Gio.FileInfo {
    const info = file.query_info(ATTRIBUTES, NOFOLLOW, null);
    if ((info.has_attribute('standard::is-symlink') && info.get_is_symlink()) || info.get_file_type() !== Gio.FileType.DIRECTORY ||
        info.get_attribute_uint32('unix::uid') !== uid() || (info.get_attribute_uint32('unix::mode') & 0o7777) !== 0o700) throw invalid();
    return info;
}
export function privateFile(info: Gio.FileInfo, mode = 0o600): void {
    if ((info.has_attribute('standard::is-symlink') && info.get_is_symlink()) || info.get_file_type() !== Gio.FileType.REGULAR ||
        info.get_attribute_uint32('unix::uid') !== uid() || (info.get_attribute_uint32('unix::mode') & 0o7777) !== mode ||
        info.get_attribute_uint32('unix::nlink') !== 1 || info.get_size() > MAX_BYTES) throw invalid();
}
export function sameFile(before: Gio.FileInfo, after: Gio.FileInfo): void {
    if (!before.get_attribute_string('id::file') || before.get_attribute_string('id::file') !== after.get_attribute_string('id::file')) throw invalid();
}
export function readChunk(stream: Gio.InputStream, count: number, cancel: Gio.Cancellable | null): Promise<Uint8Array> {
    return new Promise((resolve, reject) => stream.read_bytes_async(count, GLib.PRIORITY_DEFAULT, cancel, (_s, result) => {
        try { resolve(stream.read_bytes_finish(result!).get_data() ?? new Uint8Array()); } catch (error) { reject(error); }
    }));
}
export async function readBounded(stream: Gio.InputStream, cancel: Gio.Cancellable | null, limit = MAX_BYTES): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
        const part = await readChunk(stream, Math.min(8192, limit + 1 - length), cancel);
        if (!part.length) break;
        length += part.length;
        if (length > limit) throw invalid();
        chunks.push(part);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}
export function infoAsync(file: Gio.File, cancel: Gio.Cancellable): Promise<Gio.FileInfo> {
    return new Promise((resolve, reject) => file.query_info_async(ATTRIBUTES, NOFOLLOW, GLib.PRIORITY_DEFAULT, cancel, (_f, result) => {
        try { resolve(file.query_info_finish(result!)); } catch (error) { reject(error); }
    }));
}
export function openAsync(file: Gio.File, cancel: Gio.Cancellable): Promise<Gio.FileInputStream> {
    return new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, cancel, (_f, result) => {
        try { resolve(file.read_finish(result!)); } catch (error) { reject(error); }
    }));
}
export async function readPrivate(file: Gio.File, cancel: Gio.Cancellable, mode = 0o600): Promise<Uint8Array> {
    const before = await infoAsync(file, cancel);
    privateFile(before, mode);
    const stream = await openAsync(file, cancel);
    try {
        const opened = stream.query_info(ATTRIBUTES, cancel);
        privateFile(opened, mode); sameFile(before, opened);
        sameFile(before, await infoAsync(file, cancel));
        return await readBounded(stream, cancel);
    } finally { stream.close(null); }
}
export function writeNew(file: Gio.File, bytes: Uint8Array, executable = false): void {
    if (bytes.length > MAX_BYTES) throw invalid();
    const stream = file.create(Gio.FileCreateFlags.PRIVATE, null);
    try { stream.write_all(bytes, null); } finally { stream.close(null); }
    if (executable && GLib.chmod(file.get_path()!, 0o700) !== 0) throw invalid();
    privateFile(file.query_info(ATTRIBUTES, NOFOLLOW, null), executable ? 0o700 : 0o600);
}
export function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => { resolve(); return GLib.SOURCE_REMOVE; }));
}
export function executable(path: string): string {
    return trustedExecutable(path);
}
