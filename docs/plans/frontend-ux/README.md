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
| 1. Confirm dialog | [01-confirm-dialog.md](01-confirm-dialog.md) | done |
| 2. Unsaved-work guard | [02-unsaved-guard.md](02-unsaved-guard.md) | to do |
| 3. Escape and shortcuts | [03-escape-and-shortcuts.md](03-escape-and-shortcuts.md) | to do |
| 4. Shared draft hook and editor header | [04-draft-and-header.md](04-draft-and-header.md) | to do |
| 5. SortableList (dnd-kit) | [05-sortable-list.md](05-sortable-list.md) | to do |
| 6. Splitter | [06-splitter.md](06-splitter.md) | to do |
| 7a. Composer draft, copy message | [07a-composer-draft-and-copy.md](07a-composer-draft-and-copy.md) | to do |
| 7b. Canvas: drag to empty space | [07b-canvas.md](07b-canvas.md) | to do |
| 7c. Canvas: undo/redo | [07b-canvas.md](07b-canvas.md) | to do |
| 7d. Canvas: copy/paste | [07b-canvas.md](07b-canvas.md) | to do |
| 7e. Regenerate and swipes (shared, server, web) | [07e-swipes.md](07e-swipes.md) | to do |

Decisions the orchestrator took while the user was away are marked **Decision** in the plans.
