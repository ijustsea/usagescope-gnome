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
function harness({programs = {codex: '/usr/bin/codex', claude: '/usr/bin/claude'}, files = []} = {}) {
    const h = {timers: new Set(), codex: [], claude: [], launches: [], programs, files: new Set(files)};
    const values = {'enable-codex': false, 'enable-claude': false, 'codex-path': '', 'claude-path': '', 'poll-seconds': 60};
    h.values = values;
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
        update(views, enabled, busy) {h.state = JSON.parse(JSON.stringify({views, enabled, busy}));}
        setPollSeconds(seconds) {h.pollSeconds = seconds;}
        destroy() {h.destroyed = true;}
    }
    class Controller {
        constructor(options) {this.options = options; this.refreshes = 0;}
        start() {this.options.publish({status: 'ready', snapshot: null, message: ''});}
        async refresh() {this.refreshes++;}
        stop() {this.stopped = true;}
    }
    class Codex extends Controller {constructor(options) {super(options); h.codex.push(this);}}
    class Claude extends Controller {constructor(options) {super(options); h.claude.push(this);}}
    class Cancellable {cancel() {this.canceled = true;} is_cancelled() {return !!this.canceled;}}
    class Alerts {clear() {} observe() {return [];}}
    const exists = path => h.files.has(path) || Object.values(h.programs).includes(path);
    const GLib = {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
        FileTest: {IS_REGULAR: 1, IS_EXECUTABLE: 2},
        path_is_absolute: path => path.startsWith('/'),
        find_program_in_path: name => name.startsWith('/') ? (exists(name) ? name : null) : h.programs[name] ?? null,
        file_test: path => exists(path),
        get_home_dir: () => '/home/user', build_filenamev: parts => parts.join('/'),
        timeout_add() {h.timers.add(1); return 1;}, Source: {remove(id) {h.timers.delete(id);}}};
    const Gio = {Cancellable, AppInfo: {
        launch_default_for_uri_async(uri) {h.launches.push(uri);}, launch_default_for_uri_finish() {},
    }};
    const Main = {panel: {addToStatusArea() {}}, messageTray: {add() {}}};
    const Extension = new Function('Gio', 'GLib', 'Extension', 'Main', 'MessageTray', 'CodexController',
        'ClaudeCliController', 'UsageIndicator', 'LowQuotaAlerts', 'nextUiDeadline', 'plainText', 'websiteUrl', emitted)(
        Gio, GLib, Base, Main, {}, Codex, Claude, Indicator, Alerts, nextUiDeadline, value => value, websiteUrl);
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
    assert.equal(h.pollSeconds, 60);
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
 assert.equal(h.codex.length,0);assert.equal(h.claude.length,0);
 h.extension.disable();h.actions.openWebsite('codex');assert.equal(h.launches.length,2);
});
test('Refresh reads both enabled providers once and never opens a browser', async () => {
    const h = harness();
    h.actions.refresh();
    await tick();
    assert.equal(h.codex.length, 0);
    h.actions.setEnabled('codex', true);
    h.actions.setEnabled('claude', true);
    h.actions.refresh();
    assert.equal(h.state.busy.codex, true);
    await tick();
    assert.equal(h.codex[0].refreshes, 1);
    assert.equal(h.claude[0].refreshes, 1);
    assert.equal(h.state.busy.codex, false);
    assert.equal(h.launches.length, 0);
    h.extension.disable();
});
test('both CLIs resolve the same way: configured path, then PATH, then ~/.local/bin', () => {
    const fromPath = harness();
    fromPath.actions.setEnabled('codex', true);fromPath.actions.setEnabled('claude', true);
    assert.equal(fromPath.codex[0].options.executable, '/usr/bin/codex');
    assert.equal(fromPath.claude[0].options.executable, '/usr/bin/claude');
    fromPath.extension.disable();
    const native = harness({programs: {}, files: ['/home/user/.local/bin/codex', '/home/user/.local/bin/claude']});
    native.actions.setEnabled('codex', true);native.actions.setEnabled('claude', true);
    assert.equal(native.codex[0].options.executable, '/home/user/.local/bin/codex');
    assert.equal(native.claude[0].options.executable, '/home/user/.local/bin/claude');
    native.extension.disable();
    const configured = harness({files: ['/opt/claude/bin/claude']});
    configured.values['claude-path'] = '/opt/claude/bin/claude';
    configured.actions.setEnabled('claude', true);
    assert.equal(configured.claude[0].options.executable, '/opt/claude/bin/claude');
    configured.extension.disable();
});
test('a missing CLI is reported as unavailable instead of starting a controller', () => {
    const missing = harness({programs: {}});
    missing.actions.setEnabled('codex', true);missing.actions.setEnabled('claude', true);
    assert.equal(missing.codex.length, 0);assert.equal(missing.claude.length, 0);
    assert.equal(missing.state.views.codex.status, 'unavailable');
    assert.equal(missing.state.views.claude.status, 'unavailable');
    missing.extension.disable();
    const bare = harness();
    bare.values['claude-path'] = 'claude';
    bare.actions.setEnabled('claude', true);
    assert.equal(bare.claude.length, 0, 'a configured path must be absolute, never a PATH lookup');
    assert.equal(bare.state.views.claude.status, 'unavailable');
    bare.extension.disable();
    const wrong = harness();
    wrong.values['claude-path'] = '/missing/claude';
    wrong.actions.setEnabled('claude', true);
    assert.equal(wrong.claude.length, 0, 'a configured path never silently falls back to another CLI');
    assert.equal(wrong.state.views.claude.status, 'unavailable');
    wrong.extension.disable();
});
test('interval change restarts both CLI providers and ignores retired publications',()=>{
 const h=harness();h.actions.setEnabled('codex',true);h.actions.setEnabled('claude',true);
 const oldCodex=h.codex[0],oldClaude=h.claude[0];
 h.actions.setPollSeconds(15);
 assert.equal(oldCodex.stopped,true);assert.equal(oldClaude.stopped,true);
 assert.equal(h.codex[1].options.pollSeconds,15);assert.equal(h.claude[1].options.pollSeconds,15);
 const state=h.state;oldClaude.options.publish({status:'error',snapshot:null,message:'retired'});
 assert.equal(h.state,state);
 h.extension.disable();assert.equal(h.claude[1].stopped,true);
});
test('a path change restarts only that provider',()=>{
 const h=harness({files:['/opt/codex']});h.actions.setEnabled('codex',true);h.actions.setEnabled('claude',true);
 h.values['codex-path']='/opt/codex';h.extension.settings.changed(null,'codex-path');
 assert.equal(h.codex.length,2);assert.equal(h.codex[1].options.executable,'/opt/codex');
 assert.equal(h.claude.length,1);assert.equal(h.claude[0].stopped,undefined);
 h.extension.disable();
});
test('interval preferences acquire nothing until monitoring is enabled',()=>{
 const h=harness();h.actions.setPollSeconds(15);
 assert.equal(h.codex.length,0);assert.equal(h.claude.length,0);
 h.actions.setEnabled('claude',true);
 assert.equal(h.claude[0].options.pollSeconds,15);assert.equal(h.codex.length,0);
 h.actions.setEnabled('claude',false);assert.equal(h.claude[0].stopped,true);
 assert.equal(h.state.views.claude.status,'disabled');
 h.extension.disable();
});
