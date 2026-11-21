# Security model

## Scope and guarantees

UsageScope is a local GNOME extension, not a sandbox. GNOME extensions execute inside Shell; code running as the same user can change the extension, CLI or session data. This project cannot guarantee absence of all vulnerabilities, malware on the host, or compromised vendor services. Review coverage is evidence, not a security certification.

## Trust boundaries and controls

| Boundary | Control |
| --- | --- |
| Codex command execution | Explicit argv, absolute path, executable/owner/mode checks, no shell/eval; only owned subprocess terminated |
| App Server protocol | Exact method allowlist; no model turn/thread, token export, logout, purchase or earned-reset consumption methods; 1 MiB frames, 4 MiB total stdout and 256 messages per connection, bounded pending requests/timeouts |
| Browser authentication | HTTPS exact-host allowlist auth.openai.com/chatgpt.com; reject userinfo, control characters, backslashes and nonstandard ports; no raw auth URLs logged |
| Authentication | Official CLIs own credentials; UsageScope does not read auth.json, cookies or tokens |
| Claude input | Bounded stdin, explicit projection of known quota fields, no transcripts/prompts/working directories persisted |
| Subscription tier | Codex reported planType; optional trusted Claude CLI auth/status projection of subscriptionType only, 64 KiB/2.5 s bound and private 300 s profile/CLI-scoped cache. No inference from AI model names and no auth PII stored |
| Runtime storage | Private owned directories/files, owner/mode checks through ancestors, symlink rejection, immutable snapshots, bounded inventory/retention and own-commit rollback on failed concurrent publication; never a security boundary against same UID |
| CLI configuration | Explicit preview/apply/restore; private backup; capture-before-validate restoration, exclusive publication and retained recovery archives; unsupported existing shell commands refused; no actual config changes from the panel |
| UI | Plain bounded text, no markup injection, source-aware states, history not presented as current |
| Lifecycle | Generation guards, cancellation, bounded reconnection; successful quota reads close stdin and wait up to 2 seconds for exit, then terminate only the owned child; synchronous disable detaches resources and stops owned child |
| Supply chain | Dev dependencies pinned, npm scripts disabled on install, runtime archive allowlist, deterministic ZIP/hash, no node_modules or bundled native executables |
| GitHub Actions | Read-only permissions, checkout credentials not persisted, third-party action references pinned to commit IDs |

Only existing explicitly configured absolute renderer executables may be run by the Claude bridge; arbitrary shell expressions are not evaluated. Executable, interpreter and parent/symlink chains are validated and canonical interpreter paths persisted. Path checks do not establish vendor authenticity: the CLI and renderer remain trusted user-installed code. Input/output size and deadline restrictions can reject renderers that exceeded those limits.

The opt-in Claude setup helper preserves an exact private backup of existing settings. That backup may contain sensitive values already present in the user's configuration; it is kept in a 0700 directory with 0600 backup files, never logged, uploaded or included in the extension archive.

Configuration and runtime ancestor paths must be owned by root or the current user and must not be group/world-writable. Root-owned sticky shared directories (for example `/tmp`) are a limited exception. These checks prevent accepting an obviously replaceable naming chain; they do not eliminate all same-user path races or establish executable authenticity.

Restore first captures the settings inode in a private `.usagescope-recovery-*` directory, validates its version/bytes, and publishes originals without overwriting a concurrent file. Captured settings are retained even after success so late writes through an open descriptor remain recoverable. Success also archives the previous setup transaction; conflicts preserve the live wrapper and retain recovery data instead of overwriting edits. There are at most 16 recovery archives and a bounded configuration-directory scan. Archives persist until the user inspects them; they can contain sensitive settings and must not be uploaded. This is a recovery protocol, not a lock against arbitrary same-user editors.

## Behaviors intentionally excluded

No custom backend, analytics, self-update, downloaded code execution, remote scripts, cookie extraction, model prompts or automatic dependency installation. Missing/expired quotas never imply 100% remaining. Account/session data is never merged or summed. Repeated receipt does not prove fresh server observation.

Website buttons open fixed official URLs only; they neither enable acquisition nor establish local CLI authentication. Claude alerts describe the last reported quota, not a freshly verified server reading. Newly received threshold crossings below 30% notify once, with recovery at 35% required to rearm; stale, repeated, expired or first samples do not alert.

## Verification

See docs/implementation-progress.md for commands and actual outcomes. npm audit identifies known advisories in development dependencies; a zero result is not a malware scan or a proof of safety. Tests with controlled subprocesses prove our protocol boundary, not every behavior of the vendor CLI. Real account, browser login and desktop interactions must be reported separately from fixture tests.

## Reporting

Report reproducible issues through this repository's GitHub Security Advisory private reporting facility when available. If unavailable, contact the maintainer through GitHub without including tokens, auth URLs, raw payloads, account IDs or personal data. Do not post exploitation details or secrets in a public issue.
