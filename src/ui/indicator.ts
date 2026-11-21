import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {formatWindow, isExpired, panelText} from '../core/format.js';
import type {ProviderId, ProviderView} from '../core/types.js';
import {plainText, receiptAge, setupCommands, sourceLabel} from './model.js';

export interface IndicatorActions {
    setEnabled(provider: ProviderId, enabled: boolean): void;
    connectCodex(): void;
    refreshCodex(): void;
    cancelLogin(): void;
    refreshClaude(): void;
    selectClaudeSource(id: string | null): void;
    setPollSeconds(seconds: number): void;
    setCodexPath(path: string): void;
    menuStateChanged(open: boolean): void;
}

function setText(label: St.Label, text: string, limit = 300): void {
    const bounded = plainText(text, limit);
    if (label.clutter_text.use_markup) label.clutter_text.use_markup = false;
    if (label.get_text() !== bounded) label.set_text(bounded);
}

function detail(menu: PopupMenu.PopupMenuSection | PopupMenu.PopupSubMenu, text = ''): St.Label {
    const item = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
    item.label.add_style_class_name('usagescope-detail');
    item.label.clutter_text.line_wrap = true;
    item.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    setText(item.label, text, 2048);
    menu.addMenuItem(item);
    return item.label;
}

const statusNames: Record<ProviderView['status'], string> = {
    disabled: 'Monitoring off', waiting: 'Waiting for a snapshot', loading: 'Checking usage',
    ready: 'Snapshot available', 'auth-required': 'Sign-in required',
    unavailable: 'Unavailable', error: 'Provider error',
};

class ProviderSection {
    readonly section = new PopupMenu.PopupMenuSection();
    readonly toggle: PopupMenu.PopupSwitchMenuItem;
    readonly connect: PopupMenu.PopupMenuItem | null;
    readonly refresh: PopupMenu.PopupMenuItem;
    readonly cancel: PopupMenu.PopupMenuItem | null;
    readonly sourceMenu: PopupMenu.PopupSubMenuMenuItem | null;
    private status: St.Label;
    private permission: St.Label | null;
    private message: St.Label;
    private source: St.Label;
    private receipt: St.Label;
    private windows: St.Label[] = [];
    private extraWindows: St.Label;
    private sourceSignature = '';

    constructor(readonly provider: ProviderId, actions: IndicatorActions, extensionPath: string) {
        const name = provider === 'codex' ? 'Codex' : 'Claude';
        this.toggle = new PopupMenu.PopupSwitchMenuItem(`${name} monitoring`, false);
        this.toggle.connect('toggled', (_item, state: boolean) => actions.setEnabled(provider, state));
        this.section.addMenuItem(this.toggle);
        this.status = detail(this.section);
        this.permission = provider === 'codex' ? detail(this.section) : null;
        this.message = detail(this.section);
        this.source = detail(this.section);
        this.receipt = detail(this.section);
        for (let i = 0; i < 8; i++) this.windows.push(detail(this.section));
        this.extraWindows = detail(this.section);
        if (provider === 'codex') {
            this.connect = new PopupMenu.PopupMenuItem('Connect Codex…');
            this.connect.connect('activate', () => actions.connectCodex());
            this.section.addMenuItem(this.connect);
            this.refresh = new PopupMenu.PopupMenuItem('Refresh Codex');
            this.refresh.connect('activate', () => actions.refreshCodex());
            this.cancel = new PopupMenu.PopupMenuItem('Cancel Codex login');
            this.cancel.connect('activate', () => actions.cancelLogin());
            this.section.addMenuItem(this.refresh);
            this.section.addMenuItem(this.cancel);
            this.sourceMenu = null;
        } else {
            this.connect = null;
            this.cancel = null;
            this.sourceMenu = new PopupMenu.PopupSubMenuMenuItem('Claude session source');
            this.section.addMenuItem(this.sourceMenu);
            this.refresh = new PopupMenu.PopupMenuItem('Read latest Claude snapshot');
            this.refresh.connect('activate', () => actions.refreshClaude());
            this.section.addMenuItem(this.refresh);
            detail(this.section, 'Server freshness unknown; local receipt time is not server observation time.');
            const setup = new PopupMenu.PopupSubMenuMenuItem('Claude setup and sign-in…');
            detail(setup.menu, 'Run these commands yourself in a terminal. Setup changes are never applied by this menu.');
            detail(setup.menu, '1. Sign in with the official CLI: claude auth login');
            detail(setup.menu, '2. Preview the statusline integration, then review its proposed changes:');
            const [preview, apply] = setupCommands(extensionPath);
            detail(setup.menu, preview);
            detail(setup.menu, '3. Apply only after reviewing the preview. This updates your Claude configuration:');
            detail(setup.menu, apply);
            detail(setup.menu, 'Claude usage appears after a Claude statusline invocation. Choose one session when several exist.');
            this.section.addMenuItem(setup);
        }
    }

    update(view: ProviderView, enabled: boolean, busy: boolean, login: boolean, now: number): void {
        this.toggle.setToggleState(enabled);
        setText(this.status, statusNames[view.status]);
        setText(this.message, view.message);
        this.message.visible = view.message.length > 0;
        this.message.set_style_class_name(view.status === 'error' || view.status === 'unavailable'
            ? 'usagescope-detail usagescope-error' : 'usagescope-detail');
        const snapshot = view.snapshot;
        if (this.permission) {
            const permission = snapshot?.allowed === true ? 'allowed'
                : snapshot?.allowed === false ? 'not allowed' : 'unknown';
            setText(this.permission, `Last snapshot usage permission: ${permission}`);
        }
        setText(this.source, snapshot ? `Source: ${sourceLabel(snapshot.sourceId)}` : 'Source: none');
        setText(this.receipt, snapshot
            ? `Last local receipt: ${receiptAge(snapshot.receivedAt, now)} · ${new Date(snapshot.receivedAt).toLocaleString()}`
            : 'Last local receipt: none');
        const historical = view.status !== 'ready' || (snapshot && now - snapshot.receivedAt > 360_000);
        for (const [index, label] of this.windows.entries()) {
            const window = snapshot?.windows[index];
            label.visible = !!window;
            if (!window) continue;
            const prefix = isExpired(window, now) ? 'Expired · ' : historical ? 'Historical · ' : '';
            setText(label, prefix + formatWindow(window, now));
        }
        const extra = Math.max(0, (snapshot?.windows.length ?? 0) - this.windows.length);
        this.extraWindows.visible = extra > 0;
        setText(this.extraWindows, `${extra} additional quota windows`);
        this.connect?.setSensitive(enabled && !busy && !login && view.status !== 'loading');
        this.refresh.setSensitive(enabled && !busy && !login && view.status !== 'loading');
        this.sourceMenu?.setSensitive(enabled && !busy);
        if (this.cancel) {
            this.cancel.visible = login;
            this.cancel.setSensitive(login);
        }
    }

    setSources(ids: string[], selected: string | null, actions: IndicatorActions): void {
        if (!this.sourceMenu) return;
        const boundedIds = ids.slice(0, 128);
        const signature = JSON.stringify([boundedIds, selected]);
        if (signature === this.sourceSignature) return;
        this.sourceSignature = signature;
        this.sourceMenu.menu.removeAll();
        detail(this.sourceMenu.menu, 'Select a single session. Usage from different sessions is never combined.');
        const clear = new PopupMenu.PopupMenuItem('Clear explicit selection');
        clear.setOrnament(selected === null ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        clear.connect('activate', () => actions.selectClaudeSource(null));
        this.sourceMenu.menu.addMenuItem(clear);
        if (!boundedIds.length) detail(this.sourceMenu.menu, 'No local session snapshots found.');
        for (const id of boundedIds) {
            const item = new PopupMenu.PopupMenuItem(sourceLabel(id));
            item.label.clutter_text.use_markup = false;
            item.accessible_name = `Claude source ${plainText(id, 256)}`;
            item.setOrnament(selected === id ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => actions.selectClaudeSource(id));
            this.sourceMenu.menu.addMenuItem(item);
        }
        if (ids.length > boundedIds.length) detail(this.sourceMenu.menu, 'Showing the first 128 local sources.');
    }
}

export class UsageIndicator {
    readonly button = new PanelMenu.Button(0.5, 'UsageScope');
    private panelLabel = new St.Label({text: 'UsageScope', y_align: Clutter.ActorAlign.CENTER});
    private sections: Record<ProviderId, ProviderSection>;
    private pathEntry: St.Entry;
    private pollLabel: St.Label;
    private menuSignal: number;
    private settingsPath: string | null = null;
    private actions: IndicatorActions;

    constructor(actions: IndicatorActions, extensionPath: string) {
        this.actions = actions;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.HORIZONTAL, style_class: 'usagescope-panel'});
        box.add_child(this.panelLabel);
        this.button.add_child(box);
        if (!(this.button.menu instanceof PopupMenu.PopupMenu)) throw new Error('UsageScope menu unavailable');
        const menu = this.button.menu;
        menu.actor.add_style_class_name('usagescope-menu');
        this.sections = {
            codex: new ProviderSection('codex', actions, extensionPath),
            claude: new ProviderSection('claude', actions, extensionPath),
        };
        menu.addMenuItem(this.sections.codex.section);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this.sections.claude.section);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settings = new PopupMenu.PopupSubMenuMenuItem('Monitoring settings');
        this.pollLabel = detail(settings.menu);
        for (const seconds of [60, 180, 300, 900, 3600]) {
            const choice = new PopupMenu.PopupMenuItem(`Codex polling: ${seconds / 60} min`);
            choice.connect('activate', () => actions.setPollSeconds(seconds));
            settings.menu.addMenuItem(choice);
        }
        detail(settings.menu, 'Codex executable path (blank searches PATH for codex):');
        const pathRow = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        pathRow.label.hide();
        this.pathEntry = new St.Entry({can_focus: true, hint_text: 'codex from PATH',
            x_expand: true, style_class: 'usagescope-path', accessible_name: 'Codex executable path'});
        this.pathEntry.clutter_text.set_max_length(4096);
        pathRow.add_child(this.pathEntry);
        settings.menu.addMenuItem(pathRow);
        const applyPath = () => actions.setCodexPath(this.pathEntry.get_text());
        this.pathEntry.clutter_text.connect('activate', applyPath);
        const save = new PopupMenu.PopupMenuItem('Save executable path');
        save.connect('activate', applyPath);
        settings.menu.addMenuItem(save);
        detail(settings.menu, 'Turning monitoring off stops acquisition. It does not log out of either CLI.');
        detail(settings.menu, 'A panel ~ marks historical data or unknown server freshness.');
        menu.addMenuItem(settings);
        const guidance = new PopupMenu.PopupSubMenuMenuItem('CLI installation guidance');
        detail(guidance.menu, 'UsageScope does not install CLIs. Install the official Codex CLI or Claude Code yourself using its vendor documentation.');
        detail(guidance.menu, 'Codex: set an absolute executable path above if codex is not in the GNOME Shell PATH. Connect opens the validated sign-in URL in your default browser.');
        detail(guidance.menu, 'Claude: sign in yourself with claude auth login, then follow Claude setup and sign-in above.');
        menu.addMenuItem(guidance);
        this.menuSignal = menu.connect('open-state-changed', (_menu, open: boolean) => {
            actions.menuStateChanged(open);
        });
    }

    update(views: Record<ProviderId, ProviderView>, enabled: Record<ProviderId, boolean>,
        busy: Record<ProviderId, boolean>, login: boolean, now = Date.now(), updateDetails = true): void {
        const texts = (['codex', 'claude'] as const).filter(provider => enabled[provider])
            .map(provider => `${provider === 'codex' ? 'Codex' : 'Claude'} ${panelText(views[provider], now)}`);
        const text = texts.length ? texts.join(' · ') : 'UsageScope · off';
        setText(this.panelLabel, text, 200);
        const accessible = `UsageScope · ${plainText(text, 200)}. ~ marks historical or unverified freshness.`;
        if (this.button.accessible_name !== accessible) this.button.accessible_name = accessible;
        if (!updateDetails) return;
        for (const provider of ['codex', 'claude'] as const)
            this.sections[provider].update(views[provider], enabled[provider], busy[provider],
                provider === 'codex' && login, now);
    }

    setSources(ids: string[], selected: string | null): void {
        this.sections.claude.setSources(ids, selected, this.actions);
    }

    setSettings(pollSeconds: number, path: string): void {
        setText(this.pollLabel, `Codex polling interval: ${pollSeconds}s (allowed: 60–3600s)`);
        // Leave an in-progress edit alone when only provider data updates.
        if (path !== this.settingsPath) {
            this.pathEntry.set_text(path);
            this.settingsPath = path;
        }
    }

    destroy(): void {
        this.button.menu.disconnect(this.menuSignal);
        this.button.destroy();
    }
}
