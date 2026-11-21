import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import type {ProviderId, ProviderView} from '../core/types.js';
import {planName} from '../core/subscription.js';
import {cardStatus, plainText, quotaRows, type QuotaRow} from './model.js';

function label(text = '', style = ''): St.Label {
    const actor = new St.Label({text, style_class: style});
    actor.clutter_text.use_markup = false;
    return actor;
}
function text(actor: St.Label, value: string): void {
    const safe = plainText(value, 160);
    if (actor.get_text() !== safe) actor.set_text(safe);
}

class QuotaBar {
    readonly box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'usagescope-quota'});
    private name = label('', 'usagescope-period');
    private amount = label('', 'usagescope-amount');
    private track = new St.Widget({style_class: 'usagescope-track', x_expand: true,
        min_width: 0, natural_width: 0, layout_manager: new Clutter.FixedLayout()});
    private fill = new St.Widget({style_class: 'usagescope-fill', x_align: Clutter.ActorAlign.START});
    private fraction = 0;

    constructor() {
        const line = new St.BoxLayout({style_class: 'usagescope-quota-line'});
        line.add_child(this.name);
        line.add_child(new St.Widget({x_expand: true}));
        line.add_child(this.amount);
        this.fill.set_position(0, 0);
        this.track.add_child(this.fill);
        this.track.connect('notify::allocation', () => this.sizeFill());
        this.box.add_child(line);
        this.box.add_child(this.track);
        this.box.hide();
    }
    private sizeFill(): void {
        const width = Math.max(0, Math.round(this.track.get_width() * this.fraction));
        if (this.fill.width !== width) this.fill.set_width(width);
    }
    update(row: QuotaRow | undefined): void {
        this.box.visible = !!row; // Hide the whole layout row, never just its label.
        if (!row) return;
        this.fraction = row.fraction;
        text(this.name, row.label);
        text(this.amount, row.remainingPercent === null ? '확인 필요'
            : '잔여 ' + Math.round(row.remainingPercent) + '% · 사용 ' + Math.round(row.usedPercent!) + '%');
        const style = 'usagescope-fill usagescope-fill-' + row.tone;
        if (this.fill.style_class !== style) this.fill.style_class = style;
        this.box.accessible_name = row.remainingPercent === null ? row.label + ' 만료: 새 확인 필요'
            : row.label + ' 잔여 ' + Math.round(row.remainingPercent) + '퍼센트, 사용 ' + Math.round(row.usedPercent!) + '퍼센트. ' + row.resetLabel;
        this.sizeFill();
    }
}

export class ProviderCard {
    readonly item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, style_class: 'usagescope-card-row'});
    private plan = label('구독 미확인', 'usagescope-plan');
    private status = label('', 'usagescope-status');
    private bars = [new QuotaBar(), new QuotaBar()];
    private body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'usagescope-card'});

    constructor(private provider: ProviderId, openWebsite: (provider: ProviderId) => void) {
        const name = provider === 'codex' ? 'ChatGPT' : 'Claude';
        const header = new St.BoxLayout({style_class: 'usagescope-card-header'});
        header.add_child(label(name, 'usagescope-title'));
        header.add_child(new St.Widget({x_expand: true}));
        header.add_child(this.plan);
        this.body.add_child(header);
        for (const bar of this.bars) this.body.add_child(bar.box);
        const footer = new St.BoxLayout({style_class: 'usagescope-card-footer', y_align: Clutter.ActorAlign.CENTER});
        footer.add_child(this.status);
        footer.add_child(new St.Widget({x_expand: true}));
        const link = new St.Button({label: '로그인 / 가입 ↗', style_class: 'usagescope-link', can_focus: true,
            accessible_name: name + ' 공식 웹사이트 로그인 및 가입'});
        link.connect('clicked', () => openWebsite(provider));
        footer.add_child(link);
        this.body.add_child(footer);
        this.item.add_child(this.body);
    }

    update(view: ProviderView, now: number): void {
        text(this.plan, planName(this.provider, view.snapshot?.planType) ?? '구독 미확인');
        text(this.status, cardStatus(view, now));
        const rows = quotaRows(view, now);
        for (let index = 0; index < this.bars.length; index++) this.bars[index]!.update(rows[index]);
        const historical = view.status !== 'ready' || (view.snapshot && now - view.snapshot.receivedAt > 360_000);
        this.body.opacity = historical && view.snapshot ? 185 : 255;
    }
}
