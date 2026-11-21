import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LowQuotaAlerts, nextUiDeadline, plainText, receiptAge, setupCommands, sourceLabel} from './model.ts';

const now = 1_800_000_000_000;
function sample(remaining, sequence, changes = {}) {
    return {status: 'ready', message: '', snapshot: {
        provider: 'codex', sourceId: 'source-a', accountId: 'account-a',
        receivedAt: now + sequence, allowed: true,
        windows: [{id: 'quota', label: '5h', durationSeconds: 18000,
            usedPercent: 100 - remaining, resetsAt: now / 1000 + 3600}], ...changes,
    }};
}

test('Codex alerts only cross below 20, then rearm at 25', () => {
    const alerts = new LowQuotaAlerts();
    assert.equal(alerts.observe(sample(30, 1), now).length, 0);
    assert.equal(alerts.observe(sample(20, 2), now).length, 0);
    assert.equal(alerts.observe(sample(19, 3), now).length, 1);
    assert.equal(alerts.observe(sample(19, 3), now).length, 0);
    assert.equal(alerts.observe(sample(24, 4), now).length, 0);
    assert.equal(alerts.observe(sample(19, 5), now).length, 0);
    assert.equal(alerts.observe(sample(25, 6), now).length, 0);
    assert.equal(alerts.observe(sample(0, 7), now).length, 1);
});

test('initial low sample, Claude, reset and source changes never alert', () => {
    const alerts = new LowQuotaAlerts();
    assert.equal(alerts.observe(sample(10, 1), now).length, 0);
    assert.equal(alerts.observe(sample(24, 2), now).length, 0);
    assert.equal(alerts.observe(sample(19, 3), now).length, 0);
    alerts.observe(sample(50, 4), now);
    const reset = sample(10, 5);
    reset.snapshot.windows[0].resetsAt += 3600;
    assert.equal(alerts.observe(reset, now).length, 0);
    assert.equal(alerts.observe(sample(10, 6, {sourceId: 'source-b'}), now).length, 0);
    alerts.observe(sample(50, 7, {sourceId: 'source-b'}), now);
    assert.equal(alerts.observe(sample(10, 8, {provider: 'claude', sourceId: 'source-b'}), now).length, 0);
});
test('cleared account state resets alert baseline even when account ID is unknown',()=>{
 const alerts=new LowQuotaAlerts();
 alerts.observe(sample(50,1,{accountId:null}),now);
 alerts.observe({status:'waiting',snapshot:null,message:''},now);
 assert.equal(alerts.observe(sample(10,2,{accountId:null}),now).length,0);
});

test('expired, historical, repeated and out of order samples cannot alert', () => {
    const alerts = new LowQuotaAlerts();
    alerts.observe(sample(50, 10), now);
    assert.equal(alerts.observe(sample(10, 9), now).length, 0);
    assert.equal(alerts.observe({...sample(10, 11), status: 'error'}, now).length, 0);
    const expired = sample(10, 12);
    expired.snapshot.windows[0].resetsAt = now / 1000;
    assert.equal(alerts.observe(expired, now).length, 0);
    alerts.clear();
    assert.equal(alerts.observe(sample(0, 13), now).length, 0);
});

test('receipt ages use epoch milliseconds; text is bounded and stays plain', () => {
    assert.equal(receiptAge(now - 60_000, now), '1m ago');
    assert.equal(receiptAge(now - 7_200_000, now), '2h ago');
    assert.equal(receiptAge(now + 1000, now), 'just now');
    assert.equal(plainText('a\n\u202eb\u0000c', 5), 'a b c');
    assert.equal(plainText('<b>quota</b>'), '<b>quota</b>');
    assert.equal(plainText('x'.repeat(1000), 20).length, 20);
});

test('setup commands only describe preview/apply, with quoted extension paths', () => {
    const commands = setupCommands('/tmp/a b');
    assert.deepEqual(commands, [
        "gjs -m '/tmp/a b/claude/setup.js' --preview",
        "gjs -m '/tmp/a b/claude/setup.js' --apply",
    ]);
    assert.equal(setupCommands("/tmp/a'b")[0], "gjs -m '/tmp/a'\\''b/claude/setup.js' --preview");
    assert.equal(sourceLabel('0123456789abcdef0123456789abcdef'), '0123456789ab…abcdef');
});

test('UI clock is idle when disabled and schedules closed-panel freshness and expiry only', () => {
    const views = {codex: sample(50, 0), claude: {...sample(50, 0), snapshot: null}};
    assert.equal(nextUiDeadline(views, {codex: false, claude: false}, true, now), null);
    assert.equal(nextUiDeadline(views, {codex: true, claude: false}, false, now), now + 360_001);
    assert.equal(nextUiDeadline(views, {codex: true, claude: false}, true, now), now + 30_000);
    views.codex.snapshot.windows[0].resetsAt = now / 1000 + 10;
    assert.equal(nextUiDeadline(views, {codex: true, claude: false}, false, now), now + 10_000);
    views.codex.snapshot.receivedAt = now - 400_000;
    views.codex.snapshot.windows[0].resetsAt = now / 1000;
    assert.equal(nextUiDeadline(views, {codex: true, claude: false}, false, now), null);
});
