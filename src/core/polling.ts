export const DEFAULT_POLL_SECONDS = 60;
export const POLL_INTERVALS = [15, 60, 180, 300, 900, 3600] as const;

/** Invalid values must not become zero-delay GLib timers. */
export function normalPollSeconds(seconds: unknown): number {
 if(typeof seconds !== 'number' || !Number.isFinite(seconds)) return DEFAULT_POLL_SECONDS;
 return Math.max(15, Math.min(3600, Math.trunc(seconds)));
}
