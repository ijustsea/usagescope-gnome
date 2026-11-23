# Project instructions

- The owner explicitly prefers work and verified commits directly on main, without PRs.
- Runtime code is TypeScript emitted as readable GJS ESM. Node is development-only.
- Read the design and implementation progress before changing provider boundaries.
- Never add model-turn/thread, token-export, credit-consumption RPCs or credential-file reads.
- Never auto-enable an extension, change Claude/Codex CLI settings, start sign-in or install dependencies for the user. Sign-in stays in the official CLIs' terminal commands.
- Use argument vectors and the shared trusted executable resolver. Both CLIs resolve the same way: configured absolute path, else PATH, else ~/.local/bin. Website buttons open fixed official URLs only on click.
- Keep acquisition off by default. Usage comes only from the official CLIs' existing sign-in: Codex App Server account/rateLimits/read, Claude initialize/get_usage(skip_behaviors=true) control requests with CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1. Never send user/model messages or /usage prompts, and do not add a passive/statusline source. Subscription metadata is not a server-freshness guarantee.
- Do not impose load or side effects on the user's environment: no token-consuming calls, no automatic browser launch or refresh, no resident CLI process between polls.
- Compact UI uses subscription tiers, not AI model names. Settings must fit without scrolling; test:shell asserts it (default 1280x720, also run USAGESCOPE_TEST_MONITOR=1024x480). Both providers warn on crossing to <=30% remaining; <=30% bars are red, recovery >=35% rearms alerts. Initial low samples do not alert.
- Run npm run check; for actor/lifecycle changes also npm run test:shell (isolated configuration).
- Package runtime files through the source-derived manifest. Do not copy build/ wholesale.
- Do not claim malware clearance or faster/lower-resource behavior without applicable evidence.
