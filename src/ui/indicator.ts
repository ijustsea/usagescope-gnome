import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {panelText} from '../core/format.js';
import type {ProviderId, ProviderView} from '../core/types.js';
import {plainText} from './model.js';
import {ProviderCard} from './card.js';
import {DEFAULT_POLL_SECONDS, POLL_INTERVALS} from '../core/polling.js';

function intervalLabel(seconds: number): string {
    return seconds < 60 ? seconds + '초' : seconds < 3600 ? seconds / 60 + '분' : seconds / 3600 + '시간';
}

export interface IndicatorActions {
    setEnabled(provider: ProviderId, enabled: boolean): void;
    openWebsite(provider: ProviderId): void;
    refresh(): void;
    setPollSeconds(seconds: number): void;
    menuStateChanged(open: boolean): void;
}

type SectionParent = PopupMenu.PopupSubMenu | PopupMenu.PopupMenuSection;

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
    private scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true, style_class: 'usagescope-scroll'});
    private menuSignal: number;
    private settingsMenu: PopupMenu.PopupSubMenu;
    private settingsSignal: number;
    private intervals = new Map<number, St.Button>();
    private refresh: PopupMenu.PopupMenuItem;

    constructor(actions: IndicatorActions) {
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
        });
        const codex = new PopupMenu.PopupSwitchMenuItem('ChatGPT 모니터링', false);
        const claude = new PopupMenu.PopupSwitchMenuItem('Claude 모니터링', false);
        this.toggles = {codex, claude};
        for (const provider of ['codex', 'claude'] as const) {
            this.toggles[provider].connect('toggled', (_item, state: boolean) => actions.setEnabled(provider, state));
            settings.menu.addMenuItem(this.toggles[provider]);
        }
        this.refresh = new PopupMenu.PopupMenuItem('Refresh');
        this.refresh.connect('activate', () => actions.refresh());
        settings.menu.addMenuItem(this.refresh);
        note(settings.menu, '잔여 30% 이하 알림');

        // One row of choices instead of an expandable list keeps Settings unclipped without scrolling.
        note(settings.menu, '조회 간격 · 기본 ' + intervalLabel(DEFAULT_POLL_SECONDS));
        const intervalRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const choices = new St.BoxLayout({x_expand: true, style_class: 'usagescope-intervals'});
        for (const seconds of POLL_INTERVALS) {
            const choice = new St.Button({label: intervalLabel(seconds), can_focus: true, x_expand: true,
                style_class: 'usagescope-interval', accessible_name: 'CLI 조회 간격 ' + intervalLabel(seconds)});
            choice.connect('clicked', () => actions.setPollSeconds(seconds));
            choices.add_child(choice);
            this.intervals.set(seconds, choice);
        }
        intervalRow.add_child(choices);
        settings.menu.addMenuItem(intervalRow);
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
        busy: Record<ProviderId, boolean>, now = Date.now(), updateDetails = true): void {
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
        this.refresh.setSensitive(!busy.codex && !busy.claude && (enabled.codex || enabled.claude));
    }
    setPollSeconds(seconds: number): void {
        for (const [value, choice] of this.intervals) choice.checked = value === seconds;
    }
    destroy(): void {
        this.settingsMenu.disconnect(this.settingsSignal);
        this.button.menu.disconnect(this.menuSignal);
        this.button.destroy();
    }
}
