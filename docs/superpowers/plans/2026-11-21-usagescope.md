# UsageScope Implementation Plan
> For agentic workers: use superpowers:executing-plans, task by task.
Goal: deliver a local GNOME 51 quota indicator with explicit setup and bounded, credential-free app code.
Architecture: TypeScript core + GJS runtime adapters + GNOME UI; official Codex stdio, passive Claude statusline.
Tech Stack: TypeScript, GJS, Gio, St/Clutter, GSettings, node:test.
Spec: ../specs/2026-11-21-usagescope-design.md
## Global Constraints
- Work in this main checkout; no model-generating calls, custom backend or automatic credential/CLI configuration changes.
- Never print auth URLs/tokens/raw provider output to logs.
- Controllers expose src/core/types.ts and start/refresh/connect/stop. publish final UI states and preserve last-good snapshots on errors.
## Review Focus
- Malformed/unbounded JSON, URL tricks and unsafe command paths.
- File symlinks/permissions, concurrent canceled writers, account/session mixups.
- Process timeout/EOF/restart, disabling during async work, stdout/stderr backpressure.
- Existing Claude statusline quoting/stdout and reversible configuration.
- Tested package vs real GJS/GNOME execution.
## Task 1: Core
Files src/core/{types,normalize,policy,state}.ts, tests/core.test.mjs.
Consumes unknown JSON. Produces parseCodexUsage/parseClaudeUsage, validateAuthUrl, provider state helpers.
- [x] Write literal behavior/security tests and observe RED.
- [x] Implement validators and state; run tests GREEN.
## Task 2: Codex
Files src/codex/{rpc,controller}.ts, tests/gjs/codex.mjs, tests/fixtures/fake-codex.mjs.
Produces CodexController({executable,pollSeconds,publish,openUri}), start/refresh/connect/stop.
- [x] Write transport/lifecycle tests with controlled real subprocess.
- [x] Implement bounded GIO JSONL, exact RPC allowlist, deadlines and safe login.
- [x] Verify real GJS, no model calls.
## Task 3: Claude
Files src/claude/*.ts, tests/gjs/claude.mjs.
Produces ClaudeController({publish}), start/refresh/connect/stop; bridge entry point.
- [x] RED tests for private storage, projection, ordering and malformed input.
- [x] Implement passive bridge/controller and reversible explicit integration.
- [x] Verify against temporary fixtures, never user's actual settings.
## Task 4: UI
Files src/extension.ts, metadata.json, stylesheet.css, schemas/*.xml.
Consumes controller contracts; creates actor lifecycle/settings and accessible source-aware menu.
- [x] Verify GJS/Shell APIs from installed GNOME 51.
- [x] Implement disabled-by-default acquisition, login/setup/status and cleanup.
- [x] Run build and isolated real Shell smoke if available.
## Task 5: Distribution and docs
Files scripts/{package,test-gjs,install}.mjs, README.md, SECURITY.md, LICENSE.
- [x] Build deterministic safe archive and test it contains exactly required files.
- [x] Document setup, passive freshness, side effects, token-free runtime and limitations.
## Task 6: Security review and delivery
- [x] Run full tests, GJS integration, package checks, npm audit and source/artifact secret/dangerous-action checks.
- [x] Fresh independent reviewer; fix material findings with regression tests.
- [x] Commit and push verified work to main; state unverified real-account/desktop boundaries.

