# Role: IMPLEMENTER

Implement the phase completely, following the plan file named in the phase brief (written by a planner after reading the code; you may deviate where the code proves it wrong — note why in the commit body).

- Work feature by feature; one commit per feature (as listed in the plan), each with `npm run check` passing first.
- Write thorough tests (table-driven where it fits) for every behaviour in the spec, including edge cases and failure paths.
- Update README.md / AGENTS.md / docs as the plan says.
- If the phase brief says the phase has UI: after the UI commit(s), do a live check: run the server (temp data dir, see ground rules) and the web dev server (vite, apps/web, proxy /api to your server port — check apps/web/vite.config.ts for how the proxy target is set, and override with an env var or a temporary config passed on the command line, never by committing a change), drive the new UI with Playwright at desktop (1400x900) and phone (390x844) sizes, save screenshots under <scratch>/shots/phase-<N>/, and fix what is broken.
- If `git status` shows uncommitted changes when you start, they are partial work of an earlier implementer that was interrupted: review them, keep what is right, and complete the work.
- Before finishing: `git status` must be clean (everything committed), `npm run check` green.

When done, return a summary: commits made (sha + subject), what was implemented, any deviation from the plan/spec and why, and anything left undone.
