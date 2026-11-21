# Implementation progress
Plan: docs/superpowers/plans/2026-11-21-usagescope.md
Ruling: user explicitly requests this main checkout; no worktree or reapproval.
Ruling: implement inline with parallel independent Claude/UI components where contracts are fixed; one whole-project security review before push.
Baseline: empty repository, no user files or commits; Node 22.23.1, GJS 1.90.1, Shell 51.1. No baseline tests exist.

## Implementation results — 2026-11-21

- Task 1: complete — core normalization, URL/command/RPC policy and last-good state; observed failing tests before implementation.
- Task 2: complete — bounded real GIO stdio transport, login/cancel, account epochs, timeout/backoff and subprocess release; real GJS fixtures include malformed/oversize/timeouts, parent/symlink rejection, delayed cancellation, account switch and failed login.
- Task 3: complete — private immutable Claude snapshots, bounded passive reader/source selection, no persistent exporter lock, explicit reversible configuration with exact private backup. Tests use fixture settings only.
- Task 4: complete — GNOME 51 actors, source-aware menu/settings, browser login control, disabled-by-default acquisition, expiry deadlines and Codex-only hysteresis notifications.
- Task 5: complete — source-derived distribution manifest, repeatable ZIP/hash, explicit installation helper, pinned read-only CI and documentation.
- Task 6: complete — independent security review and scoped rechecks; all identified material findings fixed with regressions.

Ruling: original single resident Codex child changed to quota-only transient child. One live read measured 81,192 KiB PSS for that process and 378ms request/initialization elapsed. The controller now releases it between polls and retains it during browser login only. This reduces the idle process count; CPU/power superiority is not measured or claimed. The normal completion path uses immediate owned-child termination, so this is not an independent proof of all vendor CLI shutdown behavior.

## Actual verification

- `npm run check`: 43/43 Node tests pass, plus real GJS Claude and Codex checks with `G_DEBUG=fatal-criticals`.
- `npm run test:shell`: pass on installed GNOME Shell 51.1 in separate D-Bus, config, data, cache and runtime directories. Tested packaged Claude bridge input, packaged Codex adapter quota-only RPC to controlled executable, enable/disable/re-enable and no reported extension errors.
- `gjs -m scripts/probe-codex.mjs /home/safe/.local/bin/codex`: live official CLI quota read passed; no prompt/thread/turn generated and no raw quota/account data logged. CLI-owned authentication may refresh as part of its documented behavior.
- `npm audit --ignore-scripts --audit-level=low`: 0 known vulnerabilities at verification time (development dependencies; not malware certification).
- Package regression: unexpected JSON/JS injected in build/ is excluded; source manifest includes shared runtime validator, only intended runtime code/assets/schema/license shipped. Rebuilding twice produces identical archive bytes.
- `git diff --check`: clean before integration.
- First GitHub CI run passed all 43 Node tests and the Claude GJS check, but exposed a fixture-only fixed /usr/bin/node shebang absent on the hosted runner. The test executable now resolves the explicitly provisioned Node from PATH; runtime product code and executable trust policy are unchanged.
- Independent review reproduced and closed: stale account response, untrusted executable ancestor, unwanted archive files, null-account alert baseline, interpreter PATH substitution, login cancellation and poll/failed-login process lifecycle gaps.

## Limits deliberately retained

- Did not install or enable in the user's primary desktop, perform real browser reauthentication, or change the user's Claude configuration/statusline. Full live Claude usage appearance and manual pointer/keyboard interactions are not claimed verified.
- Same-UID compromise, user-installed malicious CLIs/renderers and vendor endpoint/CLI changes remain trust boundaries.
- Passive Claude receipt does not prove server freshness; account identity is unknown, multiple sources require explicit choice, and no independent offline-Claude refresh or desktop alert is provided.
- No universal low-resource or complete malware-clearance claim. Browser URL validation and official CLI authentication are separate from third-party service security.

## Compact UI / subscription revision — v0.2.0

User revised the visible UI to compact horizontal remaining-quota bars and subscription tiers, not inference model names. This supersedes the original Codex-only 20% notification rule.

- Root cause of the tall popup: hidden labels left their PopupMenu row containers allocated. Replaced fixed sparse rows with two bounded provider cards; settings are collapsed and the whole popup scrolls within the active monitor.
- ChatGPT blue / Claude orange; each bar is red at <=30% remaining. Both providers notify on a new report crossing below30, rearm only after>=35, and suppress first/repeated/stale/expired/source-switched samples. Claude notification explicitly describes the last report, not server freshness.
- Main cards contain tier, two actual quota windows, remaining/used percentages, last receipt and fixed official website links. Browser actions neither enable monitoring nor authenticate the CLI. Server-reported usage restrictions remain visible as a compact status.
- Plan data: reported Codex bucket planType; Claude optional trusted auth/status subscriptionType only. Explicit CLI supplied by setup, 64KiB/2.5s probe bounds, private 300s profile+CLI cache,16 cache limit with concurrent publication checks. Unknown tiers stay unknown and old bridges/snapshots remain accepted. No email/org/auth output persisted.
- README now starts with location-independent copyable commands: pack/install -> GNOME logout/login -> enable. Regular numbered steps only; separate first-clone, update, CLI login, preview/apply/restore and troubleshooting.
- Actual final verification:60 Node tests + both GJS suites passed; native GNOME popup opened and inspected at354x365px, including1024x480 display test. Four real bars have correct fraction width, left alignment and blue/orange/red styles; diagnostics are absent from visible cards. A centered-fill regression was reproduced and fixed with FixedLayout. Test-only probes are appended to an isolated extracted COPY, never distributed.
- Independent review found no remaining material issue in its scope; it reran59 pre-final-status tests and verified both-provider alert wiring, website auth separation and ZIP exclusions. Final status-only regression brings the main suite to60. Main separately performed the native visual/small-monitor checks.
- npm audit:0 known dependency vulnerabilities. Not a malware-clearance guarantee. Existing user desktop, login and Claude configuration remain untouched.

