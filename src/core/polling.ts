export const DEFAULT_POLL_SECONDS = 60;
export const POLL_INTERVALS = [15, 60, 300] as const;

/** Snaps a stored value to an offered choice without polling more often than it asked
 * (older 3 min, 15 min and 1 h become 5 min). Invalid values must not become zero-delay timers. */
export function normalPollSeconds(seconds: unknown): number {
 if(typeof seconds !== 'number' || !Number.isFinite(seconds)) return DEFAULT_POLL_SECONDS;
 const value = Math.trunc(seconds);
 return POLL_INTERVALS.find(choice => choice >= value) ?? POLL_INTERVALS[POLL_INTERVALS.length - 1]!;
}
