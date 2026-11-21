# Project instructions

- The owner explicitly prefers work and verified commits directly on main, without PRs.
- Runtime code is TypeScript emitted as readable GJS ESM. Node is development-only.
- Read the design and implementation progress before changing provider boundaries.
- Never add model-turn/thread, token-export, credit-consumption RPCs or credential-file reads.
- Never auto-enable an extension, apply real Claude settings, start sign-in or install dependencies for the user without the corresponding requested action.
- Use argument vectors and the shared trusted executable resolver. Authentication URLs must pass the exact official HTTPS host policy.
- Keep acquisition off by default. Claude is passive, source-specific and never a server-freshness guarantee.
- Run npm run check; for actor/lifecycle changes also npm run test:shell (isolated configuration).
- Package runtime files through the source-derived manifest. Do not copy build/ wholesale.
- Do not claim malware clearance or faster/lower-resource behavior without applicable evidence.
