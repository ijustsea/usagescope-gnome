import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {panelText} from '../core/format.js';
import type {ProviderId, ProviderView} from '../core/types.js';
import {plainText, setupCommands, sourceLabel} from './model.js';
import {ProviderCard} from './card.js';
import {DEFAULT_POLL_SECONDS, POLL_INTERVALS} from '../core/polling.js';

function intervalLabel(seconds: number): string {
    return seconds < 60 ? seconds + '초' : seconds / 60 + '분';
}

export interface IndicatorActions {
    setEnabled(provider: ProviderId, enabled: boolean): void;
    setClaudeCliMode(enabled: boolean): void;
    openWebsite(provider: ProviderId): void;
    connectCodex(): void;
    refreshCodex(): void;
    cancelLogin(): void;
    refreshClaude(): void;
    selectClaudeSource(id: string | null): void;
    setPollSeconds(seconds: number): void;
    setCodexPath(path: string): void;
    menuStateChanged(open: boolean): void;
}

type SectionParent = PopupMenu.PopupSubMenu | PopupMenu.PopupMenuSection;

/** Inline sections avoid GNOME's single-open-submenu restriction. */
class Disclosure {
    readonly item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    readonly button = new St.Button({can_focus: true, x_expand: true, style_class: 'usagescope-disclosure'});
    readonly section = new PopupMenu.PopupMenuSection();
    private label: St.Label;
    private signal: number;
    constructor(parent: SectionParent, private title: string, private changed?: (open: boolean) => void) {
        this.label = new St.Label({text: title + ' ▸', x_align: Clutter.ActorAlign.START});
        this.label.clutter_text.use_markup = false;
        this.button.set_child(this.label);
        this.button.accessible_name = title + ' 펼치기';
        this.item.add_child(this.button);
        this.section.actor.hide();
        parent.addMenuItem(this.item);
        parent.addMenuItem(this.section);
        this.signal = this.button.connect('clicked', () => this.setOpen(!this.isOpen));
    }
    get isOpen(): boolean { return this.section.actor.visible; }
    open(): void { this.setOpen(true); }
    close(): void { this.setOpen(false); }
    private setOpen(open: boolean): void {
        if (this.isOpen === open) return;
        this.section.actor.visible = open;
        this.label.set_text(this.title + (open ? ' ▾' : ' ▸'));
        this.button.accessible_name = this.title + (open ? ' 접기' : ' 펼치기');
        this.changed?.(open);
    }
    setSensitive(enabled: boolean): void {
        this.button.reactive = enabled;
        this.button.can_focus = enabled;
        this.button.opacity = enabled ? 255 : 128;
        if (!enabled) this.close();
    }
    setVisible(visible: boolean): void { if (!visible) this.close(); this.item.visible = visible; }
    destroy(): void { this.button.disconnect(this.signal); }
}

function note(menu: SectionParent, value: string): PopupMenu.PopupMenuItem {
    const row = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
    row.label.clutter_text.use_markup = false;
    row.label.clutter_text.line_wrap = true;
    row.label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    row.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    row.label.set_style('max-width: 280px;');
    row.label.set_text(plainText(value, 160));
    row.label.add_style_class_name('usagescope-note');
    menu.addMenuItem(row);
    return row;
}

export class UsageIndicator {
    readonly button = new PanelMenu.Button(0.5, 'UsageScope');
    private panelLabel = new St.Label({text: 'UsageScope', y_align: Clutter.ActorAlign.CENTER});
    private cards: Record<ProviderId, ProviderCard>;
    private toggles: Record<ProviderId, PopupMenu.PopupSwitchMenuItem>;
    private claudeCliMode: PopupMenu.PopupSwitchMenuItem;
    private scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true, style_class: 'usagescope-scroll'});
    private sources: Disclosure;
    private passiveSetup: Disclosure;
    private connection: Disclosure;
    private polling: Disclosure;
    private sourceSignature = '';
    private menuSignal: number;
    private settingsMenu: PopupMenu.PopupSubMenu;
    private settingsSignal: number;
    private pathEntry: St.Entry;
    private settingsPath: string | null = null;
    private pollLabel: PopupMenu.PopupMenuItem;
    private scrollIdle = 0;
    private adjustmentSignal: number;
    private refresh: PopupMenu.PopupMenuItem;
    private connect: PopupMenu.PopupMenuItem;
    private cancel: PopupMenu.PopupMenuItem;

    constructor(private actions: IndicatorActions, extensionPath: string) {
        this.button.add_child(this.panelLabel);
        if (!(this.button.menu instanceof PopupMenu.PopupMenu)) throw new Error('UsageScope menu unavailable');
        const menu = this.button.menu;
        menu.actor.add_style_class_name('usagescope-menu');
        const parent = menu.box.get_parent();
        if (!(parent instanceof St.Bin)) throw new Error('Unsupported GNOME popup container');
        parent.set_child(null);
        this.scroll.set_child(menu.box);
        parent.set_child(this.scroll);
        const openWebsite = (provider: ProviderId) => { actions.openWebsite(provider); menu.close(); };
        this.cards = {codex: new ProviderCard('codex', openWebsite), claude: new ProviderCard('claude', openWebsite)};
        menu.addMenuItem(this.cards.codex.item);
        menu.addMenuItem(this.cards.claude.item);

        const settings = new PopupMenu.PopupSubMenuMenuItem('설정');
        this.settingsMenu = settings.menu;
        this.settingsSignal = settings.menu.connect('open-state-changed', (_menu, open: boolean) => {
            for (const provider of ['codex', 'claude'] as const) this.cards[provider].item.visible = !open;
            if (!open) { this.connection.close(); this.polling.close(); }
        });
        const codex = new PopupMenu.PopupSwitchMenuItem('ChatGPT 모니터링', false);
        const claude = new PopupMenu.PopupSwitchMenuItem('Claude 모니터링', false);
        this.toggles = {codex, claude};
        for (const provider of ['codex', 'claude'] as const) {
            this.toggles[provider].connect('toggled', (_item, state: boolean) => actions.setEnabled(provider, state));
            settings.menu.addMenuItem(this.toggles[provider]);
        }
        this.claudeCliMode = new PopupMenu.PopupSwitchMenuItem('Claude CLI 조회 (실험)', false);
        this.claudeCliMode.connect('toggled', (_item, state: boolean) => actions.setClaudeCliMode(state));
        settings.menu.addMenuItem(this.claudeCliMode);
        this.refresh = new PopupMenu.PopupMenuItem('Refresh');
        this.refresh.connect('activate', () => { actions.refreshCodex(); actions.refreshClaude(); });
        settings.menu.addMenuItem(this.refresh);
        note(settings.menu, '잔여 30% 이하 알림');

        this.connection = new Disclosure(settings.menu, 'CLI 연결 및 설정', open => {
            if (open) this.polling.close();
            else { this.passiveSetup.close(); this.sources.close(); }
        });
        const connection = this.connection.section;
        note(connection, '웹 로그인과 CLI 연결은 별개');
        this.connect = new PopupMenu.PopupMenuItem('Codex CLI 로그인 연결…');
        this.connect.connect('activate', () => actions.connectCodex());
        connection.addMenuItem(this.connect);
        this.cancel = new PopupMenu.PopupMenuItem('Codex 로그인 취소');
        this.cancel.connect('activate', () => actions.cancelLogin());
        connection.addMenuItem(this.cancel);
        note(connection, 'Claude 로그인은 CLI에서 진행');
        this.passiveSetup = new Disclosure(connection, 'Claude 상태줄 연결', open => { if (open) this.sources.close(); });
        const [preview, apply] = setupCommands(extensionPath);
        for (const [label, command] of [['Claude 미리보기 명령 복사', preview], ['Claude 적용 명령 복사', apply]]) {
            const row = new PopupMenu.PopupMenuItem(label);
            row.connect('activate', () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, command));
            this.passiveSetup.section.addMenuItem(row);
        }
        note(this.passiveSetup.section, '일반 터미널에 붙여넣기');
        this.sources = new Disclosure(connection, 'Claude 세션 선택', open => { if (open) this.passiveSetup.close(); });
        note(connection, 'Codex 경로 · 비우면 자동 검색');
        const pathRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.pathEntry = new St.Entry({hint_text: 'Codex 실행 파일의 절대 경로', can_focus: true, x_expand: true,
            style_class: 'usagescope-path', accessible_name: 'Codex CLI 실행 경로'});
        this.pathEntry.clutter_text.set_max_length(4096);
        pathRow.add_child(this.pathEntry);
        connection.addMenuItem(pathRow);
        const save = new PopupMenu.PopupMenuItem('실행 경로 저장');
        const applyPath = () => actions.setCodexPath(this.pathEntry.get_text());
        save.connect('activate', applyPath);
        this.pathEntry.clutter_text.connect('activate', applyPath);
        connection.addMenuItem(save);
        let defaultRow: PopupMenu.PopupMenuItem | null = null;
        const revealDefault = () => {
            if (this.scrollIdle) { GLib.Source.remove(this.scrollIdle); this.scrollIdle = 0; }
            this.scrollIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.scrollIdle = 0;
                if (menu.isOpen && this.polling.isOpen && defaultRow?.mapped)
                    ensureActorVisibleInScrollView(this.scroll, defaultRow);
                return GLib.SOURCE_REMOVE;
            });
        };
        this.polling = new Disclosure(settings.menu, '조회 간격', open => {
            if (this.scrollIdle) { GLib.Source.remove(this.scrollIdle); this.scrollIdle = 0; }
            if (!open) return;
            this.connection.close();
            revealDefault();
        });
        this.pollLabel = note(this.polling.section, '');
        for (const seconds of POLL_INTERVALS) {
            const row = new PopupMenu.PopupMenuItem(intervalLabel(seconds) + (seconds === DEFAULT_POLL_SECONDS ? ' (기본)' : ''));
            if (seconds === DEFAULT_POLL_SECONDS) defaultRow = row;
            row.connect('activate', () => actions.setPollSeconds(seconds));
            this.polling.section.addMenuItem(row);
        }
        this.adjustmentSignal = this.scroll.vadjustment.connect('notify::upper', () => {
            if (this.polling.isOpen) revealDefault();
        });
        menu.addMenuItem(settings);
        this.menuSignal = menu.connect('open-state-changed', (_menu, open: boolean) => {
            if (open) {
                const monitor = Main.layoutManager.findMonitorForActor(this.button) ?? Main.layoutManager.primaryMonitor;
                const height = Math.max(140, Math.min(460, (monitor?.height ?? 720) - 100));
                this.scroll.set_style('max-height: ' + height + 'px;');
            }
            actions.menuStateChanged(open);
        });
    }

    update(views: Record<ProviderId, ProviderView>, enabled: Record<ProviderId, boolean>,
        busy: Record<ProviderId, boolean>, login: boolean, now = Date.now(), updateDetails = true): void {
        const text = (['codex', 'claude'] as const).filter(provider => enabled[provider])
            .map(provider => (provider === 'codex' ? 'ChatGPT ' : 'Claude ') + panelText(views[provider], now)).join(' · ') || 'UsageScope';
        const bounded = plainText(text, 180);
        if (this.panelLabel.get_text() !== bounded) this.panelLabel.set_text(bounded);
        this.button.accessible_name = 'UsageScope · ' + bounded;
        if (!updateDetails) return;
        for (const provider of ['codex', 'claude'] as const) {
            this.cards[provider].update(views[provider], now);
            this.toggles[provider].setToggleState(enabled[provider]);
        }
        this.refresh.setSensitive(!busy.codex && !busy.claude && !login && (enabled.codex || enabled.claude));
        this.connect.setSensitive(enabled.codex && !busy.codex && !login);
        this.cancel.visible = login;
    }
    setSources(ids: string[], selected: string | null): void {
        const bounded = ids.slice(0, 16);
        const signature = JSON.stringify([bounded, selected]);
        if (signature === this.sourceSignature) return;
        this.sourceSignature = signature;
        this.sources.section.removeAll();
        const auto = new PopupMenu.PopupMenuItem('선택 해제');
        auto.connect('activate', () => this.actions.selectClaudeSource(null));
        this.sources.section.addMenuItem(auto);
        for (const id of bounded) {
            const row = new PopupMenu.PopupMenuItem(sourceLabel(id));
            row.label.clutter_text.use_markup = false;
            row.setOrnament(selected === id ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            row.connect('activate', () => this.actions.selectClaudeSource(id));
            this.sources.section.addMenuItem(row);
        }
        if (!bounded.length) note(this.sources.section, '아직 보고된 세션이 없습니다.');
    }
    setSettings(seconds: number, path: string, claudeCliMode = false): void {
        this.claudeCliMode.setToggleState(claudeCliMode);
        this.sources.setSensitive(!claudeCliMode);
        this.passiveSetup.setVisible(!claudeCliMode);
        if (claudeCliMode) {
            this.sources.close();
            this.passiveSetup.close();
        }
        this.pollLabel.label.set_text(claudeCliMode ? 'CLI 조회 ' + intervalLabel(seconds)
            : 'Codex ' + intervalLabel(seconds) + ' · Claude 보고 시 갱신');
        if (path !== this.settingsPath) { this.pathEntry.set_text(path); this.settingsPath = path; }
    }
    destroy(): void {
        if (this.scrollIdle) { GLib.Source.remove(this.scrollIdle); this.scrollIdle = 0; }
        this.scroll.vadjustment.disconnect(this.adjustmentSignal);
        for (const disclosure of [this.sources, this.passiveSetup, this.connection, this.polling]) disclosure.destroy();
        this.settingsMenu.disconnect(this.settingsSignal);
        this.button.menu.disconnect(this.menuSignal);
        this.button.destroy();
    }
}
