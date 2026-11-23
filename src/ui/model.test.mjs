import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LowQuotaAlerts, nextUiDeadline, plainText, receiptAge, quotaRows, cardStatus, resetCountdown} from '../../build/ui/model.js';
import {panelText} from '../../build/core/format.js';
import {parseClaudeCliUsage} from '../../build/core/normalize.js';
import {ProviderState} from '../../build/core/state.js';

const now = 1_800_000_000_000;
function sample(remaining, sequence, changes = {}) {
    return {status: 'ready', message: '', snapshot: {
        provider: 'codex', sourceId: 'source-a', accountId: 'account-a',
        receivedAt: now + sequence, allowed: true,
        windows: [{id: 'quota', label: '5h', durationSeconds: 18000,
            usedPercent: 100 - remaining, resetsAt: now / 1000 + 3600}], ...changes,
    }};
}

test('Codex alerts at 30 once, then rearm only at 35', () => {
    const alerts = new LowQuotaAlerts();
    assert.equal(alerts.observe(sample(40, 1), now).length, 0);
    assert.equal(alerts.observe(sample(30, 2), now).length, 1);
    assert.equal(alerts.observe(sample(29, 3), now).length, 0);
    assert.equal(alerts.observe(sample(29, 3), now).length, 0);
    assert.equal(alerts.observe(sample(34, 4), now).length, 0);
    assert.equal(alerts.observe(sample(29, 5), now).length, 0);
    assert.equal(alerts.observe(sample(35, 6), now).length, 0);
    assert.equal(alerts.observe(sample(0, 7), now).length, 1);
});
test('Claude reported-value alerts use independent source baseline at 30%',()=>{
 const alerts=new LowQuotaAlerts('claude');
 assert.equal(alerts.observe(sample(45,1,{provider:'claude'}),now).length,0);
 assert.equal(alerts.observe(sample(30,2,{provider:'claude'}),now).length,1);
 assert.equal(alerts.observe(sample(29,3,{provider:'claude'}),now).length,0);
 assert.equal(alerts.observe(sample(10,4,{provider:'claude',sourceId:'other'}),now).length,0);
});
test('both providers suppress an initial 30% report until recovery rearms the alert', () => {
    for (const provider of ['codex', 'claude']) {
        const alerts = new LowQuotaAlerts(provider);
        const report = (remaining, sequence) => sample(remaining, sequence, {provider});
        assert.equal(alerts.observe(report(30, 1), now).length, 0);
        assert.equal(alerts.observe(report(29, 2), now).length, 0);
        assert.equal(alerts.observe(report(34, 3), now).length, 0);
        assert.equal(alerts.observe(report(30, 4), now).length, 0);
        assert.equal(alerts.observe(report(35, 5), now).length, 0);
        assert.equal(alerts.observe(report(30, 6), now).length, 1);
        assert.equal(alerts.observe(report(29, 7), now).length, 0);
    }
});
test('bar rows show actual remaining fraction, 30 is red, expired data is neutral',()=>{
 const row=quotaRows(sample(30,1),now)[0];
 assert.equal(row.remainingPercent,30);assert.equal(row.usedPercent,70);assert.equal(row.fraction,0.3);assert.equal(row.tone,'danger');
 assert.equal(quotaRows(sample(80,1),now)[0].tone,'codex');
 assert.equal(quotaRows(sample(80,1,{provider:'claude'}),now)[0].tone,'claude');
 const old=sample(10,1);old.snapshot.windows[0].resetsAt=now/1000;
 assert.equal(quotaRows(old,now)[0].remainingPercent,null);assert.equal(quotaRows(old,now)[0].tone,'muted');
 assert.deepEqual(quotaRows({status:'disabled',snapshot:null,message:''},now),[]);
});
test('many quota buckets cannot inflate the compact two-row card',()=>{
 const v=sample(50,1);v.snapshot.windows=Array.from({length:15},(_,i)=>({...v.snapshot.windows[0],id:'quota:'+i}));
 assert.equal(quotaRows(v,now).length,2);
});
test('compact status keeps server-reported restriction visible',()=>{
 assert.match(cardStatus(sample(80,1,{allowed:false}),now),/사용 제한/);
});

test('snapshots without quota windows report missing limits for both providers, even with tier metadata', () => {
    for (const provider of ['codex', 'claude']) for (const planType of [null, 'pro', 'max']) {
        const view = sample(50, 1, {provider, planType, windows: []});
        assert.equal(cardStatus(view, now), '한도 정보 미제공');
        assert.equal(cardStatus({...view, status: 'waiting'}, now), '한도 정보 미제공');
        assert.deepEqual(quotaRows(view, now), []);
    }
});

test('Claude CLI missing quotas reach the card through the actual waiting provider state', () => {
    const snapshot = parseClaudeCliUsage({
        rate_limits_available: false, rate_limits: null, subscription_type: 'team',
    }, 'cli-test', now);
    const view = new ProviderState().accept(snapshot);
    assert.equal(view.status, 'waiting');
    assert.equal(view.snapshot.planType, 'team');
    assert.equal(cardStatus(view, now), '한도 정보 미제공');
    assert.deepEqual(quotaRows(view, now), []);
});

test('both providers label polled quota the same way, keeping loading and failure history', () => {
    for (const provider of ['codex', 'claude']) {
        assert.equal(cardStatus(sample(50, 1, {provider}), now), '업데이트 · 방금');
        assert.equal(cardStatus({...sample(50, 1, {provider}), status: 'error'}, now), '이전 조회 · 방금');
        assert.equal(panelText(sample(50, 1, {provider}), now), '5h 50%');
        assert.equal(panelText({...sample(50, 1, {provider}), status: 'error'}, now), '~5h 50%');
    }
    const state = new ProviderState();
    state.accept(parseClaudeCliUsage({
        rate_limits_available: true, rate_limits: {five_hour: {utilization: 40, resets_at: null}}, subscription_type: 'team',
    }, 'cli-test', now - 60_000));
    assert.equal(cardStatus(state.loading(), now), '이전 조회 · 1분 전');
    for (const status of ['error', 'unavailable']) {
        assert.equal(cardStatus(state.fail('Unavailable', status), now), '이전 조회 · 1분 전');
    }
    assert.equal(cardStatus(state.fail('Signed out', 'auth-required'), now), 'CLI 로그인 필요 · 1분 전');
});

test('cards without usage point at the CLI action instead of removed settings', () => {
    const empty = status => ({status, snapshot: null, message: ''});
    assert.equal(cardStatus(empty('auth-required'), now), '터미널에서 CLI 로그인 필요');
    assert.equal(cardStatus(empty('unavailable'), now), '공식 CLI를 찾을 수 없음');
    assert.equal(cardStatus(empty('error'), now), '조회 실패 · CLI 로그인 확인');
    assert.equal(cardStatus(empty('loading'), now), '확인 중…');
    assert.equal(cardStatus(empty('waiting'), now), '조회 대기');
    assert.equal(cardStatus(empty('disabled'), now), '모니터링 꺼짐');
});

test('initial low sample, wrong provider, reset and source changes never alert', () => {
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
    const claude = {codex: {...sample(50, 0), snapshot: null}, claude: sample(50, 0, {provider: 'claude'})};
    claude.claude.snapshot.windows[0].resetsAt = null;
    assert.equal(nextUiDeadline(claude, {codex: false, claude: true}, false, now), now + 360_001);
});

test('reset countdown rounds down and never shows time after the reset', () => {
    const at = seconds => now / 1000 + seconds;
    assert.equal(resetCountdown(null, now), '');
    assert.equal(resetCountdown(at(0), now), '');
    assert.equal(resetCountdown(at(-60), now), '');
    assert.equal(resetCountdown(at(59), now), '<1m');
    assert.equal(resetCountdown(at(60), now), '1m');
    assert.equal(resetCountdown(at(3599), now), '59m');
    assert.equal(resetCountdown(at(3600), now), '1h');
    assert.equal(resetCountdown(at(4 * 3600 + 30 * 60 + 59), now), '4h 30m');
    assert.equal(resetCountdown(at(86400), now), '1d');
    assert.equal(resetCountdown(at(3 * 86400 + 2 * 3600 + 59 * 60), now), '3d 2h');
    assert.equal(resetCountdown(at(6 * 86400 + 23 * 3600 + 59 * 60), now), '6d 23h');
});
test('both providers expose the countdown on quota rows, but not for unknown or expired resets', () => {
    for (const [provider, id] of [['codex', 'codex:primary'], ['claude', 'claude-cli:five_hour']]) {
        const view = sample(60, 1, {provider});
        view.snapshot.windows[0].id = id;
        view.snapshot.windows[0].resetsAt = now / 1000 + 4 * 3600 + 30 * 60;
        assert.equal(quotaRows(view, now)[0].resetIn, '4h 30m');
        view.snapshot.windows[0].resetsAt = null;
        assert.equal(quotaRows(view, now)[0].resetIn, '');
        view.snapshot.windows[0].resetsAt = now / 1000;
        assert.equal(quotaRows(view, now)[0].resetIn, '');
    }
});
