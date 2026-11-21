import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {panelText} from '../core/format.js';
import type {ProviderId, ProviderView} from '../core/types.js';
import {plainText, setupCommands, sourceLabel} from './model.js';
import {ProviderCard} from './card.js';

export interface IndicatorActions {
    setEnabled(provider: ProviderId, enabled: boolean): void;
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

function note(menu: PopupMenu.PopupSubMenu, value: string): PopupMenu.PopupMenuItem {
    const row = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
    row.label.clutter_text.use_markup = false;
    row.label.clutter_text.line_wrap = true;
    row.label.set_text(plainText(value, 2048));
    row.label.add_style_class_name('usagescope-note');
    menu.addMenuItem(row);
    return row;
}

export class UsageIndicator {
    readonly button = new PanelMenu.Button(0.5, 'UsageScope');
    private panelLabel = new St.Label({text: 'UsageScope', y_align: Clutter.ActorAlign.CENTER});
    private cards: Record<ProviderId, ProviderCard>;
    private toggles: Record<ProviderId, PopupMenu.PopupSwitchMenuItem>;
    private scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true, style_class: 'usagescope-scroll'});
    private sources: PopupMenu.PopupSubMenuMenuItem;
    private sourceSignature = '';
    private menuSignal: number;
    private pathEntry: St.Entry;
    private settingsPath: string | null = null;
    private pollLabel: PopupMenu.PopupMenuItem;
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
        const codex = new PopupMenu.PopupSwitchMenuItem('ChatGPT 모니터링', false);
        const claude = new PopupMenu.PopupSwitchMenuItem('Claude 모니터링', false);
        this.toggles = {codex, claude};
        for (const provider of ['codex', 'claude'] as const) {
            this.toggles[provider].connect('toggled', (_item, state: boolean) => actions.setEnabled(provider, state));
            settings.menu.addMenuItem(this.toggles[provider]);
        }
        this.refresh = new PopupMenu.PopupMenuItem('사용량 새로 확인');
        this.refresh.connect('activate', () => { actions.refreshCodex(); actions.refreshClaude(); });
        settings.menu.addMenuItem(this.refresh);
        note(settings.menu, '빨간 막대: 잔여 30% 이하 · 알림: 30% 아래로 내려갈 때 한 번');
        note(settings.menu, '웹 로그인과 로컬 CLI 연결은 별개입니다. Claude는 마지막 보고값입니다.');

        const connection = new PopupMenu.PopupSubMenuMenuItem('CLI 연결 및 설정');
        this.connect = new PopupMenu.PopupMenuItem('Codex CLI 로그인 연결…');
        this.connect.connect('activate', () => actions.connectCodex());
        connection.menu.addMenuItem(this.connect);
        this.cancel = new PopupMenu.PopupMenuItem('Codex 로그인 취소');
        this.cancel.connect('activate', () => actions.cancelLogin());
        connection.menu.addMenuItem(this.cancel);
        note(connection.menu, 'Claude 공식 로그인: claude auth login');
        const [preview, apply] = setupCommands(extensionPath);
        note(connection.menu, 'Claude 전달 설정 미리보기: ' + preview);
        note(connection.menu, '검토 후 적용: ' + apply);
        this.sources = new PopupMenu.PopupSubMenuMenuItem('Claude 세션 선택');
        connection.menu.addMenuItem(this.sources);
        note(connection.menu, 'CLI 경로 (비우면 codex 자동 검색):');
        const pathRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this.pathEntry = new St.Entry({hint_text: 'Codex 실행 파일의 절대 경로', can_focus: true, x_expand: true,
            style_class: 'usagescope-path', accessible_name: 'Codex CLI 실행 경로'});
        this.pathEntry.clutter_text.set_max_length(4096);
        pathRow.add_child(this.pathEntry);
        connection.menu.addMenuItem(pathRow);
        const save = new PopupMenu.PopupMenuItem('실행 경로 저장');
        const applyPath = () => actions.setCodexPath(this.pathEntry.get_text());
        save.connect('activate', applyPath);
        this.pathEntry.clutter_text.connect('activate', applyPath);
        connection.menu.addMenuItem(save);
        settings.menu.addMenuItem(connection);
        const polling = new PopupMenu.PopupSubMenuMenuItem('조회 간격');
        this.pollLabel = note(polling.menu, '');
        for (const seconds of [60, 180, 300, 900, 3600]) {
            const row = new PopupMenu.PopupMenuItem(seconds / 60 + '분');
            row.connect('activate', () => actions.setPollSeconds(seconds));
            polling.menu.addMenuItem(row);
        }
        settings.menu.addMenuItem(polling);
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
        this.sources.menu.removeAll();
        const auto = new PopupMenu.PopupMenuItem('선택 해제');
        auto.connect('activate', () => this.actions.selectClaudeSource(null));
        this.sources.menu.addMenuItem(auto);
        for (const id of bounded) {
            const row = new PopupMenu.PopupMenuItem(sourceLabel(id));
            row.label.clutter_text.use_markup = false;
            row.setOrnament(selected === id ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            row.connect('activate', () => this.actions.selectClaudeSource(id));
            this.sources.menu.addMenuItem(row);
        }
        if (!bounded.length) note(this.sources.menu, '아직 보고된 세션이 없습니다.');
    }
    setSettings(seconds: number, path: string): void {
        this.pollLabel.label.set_text('현재 ' + seconds / 60 + '분 · Claude는 보고 시 갱신');
        if (path !== this.settingsPath) { this.pathEntry.set_text(path); this.settingsPath = path; }
    }
    destroy(): void {
        this.button.menu.disconnect(this.menuSignal);
        this.button.destroy();
    }
}
