export type ProviderId = 'codex' | 'claude';
export interface QuotaWindow { id: string; label: string; durationSeconds: number | null; usedPercent: number; resetsAt: number | null; }
export interface UsageSnapshot { provider: ProviderId; sourceId: string; accountId: string | null; receivedAt: number; windows: QuotaWindow[]; allowed: boolean | null; }
export type Status = 'disabled' | 'waiting' | 'loading' | 'ready' | 'auth-required' | 'unavailable' | 'error';
export interface ProviderView { status: Status; snapshot: UsageSnapshot | null; message: string; }
export interface ProviderController { refresh(): Promise<void>; connect(): Promise<void>; stop(): void; }
export type Publish = (view: ProviderView) => void;

