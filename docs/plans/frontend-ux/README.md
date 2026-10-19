# Frontend UX: implementation plans

Plans for building `docs/FRONTEND-UX.md` (the agreed spec). There is one file per step. A step is coded only once its plan is committed and pushed.

## Process

1. The orchestrator writes the step's plan here, then commits and pushes it.
2. A **fresh Sonnet agent** codes the step from the plan alone. One agent per step, never reused.
3. The orchestrator verifies the work: reads the diff against the plan, runs `npm run check`, and runs a live check when the step changes behaviour on screen. Then it commits and pushes, or sends the work back to a new agent with the gaps listed.
4. The status table below is updated in the same commit.

## Rules every agent follows

- Read `AGENTS.md`, `README.md`, `PLAN.md`, `docs/FRONTEND-UX.md` and the step's plan before changing anything.
- Do only what the plan says. If the plan is wrong or incomplete, stop and report instead of improvising.
- Never modify `PLAN.md`. Update `README.md` and `AGENTS.md` where the plan says to.
- `npm run check` (Biome, typecheck, tests, knip) must pass. Use `npm run fix` for formatting. Run it in the background with a timeout and read the log, because the full run takes a while.
- Don't commit or push; the orchestrator does. Report: files changed, test results, anything left undone or doubtful.
- Code style: match the surrounding code (comment density, naming, file size under ~250 lines, pure logic in `.ts` with table tests).
- Environment: this is a Linux cloud container (not the Windows machine `AGENTS.md` describes). Chromium is at `/opt/pw-browsers/chromium`; never run `playwright install`.

## Status

| Step | Plan | Code |
|---|---|---|
| 1. Confirm dialog | [01-confirm-dialog.md](01-confirm-dialog.md) | to do |
| 2. Unsaved-work guard | [02-unsaved-guard.md](02-unsaved-guard.md) | to do |
| 3. Escape and shortcuts | [03-escape-and-shortcuts.md](03-escape-and-shortcuts.md) | to do |
| 4. Shared draft hook and editor header | not written | — |
| 5. SortableList (dnd-kit) | not written | — |
| 6. Splitter | not written | — |
| 7. Features (composer draft, copy message, canvas, swipes spec) | not written | — |

Plans 4–7 are written, committed and pushed before their steps start.
