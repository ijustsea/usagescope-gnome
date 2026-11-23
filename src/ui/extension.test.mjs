import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {stripTypeScriptTypes} from 'node:module';
import {nextUiDeadline} from '../../build/ui/model.js';
import {websiteUrl} from '../../build/core/policy.js';

// Exercise the extension's actual orchestration. Only Shell actors, settings and
// provider I/O are replaced; the isolated Shell smoke covers real actor teardown.
const emitted = stripTypeScriptTypes(readFileSync(new URL('../extension.ts', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replace('export default class', 'return class');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
    const h = {timers: new Set(), codex: [], claude: [], claudeCli: [], launches: [], sourceIds: ['a'.repeat(64), 'b'.repeat(64)]};
    const values = {'enable-codex': false, 'enable-claude': false, 'codex-path': '', 'claude-path': '', 'claude-cli-mode': false, 'poll-seconds': 60};
    const settings = {
        connect(_signal, callback) {this.changed = callback; return 1;},
        disconnect() {this.changed = null;},
        get_boolean: key => values[key], get_string: key => values[key], get_int: key => values[key],
        set_boolean(key, value) {values[key] = value; this.changed?.(this, key);},
        set_string(key, value) {values[key] = value; this.changed?.(this, key);},
        set_int(key, value) {values[key] = value; this.changed?.(this, key);},
    };
    class Base {uuid = 'test@local'; path = '/tmp/test-extension'; getSettings() {return settings;}}
    class Indicator {
        button = {};
        constructor(actions) {h.actions = actions; h.indicator = this;}
        update(views, enabled, busy, login) {h.state = JSON.parse(JSON.stringify({views, enabled, busy, login}));}
        setSettings() {}
        setSources(ids, selected) {h.sources = {ids, selected};}
        destroy() {h.destroyed = true;}
    }
    class Codex {
        constructor(options) {this.options = options; h.codex.push(this);}
        start() {this.options.publish({status: 'ready', snapshot: null, message: ''});}
        async refresh() {}
        async connect() {
            this.options.publish({status: 'loading', snapshot: null, message: ''});
            await new Promise(resolve => {this.complete = resolve;});
            this.loginActive = true;
            this.options.openUri('https://auth.openai.com/');
            this.options.publish({status: 'loading', snapshot: null, message: 'Complete sign-in'});
        }
        async cancelLogin() {this.loginActive = false;}
        stop() {this.stopped = true;}
    }
    class Claude {
        constructor(options) {this.options = options; h.claude.push(this);}
        start() {this.options.publish({status: 'waiting', snapshot: null, message: 'Select a source'});}
        async refresh() {}
        async selectSource(id) {this.selected = id;}
        listSources() {return h.sourceIds;}
        stop() {this.stopped = true;}
    }
    class ClaudeCli {
        constructor(options) {this.options = options; h.claudeCli.push(this);}
        start() {this.options.publish({status:'ready',snapshot:null,message:'CLI quota read'});}
        async refresh() {}
        stop() {this.stopped = true;}
    }
    class Cancellable {cancel() {this.canceled = true;} is_cancelled() {return !!this.canceled;}}
    class Alerts {clear() {} observe() {return [];}}
    const GLib = {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
        FileTest: {IS_REGULAR: 1}, find_program_in_path: name => '/fake/'+name, file_test: () => true,
        get_home_dir: () => '/fake/home', build_filenamev: parts => parts.join('/'),
        timeout_add() {h.timers.add(1); return 1;}, Source: {remove(id) {h.timers.delete(id);}}};
    const Gio = {Cancellable, AppInfo: {
        launch_default_for_uri_async(uri) {h.launches.push(uri);}, launch_default_for_uri_finish() {},
    }};
    const Main = {panel: {addToStatusArea() {}}, messageTray: {add() {}}};
    const Extension = new Function('Gio', 'GLib', 'Extension', 'Main', 'MessageTray', 'CodexController',
        'ClaudeController', 'ClaudeCliController', 'UsageIndicator', 'LowQuotaAlerts', 'nextUiDeadline', 'plainText', 'websiteUrl', emitted)(
        Gio, GLib, Base, Main, {}, Codex, Claude, ClaudeCli, Indicator, Alerts, nextUiDeadline, value => value, websiteUrl);
    h.extension = new Extension();
    h.extension.enable();
    return h;
}

test('defaults acquire nothing; disable synchronously removes owned UI and timer', () => {
    const h = harness();
    assert.equal(h.codex.length, 0);
    assert.equal(h.claude.length, 0);
    assert.equal(h.launches.length, 0);
    assert.equal(h.timers.size, 0);
    h.actions.setEnabled('codex', true);
    h.actions.setEnabled('claude', true);
    assert.equal(h.codex.length, 1);
    assert.equal(h.claude.length, 1);
    assert.equal(h.launches.length, 0);
    h.actions.menuStateChanged(true);
    assert.equal(h.timers.size, 1);
    h.actions.menuStateChanged(false);
    assert.equal(h.timers.size, 0);
    h.extension.disable();
    assert.equal(h.codex[0].stopped, true);
    assert.equal(h.claude[0].stopped, true);
    assert.equal(h.destroyed, true);
    assert.equal(h.timers.size, 0);
    const before = h.state;
    h.codex[0].options.publish({status: 'error', snapshot: null, message: 'late'});
    assert.equal(h.state, before);
});
test('website links do not enable monitoring or claim local CLI authentication',()=>{
 const h=harness();
 h.actions.openWebsite('codex');h.actions.openWebsite('claude');
 assert.deepEqual(h.launches,['https://chatgpt.com/auth/login','https://claude.ai/login']);
 assert.equal(h.codex.length,0);assert.equal(h.claude.length,0);assert.equal(h.state.login,false);
 h.extension.disable();h.actions.openWebsite('codex');assert.equal(h.launches.length,2);
});

test('cancel before login-start response prevents browser and cancels the eventual login', async () => {
    const h = harness();
    h.actions.setEnabled('codex', true);
    h.actions.connectCodex();
    assert.equal(h.state.login, true);
    h.actions.cancelLogin();
    h.codex[0].complete();
    await tick();
    assert.equal(h.launches.length, 0);
    assert.equal(h.codex[0].loginActive, false);
    assert.equal(h.state.login, false);
    assert.equal(h.state.busy.codex, false);
    h.extension.disable();
});

test('Cancel remains available after connect returns from launching the browser', async () => {
    const h = harness();
    h.actions.setEnabled('codex', true);
    h.actions.connectCodex();
    h.codex[0].complete();
    await tick();
    assert.equal(h.launches.length, 1);
    assert.equal(h.state.login, true);
    h.actions.cancelLogin();
    await tick();
    assert.equal(h.codex[0].loginActive, false);
    assert.equal(h.state.login, false);
    h.extension.disable();
});

test('Claude selection passes the full hash; changing Codex settings preserves Claude', async () => {
    const h = harness();
    h.actions.setEnabled('codex', true);
    h.actions.setEnabled('claude', true);
    h.actions.selectClaudeSource(h.sourceIds[1]);
    await tick();
    assert.equal(h.claude[0].selected, 'b'.repeat(64));
    h.actions.setPollSeconds(300);
    assert.equal(h.codex[0].stopped, true);
    assert.equal(h.codex.length, 2);
    assert.equal(h.claude.length, 1);
    assert.equal(h.claude[0].stopped, undefined);
    h.extension.disable();
});

test('15-second selection restarts active CLI providers and ignores retired publications',()=>{
 const h=harness();h.actions.setEnabled('codex',true);h.actions.setEnabled('claude',true);
 h.actions.setClaudeCliMode(true);
 assert.equal(h.claude[0].stopped,true);assert.equal(h.state.views.claude.message,'CLI quota read');
 const oldCodex=h.codex[0],oldClaude=h.claudeCli[0];
 h.actions.setPollSeconds(15);
 assert.equal(oldCodex.stopped,true);assert.equal(oldClaude.stopped,true);
 assert.equal(h.codex[1].options.pollSeconds,15);assert.equal(h.claudeCli[1].options.pollSeconds,15);
 const state=h.state;oldClaude.options.publish({status:'error',snapshot:null,message:'retired'});
 assert.equal(h.state,state);
 h.actions.selectClaudeSource('a'.repeat(64));assert.equal(h.state,state);
 h.extension.disable();assert.equal(h.claudeCli[1].stopped,true);
});
test('interval and mode preferences acquire nothing until monitoring is enabled',()=>{
 const h=harness();h.actions.setPollSeconds(15);h.actions.setClaudeCliMode(true);
 assert.equal(h.codex.length,0);assert.equal(h.claude.length,0);assert.equal(h.claudeCli.length,0);
 h.actions.setEnabled('claude',true);
 assert.equal(h.claudeCli[0].options.pollSeconds,15);assert.equal(h.codex.length,0);
 h.actions.setClaudeCliMode(false);assert.equal(h.claudeCli[0].stopped,true);assert.equal(h.claude.length,1);
 h.extension.disable();
});
