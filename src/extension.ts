import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {CodexController} from './codex/controller.js';
import {ClaudeCliController} from './claude/cli.js';
import type {ProviderId, ProviderView} from './core/types.js';
import {UsageIndicator} from './ui/indicator.js';
import {LowQuotaAlerts, nextUiDeadline, plainText} from './ui/model.js';
import {websiteUrl} from './core/policy.js';
import {normalPollSeconds} from './core/polling.js';

function disabled(): ProviderView {
    return {status: 'disabled', snapshot: null, message: 'Monitoring off; CLI sign-in is unchanged.'};
}

// No keyboard or pointer input for this long pauses CLI reads; any input resumes them at once.
// Uninhibitable: video playback inhibits idle but nobody reads the panel then either.
const IDLE_PAUSE_MS = 5 * 60 * 1000;

const CLI: Record<ProviderId, {key: 'codex-path' | 'claude-path'; name: string}> = {
    codex: {key: 'codex-path', name: 'codex'},
    claude: {key: 'claude-path', name: 'claude'},
};

export default class UsageScopeExtension extends Extension {
    private active = false;
    private settings: Gio.Settings | null = null;
    private settingsSignal = 0;
    private clockSource = 0;
    private clockDeadline: number | null = null;
    private menuOpen = false;
    private indicator: UsageIndicator | null = null;
    private codex: CodexController | null = null;
    private claude: ClaudeCliController | null = null;
    private generations: Record<ProviderId, number> = {codex: 0, claude: 0};
    private views: Record<ProviderId, ProviderView> = {codex: disabled(), claude: disabled()};
    private enabled: Record<ProviderId, boolean> = {codex: false, claude: false};
    private busy: Record<ProviderId, boolean> = {codex: false, claude: false};
    private websiteLaunches = new Set<Gio.Cancellable>();
    private alerts: Record<ProviderId, LowQuotaAlerts> = {codex: new LowQuotaAlerts('codex'), claude: new LowQuotaAlerts('claude')};
    private notificationSource: MessageTray.Source | null = null;
    private idleMonitor: Meta.IdleMonitor | null = null;
    private idleWatch = 0;
    private activeWatch = 0;
    private idle = false;

    override enable(): void {
        if (this.active) return;
        this.active = true;
        try {
            this.settings = this.getSettings();
            this.indicator = new UsageIndicator({
                setEnabled: (provider, enabled) => this.settings?.set_boolean(`enable-${provider}`, enabled),
                openWebsite: provider => this.openWebsite(provider),
                refresh: () => {void this.refresh('codex'); void this.refresh('claude');},
                setPollSeconds: seconds => this.settings?.set_int('poll-seconds', seconds),
                menuStateChanged: open => {this.menuOpen = open; this.render();},
            });
            Main.panel.addToStatusArea(this.uuid, this.indicator.button);
            this.settingsSignal = this.settings.connect('changed', (_settings, key: string) => {
                if (!this.active) return;
                if (key === 'enable-codex') this.reconcile('codex');
                else if (key === 'enable-claude') this.reconcile('claude');
                else {
                    const restart: ProviderId[] = key === 'codex-path' ? ['codex'] : key === 'claude-path' ? ['claude']
                        : key === 'poll-seconds' ? ['codex', 'claude'] : [];
                    for (const provider of restart) {
                        this.stopProvider(provider);
                        this.reconcile(provider);
                    }
                }
                this.render();
            });
            this.idleMonitor = global.backend.get_core_idle_monitor();
            this.idleWatch = this.idleMonitor.add_idle_watch_full(IDLE_PAUSE_MS, () => this.setIdle(true),
                Meta.IdleMonitorWatchFlags.UNINHIBITABLE);
            this.reconcile('codex');
            this.reconcile('claude');
            this.render();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    private setIdle(idle: boolean): void {
        if (!this.active || !this.idleMonitor || this.idle === idle) return;
        this.idle = idle;
        // The active watch is one-shot (Mutter), so it only needs removing if disable() comes first.
        if (idle) this.activeWatch = this.idleMonitor.add_user_active_watch(() => { this.activeWatch = 0; this.setIdle(false); });
        for (const controller of [this.codex, this.claude]) {
            if (idle) controller?.pause();
            else controller?.resume();
        }
    }

    /** A configured absolute path wins; otherwise PATH, then the official native install location. */
    private executable(provider: ProviderId): string | null {
        const {key, name} = CLI[provider];
        const configured = this.settings?.get_string(key) ?? '';
        if (configured.length > 4096 || (configured && !GLib.path_is_absolute(configured))) return null;
        const native = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', name]);
        const found = configured ? GLib.find_program_in_path(configured)
            : GLib.find_program_in_path(name) ?? (GLib.file_test(native, GLib.FileTest.IS_EXECUTABLE) ? native : null);
        return found && GLib.file_test(found, GLib.FileTest.IS_REGULAR) ? found : null;
    }

    private reconcile(provider: ProviderId): void {
        if (!this.active || !this.settings) return;
        const enabled = this.settings.get_boolean(`enable-${provider}`);
        this.enabled[provider] = enabled;
        if (!enabled) {
            this.stopProvider(provider);
            return;
        }
        if (provider === 'codex' ? this.codex : this.claude) return;
        const generation = ++this.generations[provider];
        this.views[provider] = {status: 'waiting', snapshot: null, message: 'Waiting for local provider data.'};
        const publish = (view: ProviderView) => {
            if (!this.active || this.generations[provider] !== generation) return;
            this.views[provider] = view;
            const crossed = this.alerts[provider].observe(view);
            if (crossed.length) this.notifyLow(provider, crossed.map(window => window.label));
            this.render();
        };
        try {
            const executable = this.executable(provider);
            if (!executable) {
                publish({status: 'unavailable', snapshot: null,
                    message: 'Official CLI not found. Install it yourself, or set its absolute path with gsettings.'});
                return;
            }
            const options = {executable, pollSeconds: this.settings.get_int('poll-seconds'), publish};
            const controller = provider === 'codex' ? (this.codex = new CodexController(options))
                : (this.claude = new ClaudeCliController(options));
            // Paused before start, so a provider restarted while idle does not read until input.
            if (this.idle) controller.pause();
            controller.start();
        } catch {
            publish({status: 'error', snapshot: null,
                message: 'Provider could not start. Check the official CLI installation.'});
        }
    }

    private stopProvider(provider: ProviderId): void {
        ++this.generations[provider];
        this.alerts[provider].clear();
        this.busy[provider] = false;
        const controller = provider === 'codex' ? this.codex : this.claude;
        if (provider === 'codex') this.codex = null;
        else this.claude = null;
        controller?.stop();
        this.views[provider] = disabled();
    }

    private async refresh(provider: ProviderId): Promise<void> {
        if (!this.active || !this.enabled[provider] || this.busy[provider]) return;
        if (!(provider === 'codex' ? this.codex : this.claude)) this.reconcile(provider);
        const controller = provider === 'codex' ? this.codex : this.claude;
        if (!controller) {this.render(); return;}
        const generation = this.generations[provider];
        this.busy[provider] = true;
        this.render();
        try {
            await controller.refresh();
        } finally {
            if (this.active && generation === this.generations[provider]) {
                this.busy[provider] = false;
                this.render();
            }
        }
    }

    private openWebsite(provider: ProviderId): void {
        if (!this.active) return;
        const uri = websiteUrl(provider);
        const cancellable = new Gio.Cancellable();
        this.websiteLaunches.add(cancellable);
        Gio.AppInfo.launch_default_for_uri_async(uri, null, cancellable, (_source, result) => {
            this.websiteLaunches.delete(cancellable);
            try { Gio.AppInfo.launch_default_for_uri_finish(result); }
            catch {
                if (!this.active || cancellable.is_cancelled()) return;
                this.views[provider] = {...this.views[provider], message: '기본 브라우저에서 공식 페이지를 열 수 없습니다.'};
                this.render();
            }
        });
    }

    private notifyLow(provider: ProviderId, labels: string[]): void {
        if (!this.active) return;
        if (!this.notificationSource) {
            const source = new MessageTray.Source({title: 'UsageScope', iconName: 'utilities-system-monitor-symbolic'});
            source.connect('destroy', () => {
                if (this.notificationSource === source) this.notificationSource = null;
            });
            this.notificationSource = source;
            Main.messageTray.add(source);
        }
        this.notificationSource.addNotification(new MessageTray.Notification({
            source: this.notificationSource, title: `${provider === 'codex' ? 'ChatGPT' : 'Claude'} 잔여량 30% 이하`,
            body: plainText(`${labels.slice(0, 4).join(', ')} 조회 잔여량이 30% 이하입니다.`, 240),
            useBodyMarkup: false, isTransient: true, privacyScope: MessageTray.PrivacyScope.USER,
            urgency: MessageTray.Urgency.NORMAL,
        }));
    }

    private render(): void {
        if (!this.active || !this.indicator || !this.settings) return;
        const now = Date.now();
        this.indicator.update(this.views, this.enabled, this.busy, now, this.menuOpen);
        if (this.menuOpen) this.indicator.setPollSeconds(normalPollSeconds(this.settings.get_int('poll-seconds')));
        const deadline = nextUiDeadline(this.views, this.enabled, this.menuOpen, now);
        if (deadline === this.clockDeadline) return;
        if (this.clockSource) GLib.Source.remove(this.clockSource);
        this.clockSource = 0;
        this.clockDeadline = deadline;
        if (deadline !== null) {
            const delay = Math.max(1, Math.min(2_147_483_647, deadline - now));
            this.clockSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this.clockSource = 0;
                this.clockDeadline = null;
                if (this.active) this.render();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    override disable(): void {
        // Invalidate every async callback before synchronously tearing down owned resources.
        this.active = false;
        this.menuOpen = false;
        this.clockDeadline = null;
        if (this.clockSource) {
            GLib.Source.remove(this.clockSource);
            this.clockSource = 0;
        }
        if (this.settings && this.settingsSignal) this.settings.disconnect(this.settingsSignal);
        this.settingsSignal = 0;
        for (const watch of [this.idleWatch, this.activeWatch]) if (watch) this.idleMonitor?.remove_watch(watch);
        this.idleWatch = this.activeWatch = 0;
        this.idleMonitor = null;
        this.idle = false;
        this.stopProvider('codex');
        this.stopProvider('claude');
        for (const cancellable of this.websiteLaunches) cancellable.cancel();
        this.websiteLaunches.clear();
        this.notificationSource?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        this.notificationSource = null;
        this.enabled = {codex: false, claude: false};
        this.indicator?.destroy();
        this.indicator = null;
        this.settings = null;
    }
}
