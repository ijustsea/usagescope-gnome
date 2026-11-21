import type {ProviderId, ProviderView, QuotaWindow} from '../core/types.js';

/** UI text always goes to a plain-text actor, with a bounded, single-line value. */
export function plainText(value: string, limit = 240): string {
    return value.slice(0, 8192)
        .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, ' ')
        .replace(/\s+/gu, ' ').trim().slice(0, limit);
}

export function receiptAge(receivedAt: number, now = Date.now()): string {
    const seconds = Math.max(0, Math.floor((now - receivedAt) / 1000));
    if (!Number.isFinite(seconds)) return 'unknown';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

export function sourceLabel(id: string): string {
    const safe = plainText(id, 256);
    return safe.length > 22 ? `${safe.slice(0, 12)}…${safe.slice(-6)}` : safe;
}

export function setupCommands(extensionPath: string): [string, string] {
    const quoted = `'${`${extensionPath}/claude/setup.js`.replace(/'/g, "'\\''")}'`;
    return [`gjs -m ${quoted} --preview`, `gjs -m ${quoted} --apply`];
}

/** Closed menus need only the next change that can affect panel text. */
export function nextUiDeadline(views: Record<ProviderId, ProviderView>,
    enabled: Record<ProviderId, boolean>, menuOpen: boolean, now = Date.now()): number | null {
    if (!enabled.codex && !enabled.claude) return null;
    let deadline = menuOpen ? now + 30_000 : Infinity;
    for (const provider of ['codex', 'claude'] as const) {
        if (!enabled[provider]) continue;
        const view = views[provider];
        const snapshot = view.snapshot;
        if (!snapshot) continue;
        const staleAt = snapshot.receivedAt + 360_001;
        if (provider === 'codex' && view.status === 'ready' && staleAt > now)
            deadline = Math.min(deadline, staleAt);
        for (const window of snapshot.windows) {
            if (window.resetsAt !== null && window.resetsAt * 1000 > now)
                deadline = Math.min(deadline, window.resetsAt * 1000);
        }
    }
    return Number.isFinite(deadline) ? deadline : null;
}

interface AlertWindow {remaining: number; armed: boolean;}

/** Only new ready Codex snapshots drive alerts; UI clock ticks never do. */
export class LowQuotaAlerts {
    private identity: string | null = null;
    private receivedAt = -Infinity;
    private windows = new Map<string, AlertWindow>();

    clear(): void {
        this.identity = null;
        this.receivedAt = -Infinity;
        this.windows.clear();
    }

    observe(view: ProviderView, now = Date.now()): QuotaWindow[] {
        const snapshot = view.snapshot;
        // A cleared identity boundary starts a new baseline even when the
        // backend does not supply an accountId on either side of the switch.
        if (!snapshot) { this.clear(); return []; }
        if (view.status !== 'ready' || !snapshot || snapshot.provider !== 'codex' ||
            !Number.isFinite(snapshot.receivedAt) || now - snapshot.receivedAt > 360_000)
            return [];
        const identity = JSON.stringify([snapshot.sourceId, snapshot.accountId]);
        if (identity !== this.identity) {
            this.clear();
            this.identity = identity;
        }
        if (snapshot.receivedAt <= this.receivedAt) return [];
        this.receivedAt = snapshot.receivedAt;
        const next = new Map<string, AlertWindow>();
        const alerts: QuotaWindow[] = [];
        for (const window of snapshot.windows) {
            // resetsAt is seconds, receivedAt and now are milliseconds.
            if (window.resetsAt !== null && window.resetsAt * 1000 <= now) continue;
            const remaining = 100 - window.usedPercent;
            if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) continue;
            // A changed reset or duration begins a new baseline, never a reset alert.
            const key = JSON.stringify([window.id, window.durationSeconds, window.resetsAt]);
            const previous = this.windows.get(key);
            let armed = previous?.armed ?? remaining >= 20;
            if (remaining >= 25) armed = true;
            if (previous && armed && previous.remaining >= 20 && remaining < 20) {
                alerts.push(window);
                armed = false;
            }
            next.set(key, {remaining, armed});
        }
        this.windows = next;
        return alerts;
    }
}
