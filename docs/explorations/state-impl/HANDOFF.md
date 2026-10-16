# State and creativity implementation: handoff

Written 2026-10-16 to move this work to a new session. It is everything a fresh orchestrator needs to
finish the plan in [STATE-DESIGN-PROPOSAL-3.md](../STATE-DESIGN-PROPOSAL-3.md). Start a new session on
this repository and tell it: *"Read docs/explorations/state-impl/HANDOFF.md and continue the
implementation."*

## The mandate

The user asked for the building blocks of per-chat state to be implemented autonomously by an
orchestrator and sub-agents, on a separate branch, with a checkpoint branch per phase, so they can test
and refine afterwards. The design is **STATE-DESIGN-PROPOSAL-3** (on `main`). Decisions already taken by
the user:

- **Chat settings** are user-owned per-chat knobs, declared by the workflow, never undone by chat edits.
- **Story state** is written by turns and lives as long as the writing turn's replies.
- **Summaries** are tied to the messages they cover: recent messages raw, older history as summarized
  chunks (chunk size by message count).
- **Lorebooks and decks** are one "authored collection" type, read-only for workflows: Recall (keywords)
  and Draw (weighted random).
- Draw and Trigger keep their own bookkeeping as implicit per-node state.
- No variations view or divergence harness in this plan.

## Where things are

| Branch | Content |
| --- | --- |
| `main` | The design docs (proposals 1–3, reviews 1–2). Do not push implementation work here unless the user asks. |
| `claude/state-impl` | Working branch: all phases so far, plus this handoff. Continue here. |
| `claude/state-impl-phase-1` | Checkpoint after phase 1 (`b3fd32b`) |
| `claude/state-impl-phase-2` | Checkpoint after phase 2 (`4465609`) |
| `claude/state-impl-phase-3` | Checkpoint after phase 3 (`9d852a9`) |

After each phase, push the working branch and create the next checkpoint:
`git push origin HEAD:refs/heads/claude/state-impl-phase-<N>`.

## Done

Every phase went through plan → implement → five parallel reviews (spec, correctness, conventions,
tests, live UI with Playwright) → fixes → second review → fixes → final verification, then an
orchestrator check (`npm run check` green, clean tree, diff skim). AGENTS.md was updated by the agents
with every new contract; read its sections on sinks, randomness, chat settings and collections.

| Phase | What it added | Tests |
| --- | --- | --- |
| 1. Engine foundations | Sink nodes (run even when no Chat Output needs them); a seed per run and `ctx.random()`; `ctx.log` → `nodes[id].logs`; the `requiredIfConnected` port flag; the **Random** node (number, integer, weighted pick, chance gate) and the **Parse JSON** node | 833 |
| 2. Chat settings | `workflow.settings` declarations and a "Chat settings" panel in the workflow editor; `session.settings` and `PATCH /api/sessions/:id` (`400 CHAT_SETTING_INVALID`, never moves `updatedAt`); `resolveChatSettings`; `{{settings.*}}` with hints; the **Chat Settings** node; the chat side panel `ChatPanel` (button in the chat header) | 1004 |
| 3. Authored collections | YAML records under `data/collections/`, API and `collections.changed`; list and editor in the right column; the **Recall** and **Draw** nodes with custom config panels; `docs/COLLECTIONS.md` | 1206 |

How to try each one, written for the user: [howto/](howto/).

## Remaining work, in order

Specs are in [specs/](specs/). Each is the `spec` argument for one phase run. Before launching, add a
one-paragraph "Context: phases 1..N-1 on this branch added …" at the top, and adjust details to what
earlier phases actually built (read their AGENTS.md sections and code).

| Phase | Spec | UI | Notes |
| --- | --- | --- | --- |
| 4a. Story state, backend | [phase-4a.md](specs/phase-4a.md) | no | State definitions (YAML records), `session.state.turns`, the fold in `shared`, State Read / State Write, buffered writes, `{{state.*}}`, `trigger.turn`, Draw's `avoidRecent`, `GET /api/sessions/:id/state`, `editedAt` on edits, seeded `scene` definition |
| 4b. Story state, web | [phase-4b.md](specs/phase-4b.md) | yes | Definitions editor in L; "Story state" section in `ChatPanel` with sparklines; per-message chip; delete confirmation listing what is undone |
| 5. Post-turn runs | [phase-5.md](specs/phase-5.md) | yes | After Reply node, second run on the session's turn queue (derived seed `${seed}:post`, see AGENTS.md "Randomness"), post status on the turn, UI status and failure toast |
| 6. History summaries | [phase-6.md](specs/phase-6.md) | yes | `session.summaries` per set, fingerprint validity, Next Chunk / Save Summary, Memory `summarySet`, panel section |
| 7. Trigger + example + guide | [phase-7.md](specs/phase-7.md) | yes | Trigger node; seeded "Fresh texture" example (collection, preset, workflow; idempotent seeds; seeded-workflows test); user guide `docs/STATE-AND-LORE.md` folding in the howto files |

Then finish with a summary for the user: what is testable and how (`npm run dev`), the checkpoint
branches, known limitations, and links to the guide.

## How to run a phase

1. Read [PHASE-WORKFLOW.md](PHASE-WORKFLOW.md): it holds the Workflow-tool script used for every phase.
   Pass it as `script` (or save it and use `scriptPath`) with these `args`:

   ```json
   {
     "phase": 4,
     "title": "Story state, backend",
     "base": "<sha of HEAD before the phase>",
     "ui": false,
     "scratch": "<the session's scratchpad directory>",
     "spec": "<contents of the spec file, with the context paragraph>"
   }
   ```

   It writes the plan to `<scratch>/plans/phase-N.md` and a "how to try it" note to
   `<scratch>/plans/phase-N-howto.md`. Copy the howto into [howto/](howto/) when the phase is done.
   For 4a/4b use `"phase": "4a"` / `"4b"`.
2. The script spends 10 to 12 agents and roughly 60–90 minutes per phase.
3. **Session limits:** runs have been cut twice by "You've hit your session limit · resets HH:MM
   UTC". Wait for the reset, then re-invoke with the same `args` plus `resumeFromRunId` (the run id in
   the launch result): completed agents replay from cache. The fix prompt already tells a fixer to
   finish uncommitted partial work left by an interrupted one.
4. **Verify before checkpointing:** `git status` clean, `npm run check` green (note the test count),
   skim the core diffs, then push the working branch and the checkpoint branch.
5. Uncommitted changes while an agent works are normal: don't commit them yourself (a stop hook may ask;
   explain instead). Commit trailers the agents use:

   ```
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: <the new session's URL>
   ```

## Environment notes

- The cloud container is Linux with bash; AGENTS.md's Windows/PowerShell notes don't apply here.
- Run `npm ci` first in a fresh container (Biome isn't found otherwise).
- Chromium and Playwright are available at `/opt/pw-browsers` (don't run `playwright install`); the UI
  reviewer uses them for live checks against a server started from a temp data directory.
- Never run anything against `apps/server/data`.

## Open notes for the remaining phases

- **Preset inputs are only text or messages**, so `{{input.seed.level}}` can't work in a preset. Draw has
  a `level` output; phase 7's seeded example must word the seed by level through wiring (see the note
  at the top of [phase-7.md](specs/phase-7.md)).
- Template macros inside collection entry text are not rendered (documented in `docs/COLLECTIONS.md`).
- AGENTS.md says the orchestrator owns it; agents have been updating its key contracts as part of each
  phase, and the orchestrator reviewed those edits. Keep doing that, and keep PLAN.md untouched.
- Phase 3 added a `409 COLLECTION_IN_USE` guard on collection delete and a `neverSkips` input flag
  (Recall's optional `text` input); both are documented in AGENTS.md.
