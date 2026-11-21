import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {CodexController} from './codex/controller.js';
import {ClaudeController} from './claude/controller.js';
import type {ProviderId, ProviderView} from './core/types.js';
import {UsageIndicator} from './ui/indicator.js';
import {LowQuotaAlerts, nextUiDeadline, plainText} from './ui/model.js';

function disabled(): ProviderView {
    return {status: 'disabled', snapshot: null, message: 'Monitoring off; CLI sign-in is unchanged.'};
}

export default class UsageScopeExtension extends Extension {
    private active = false;
    private settings: Gio.Settings | null = null;
    private settingsSignal = 0;
    private clockSource = 0;
    private clockDeadline: number | null = null;
    private menuOpen = false;
    private indicator: UsageIndicator | null = null;
    private codex: CodexController | null = null;
    private claude: ClaudeController | null = null;
    private generations: Record<ProviderId, number> = {codex: 0, claude: 0};
    private views: Record<ProviderId, ProviderView> = {codex: disabled(), claude: disabled()};
    private enabled: Record<ProviderId, boolean> = {codex: false, claude: false};
    private busy: Record<ProviderId, boolean> = {codex: false, claude: false};
    private login = false;
    private loginAttempt: Promise<void> | null = null;
    private cancelingLogin = false;
    private claudeSource: string | null = null;
    private browserLaunches = new Set<Gio.Cancellable>();
    private alerts = new LowQuotaAlerts();
    private notificationSource: MessageTray.Source | null = null;

    override enable(): void {
        if (this.active) return;
        this.active = true;
        try {
            this.settings = this.getSettings();
            this.indicator = new UsageIndicator({
                setEnabled: (provider, enabled) => this.settings?.set_boolean(`enable-${provider}`, enabled),
                connectCodex: () => this.connectCodex(),
                refreshCodex: () => {void this.runCodex('refresh');},
                cancelLogin: () => {void this.cancelLogin();},
                refreshClaude: () => {void this.runClaude('refresh');},
                selectClaudeSource: id => {void this.runClaude('select', id);},
                setPollSeconds: seconds => this.settings?.set_int('poll-seconds', seconds),
                setCodexPath: path => this.settings?.set_string('codex-path', path),
                menuStateChanged: open => {this.menuOpen = open; this.render();},
            }, this.path);
            Main.panel.addToStatusArea(this.uuid, this.indicator.button);
            this.settingsSignal = this.settings.connect('changed', (_settings, key: string) => {
                if (!this.active) return;
                if (key === 'enable-codex' || key === 'enable-claude') {
                    const provider = key === 'enable-codex' ? 'codex' : 'claude';
                    this.reconcile(provider);
                } else if (key === 'codex-path' || key === 'poll-seconds') {
                    this.stopProvider('codex');
                    this.reconcile('codex');
                }
                this.render();
            });
            this.reconcile('codex');
            this.reconcile('claude');
            this.render();
        } catch (error) {
            this.disable();
            throw error;
        }
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
            if (provider === 'codex') {
                if (!this.busy.codex && view.status !== 'loading') this.login = false;
                const crossed = this.alerts.observe(view);
                if (crossed.length) this.notifyLow(crossed.map(window => window.label));
            }
            this.render();
        };
        try {
            if (provider === 'codex') {
                const configured = this.settings.get_string('codex-path');
                const executable = configured.length <= 4096 ? GLib.find_program_in_path(configured || 'codex') : null;
                if (!executable || !GLib.file_test(executable, GLib.FileTest.IS_REGULAR)) {
                    publish({status: 'unavailable', snapshot: null,
                        message: 'Codex CLI not found. Install the official CLI yourself, or set its executable path in Monitoring settings.'});
                    return;
                }
                this.codex = new CodexController({executable,
                    pollSeconds: this.settings.get_int('poll-seconds'), publish,
                    openUri: uri => this.openLoginUri(uri, generation)});
                this.codex.start();
            } else {
                this.claude = new ClaudeController({publish, sourceId: this.claudeSource ?? undefined});
                this.claude.start();
            }
        } catch {
            publish({status: 'error', snapshot: null,
                message: 'Provider could not start. Check the official CLI and local setup guidance.'});
        }
    }

    private stopProvider(provider: ProviderId): void {
        ++this.generations[provider];
        this.busy[provider] = false;
        if (provider === 'codex') {
            const controller = this.codex;
            this.codex = null;
            this.login = false;
            this.loginAttempt = null;
            this.cancelingLogin = false;
            this.alerts.clear();
            for (const cancellable of this.browserLaunches) cancellable.cancel();
            this.browserLaunches.clear();
            controller?.stop();
            this.notificationSource?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
            this.notificationSource = null;
        } else {
            const controller = this.claude;
            this.claude = null;
            controller?.stop();
        }
        this.views[provider] = disabled();
    }

    private connectCodex(): void {
        if (!this.active || !this.enabled.codex || this.busy.codex || this.login) return;
        this.login = true;
        const attempt = this.runCodex('connect');
        this.loginAttempt = attempt;
        void attempt.then(() => {
            if (this.loginAttempt === attempt) this.loginAttempt = null;
        });
    }

    private async runCodex(action: 'refresh' | 'connect'): Promise<void> {
        if (!this.active || !this.enabled.codex || this.busy.codex || (this.login && action !== 'connect')) return;
        if (!this.codex) this.reconcile('codex');
        const controller = this.codex;
        if (!controller) {this.login = false; this.render(); return;}
        const generation = this.generations.codex;
        this.busy.codex = true;
        this.render();
        try {
            await controller[action]();
        } catch {
            if (this.active && generation === this.generations.codex)
                this.views.codex = {...this.views.codex, status: 'error', message: 'Codex action failed. Check the CLI and try again.'};
        } finally {
            if (this.active && generation === this.generations.codex) {
                this.busy.codex = this.cancelingLogin;
                // connect() returns after launching the browser; keep Cancel until login finishes.
                if (this.views.codex.status !== 'loading') this.login = false;
                this.render();
            }
        }
    }

    private async cancelLogin(): Promise<void> {
        if (!this.active || !this.codex || !this.login) return;
        const controller = this.codex;
        const generation = this.generations.codex;
        const attempt = this.loginAttempt;
        for (const cancellable of this.browserLaunches) cancellable.cancel();
        this.browserLaunches.clear();
        this.login = false;
        this.cancelingLogin = true;
        this.busy.codex = true;
        this.render();
        try {
            // Login may still be waiting for its ID. Suppress its browser callback
            // immediately, then cancel after that in-flight start has completed.
            await attempt;
            if (!this.active || generation !== this.generations.codex) return;
            await controller.cancelLogin();
        } catch {
            // The controller owns cancellation and reports provider failures separately.
        } finally {
            if (this.active && generation === this.generations.codex) {
                this.busy.codex = false;
                this.cancelingLogin = false;
                this.views.codex = {...this.views.codex, status: 'waiting', message: 'Login canceled. CLI sign-in is unchanged.'};
                this.render();
            }
        }
    }

    private async runClaude(action: 'refresh' | 'select', id: string | null = null): Promise<void> {
        if (!this.active || !this.enabled.claude || this.busy.claude || !this.claude) return;
        const controller = this.claude;
        const generation = this.generations.claude;
        this.busy.claude = true;
        if (action === 'select') {
            this.views.claude = {status: 'loading', snapshot: null, message: 'Selecting one Claude session.'};
        }
        this.render();
        try {
            if (action === 'select') {
                await controller.selectSource(id);
                if (this.active && generation === this.generations.claude) this.claudeSource = id;
            } else await controller.refresh();
        } catch {
            if (this.active && generation === this.generations.claude)
                this.views.claude = {...this.views.claude, status: 'error', message: 'Could not read that Claude source. Review local setup and source selection.'};
        } finally {
            if (this.active && generation === this.generations.claude) {
                this.busy.claude = false;
                this.render();
            }
        }
    }

    private openLoginUri(uri: string, generation: number): void {
        // CodexController validates the official HTTPS URL before this callback.
        if (!this.active || !this.login || generation !== this.generations.codex) return;
        const cancellable = new Gio.Cancellable();
        this.browserLaunches.add(cancellable);
        Gio.AppInfo.launch_default_for_uri_async(uri, null, cancellable, (_source, result) => {
            this.browserLaunches.delete(cancellable);
            try {
                Gio.AppInfo.launch_default_for_uri_finish(result);
            } catch {
                if (!this.active || generation !== this.generations.codex || cancellable.is_cancelled()) return;
                this.views.codex = {...this.views.codex, status: 'error',
                    message: 'The default browser could not open Codex sign-in. Check your default HTTPS application, then reconnect.'};
                this.login = false;
                void this.codex?.cancelLogin();
                this.render();
            }
        });
    }

    private notifyLow(labels: string[]): void {
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
            source: this.notificationSource, title: 'Codex quota below 20%',
            body: plainText(`${labels.slice(0, 4).join(', ')} remaining quota fell below 20%.`, 240),
            useBodyMarkup: false, isTransient: true, privacyScope: MessageTray.PrivacyScope.USER,
            urgency: MessageTray.Urgency.NORMAL,
        }));
    }

    private render(): void {
        if (!this.active || !this.indicator || !this.settings) return;
        const now = Date.now();
        this.indicator.update(this.views, this.enabled, this.busy, this.login, now, this.menuOpen);
        if (this.menuOpen) {
            this.indicator.setSettings(this.settings.get_int('poll-seconds'), this.settings.get_string('codex-path'));
            this.indicator.setSources(this.claude?.listSources() ?? [], this.views.claude.snapshot?.sourceId ?? this.claudeSource);
        }
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
        this.stopProvider('codex');
        this.stopProvider('claude');
        this.enabled = {codex: false, claude: false};
        this.claudeSource = null;
        this.indicator?.destroy();
        this.indicator = null;
        this.settings = null;
    }
}
