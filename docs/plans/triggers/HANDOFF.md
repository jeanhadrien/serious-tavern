# Triggers: handoff for the next agent

Written 2026-10-19 at the end of the orchestrating session. Branch: `claude/multi-workflow-reply-triggers-k3um83`,
stacked on PR #2 (`ccr-e4abf0fe-frhfpu`, itself stacked on PR #1).

## Read first

1. `AGENTS.md` (contracts; the "Reply list (triggers)" and "Runs on the entry" bullets describe what is built).
2. Design: `docs/explorations/TRIGGERS-PROPOSAL-1.md`.
3. Plans, in order: `01-reply-list.md`, `02-remove-after-reply.md`, `03-concurrency.md` (this folder).

## Status

| Step | Plan | State |
| --- | --- | --- |
| 1A | `01-reply-list.md` Part A (shared, engine, server) | Done, verified (`npm run check` green), commit `83a132d` |
| 1B | `01-reply-list.md` Part B (web) | Done, verified, live-checked with Playwright, commit `68ba098` |
| 2 | `02-remove-after-reply.md` | Done, verified (3373 tests green), commit `86d6432` + `f5780a7` |
| 3 | `03-concurrency.md` | **Work in progress, unverified.** Committed as-is in the `wip(triggers)` commit on top of `f5780a7` |

### Step 3: what the WIP commit holds

The coding agent hit a usage limit mid-task. Nothing in the WIP commit has been typechecked or tested since: assume it
does not build. Its last note was "Now access tests in shared", so it had moved on to writing tests.

What it touched (from `git show --stat` of the WIP commit):

- **Engine:** every `packages/engine/src/nodes/*/index.ts` (the new required `access` declaration on each node
  definition), `prepare.ts` (computing `PreparedWorkflow.access`), and several engine tests updated for the new field.
- **Server:** `services/{turn-start,reply-section,reply-run,after-section,settle-turn,settle-after-run,turn-stream,
  chat,story-state}.ts` (the scheduler and list-order placement), `routes/sessions.ts` (likely the
  `GET /api/sessions/:id/reply-plan` route), `app.test.ts` (contract coverage), test support and trigger tests.
- **Web:** `api/sessions.ts`, `api/turnStream.ts`, `pages/chat/panel/{ReplySection.tsx,replyList.ts}` (the "Waits
  for" hint), `turnMessages.ts`/`useChat.ts` (placing rows by `position`), `ChatPanel.tsx`, CSS.
- **Docs:** `README.md`, `docs/FRONTEND-UX.md`.
- Check `git show --stat HEAD` for new files (shared access/overlap helpers and their tests may or may not exist yet).

## What to do

1. Run `npm run typecheck`, then `npm run check`, and see how far the WIP got. Read the WIP diff against
   `03-concurrency.md` and finish each item of the plan:
   - access sets: every node declares `access` (required field); template reads via `analyzeTemplate`, including LLM
     presets and character/persona fields; unknown node types count as `everything`;
   - scheduler: run *j* waits only for earlier runs whose writes overlap its reads; each run reads only what runs
     **listed above** it committed; writes (tagged with their run) and replies are stored in **list order**
     (`withRunSettled` places them); Stop stops all; failures never stop the others; `waitedFor` on logs;
   - `GET /api/sessions/:id/reply-plan`, contract first, route, server test, contract coverage (`app.test.ts`);
   - web: "Runs alongside the ones above" / "Waits for X" under each On reply row (fetched on list change and on
     `workflows|stateDefinitions|presets.changed`, never in the token path); `run.start.position` places streaming
     rows in list order;
   - the test list at the end of `03-concurrency.md`. Concurrency tests must be deterministic (gates/promises, no
     sleeps); run the new server tests 5 times in a row.
2. If the WIP is too tangled, it is fine to reset the step 3 files to `f5780a7` and redo the step from the plan:
   steps 1 and 2 are complete and green there.
3. Re-read the diff adversarially: the guarantee is "same result as running the enabled workflows top to bottom".
   When unsure whether two runs can overlap, make them wait.
4. Update `AGENTS.md` with the step 3 contracts (required `access` on node definitions, the overlap rule, list-order
   placement of writes and replies, the plan endpoint, `position`). Coding sub-agents must not edit `PLAN.md`.
5. Commit with the repo's conventions (`type(scope): subject`, a body, the trailer
   `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`). `npm run check` must pass before every
   commit. Squashing the WIP commit into the finished step 3 commit is fine (it is this branch's own unmerged work).

## Then: open PR #3

The user asked for a third PR once everything is done: head `claude/multi-workflow-reply-triggers-k3um83`, base
`ccr-e4abf0fe-frhfpu` (PR #2's branch), so the diff shows only this work. Mention in the body that it is stacked on #2
and should be retargeted once #2 merges, list the three steps, the data notes (reply list is additive; After Reply was
removed outright because it never shipped), and the test results.

## Decisions already taken with the user (don't reopen)

- Fixed triggers only; no workflow-raised custom events, no workflows calling workflows (proposal, "Why not custom
  events").
- Two workflows writing the same key: no warning, list order decides (writes applied top to bottom).
- A workflow appears at most once in a list.
- After Reply removed outright, no compatibility path.
- `increment` counts as a read of its key (it is stored as its post-value).
