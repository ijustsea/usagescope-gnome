# Compact quota UI implementation plan

User-authorized revision: compact ChatGPT/Claude cards, horizontal remaining-quota bars (ChatGPT blue, Claude orange; <=30% red), alerts crossing below 30%, subscription PLAN labels (not AI model names), official website sign-in/sign-up links, plain numeric README steps.

1. Tests first for remaining/used percentages, exactly-30 danger, missing/expired states, stale receipt labels, both-provider threshold crossing/rearm35 and repeated-source suppression.
2. Replace sparse fixed PopupMenu rows with bounded cards: hide complete row/container, two primary windows, hide extras behind settings. Remove diagnostics from main view, preserve local setup in collapsed settings. Bound popup content with scrolling on smaller displays.
3. UI website links use fixed official URLs only; do not imply browser sign-in authenticates local CLI. Existing official Codex CLI sign-in can remain in advanced settings.
4. Plan metadata: optional UsageSnapshot.planType; Codex reported planType; Claude read-only auth status via explicit trusted CLI argument generated on setup, small private profile-bound TTL cache, unknown on failure. Never infer plan from Claude AI model or quota shape; never persist email/org/token data. Legacy bridge/snapshot remains valid.
5. Update README first screen: absolute npm --prefix path or cd, build/install/update, separate mandatory logout/login then enable, never circled digits; website vs CLI auth explained.
6. Verify domain regressions, actual GJS, actual popup layout/rendering in isolated GNOME, package manifest and independent review. Build ZIP and push main; user desktop settings/login remain untouched.
