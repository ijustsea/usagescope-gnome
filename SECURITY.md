# Security model

## Scope and guarantees

UsageScope is a local GNOME extension, not a sandbox. GNOME extensions execute inside Shell; code running as the same user can change the extension, CLI or session data. This project cannot guarantee absence of all vulnerabilities, malware on the host, or compromised vendor services. Review coverage is evidence, not a security certification.

## Trust boundaries and controls

| Boundary | Control |
| --- | --- |
| CLI command execution | Explicit argv; configured absolute path, else PATH, else ~/.local/bin for both CLIs; per-process Codex plugin overrides only, never written to config; executable/owner/mode checks through ancestors; no shell/eval; only owned subprocess terminated; no CLI process kept between polls |
| App Server protocol | Exact read-only method allowlist; no model turn/thread, sign-in, token export, logout, purchase or earned-reset consumption methods; 1 MiB frames, 4 MiB total stdout and 256 messages per connection, bounded pending requests/timeouts |
| Browser | Never opened automatically. Card website buttons open fixed official URLs (chatgpt.com, claude.ai) only on click; no sign-in flow or auth URL handling |
| Authentication | Official CLIs own credentials; UsageScope does not read auth.json, cookies or tokens |
| Claude CLI usage | Official SDK control protocol (vendor-labelled experimental) initialize/get_usage only, skip_behaviors=true, no user messages; hooks/MCP/tools/skills/session persistence, telemetry and error reporting disabled (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC deliberately unset because it blocks the usage fetch), neutral cwd, trusted executable, 1MiB frame/4MiB connection/256 message/15s deadline and owned-child cleanup |
| Subscription tier | Codex reported planType; Claude get_usage subscription_type through a fixed whitelist. No inference from AI model names and no auth PII stored |
| CLI configuration | UsageScope never reads or writes CLI settings; no statusline wrapper, settings edit or setup helper. The spawned official CLIs still manage their own config and cache files |
| UI | Plain bounded text, no markup injection, source-aware states, history not presented as current |
| Lifecycle | Generation guards, cancellation, bounded reconnection; successful quota reads close stdin and wait up to 2 seconds for exit, then terminate only the owned child; synchronous disable detaches resources and stops owned child |
| Supply chain | Dev dependencies pinned, npm scripts disabled on install, runtime archive allowlist, deterministic ZIP/hash, no node_modules or bundled native executables |
| GitHub Actions | Read-only permissions, checkout credentials not persisted, third-party action references pinned to commit IDs |

Executable ancestor paths must be owned by root or the current user and must not be group/world-writable. Root-owned sticky shared directories (for example `/tmp`) are a limited exception. These checks prevent accepting an obviously replaceable naming chain; they do not eliminate all same-user path races or establish executable authenticity.

The Claude CLI usage reader consumes only the known quota/tier fields. Account email/organization returned by the CLI's initialize response are hashed with the profile path in memory solely to distinguish alert baselines; raw account metadata is never logged or stored. Missing identity gets a fresh source baseline. The experimental vendor contract may change or provide no limits; unsupported replies fail closed with no model-prompt fallback. The CLI's own behavior and managed policy remain external trust boundaries.

Versions before 0.4.0 shipped an opt-in statusline setup helper. Its private backups (`.usagescope-setup`, `.usagescope-recovery-*` in the Claude config directory) may contain sensitive settings. 0.4.0 neither reads nor deletes them; README documents how to restore and review them manually.

## Behaviors intentionally excluded

No custom backend, analytics, self-update, downloaded code execution, remote scripts, cookie extraction, model prompts, automatic browser launches or automatic dependency installation. Missing/expired quotas never imply 100% remaining. Account/session data is never merged or summed. Repeated receipt does not prove fresh server observation.

Website buttons open fixed official URLs only; they neither enable acquisition nor establish local CLI authentication. Alerts describe the latest CLI read, not a guarantee of server-side freshness. Newly received threshold crossings to 30% or below notify once, with recovery at 35% required to rearm; stale, repeated, expired or first samples do not alert.

## Verification

See docs/implementation-progress.md for commands and actual outcomes. npm audit identifies known advisories in development dependencies; a zero result is not a malware scan or a proof of safety. Tests with controlled subprocesses prove our protocol boundary, not every behavior of the vendor CLI. Real account, browser login and desktop interactions must be reported separately from fixture tests.

## Reporting

Report reproducible issues through this repository's GitHub Security Advisory private reporting facility when available. If unavailable, contact the maintainer through GitHub without including tokens, auth URLs, raw payloads, account IDs or personal data. Do not post exploitation details or secrets in a public issue.
