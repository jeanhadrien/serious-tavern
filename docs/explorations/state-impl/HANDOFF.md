# State and creativity implementation: handoff

First written 2026-10-16 (after phase 3), updated 2026-10-19 after phase 6b. It is everything a fresh
orchestrator needs to finish the plan in [STATE-DESIGN-PROPOSAL-3.md](../STATE-DESIGN-PROPOSAL-3.md).
Start a new session on this repository and tell it: *"Read docs/explorations/state-impl/HANDOFF.md and
continue with phase 7."*

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
- **After phase 6 (amendment 1):** any collection item can link to chat messages, and summaries are
  story state (linked items of a collection key), not a separate store. The design is
  [STATE-DESIGN-AMENDMENT-1.md](../STATE-DESIGN-AMENDMENT-1.md); phase 6b implements it.
- Sub-agents are Sonnet; the pipeline is the lean one in [agent-briefs/](agent-briefs/README.md)
  (4 agents per phase, 5 with UI), not the 12-agent one phases 1–4b used.

## Where things are

| Branch | Content |
| --- | --- |
| `main` | The design docs (proposals 1–3, reviews 1–2). Do not push implementation work here unless the user asks. |
| `claude/state-impl` | Working branch for phases 1–3 and the first version of this handoff. |
| `ccr-b85e38c4-41l3eu` | Working branch for phases 4a–5 (the second session's designated branch). |
| `ccr-461e3fdb-9k78xl` | Working branch for phase 6 (the third session's designated branch): all phases so far. A new session gets its own designated branch: start it from this one (or from `claude/state-impl-phase-6`) and continue there. |
| `claude/state-impl-phase-1` | Checkpoint after phase 1 (`b3fd32b`) |
| `claude/state-impl-phase-2` | Checkpoint after phase 2 (`4465609`) |
| `claude/state-impl-phase-3` | Checkpoint after phase 3 (`9d852a9`) |
| `claude/state-impl-phase-4a` | Checkpoint after phase 4a |
| `claude/state-impl-phase-4b` | Checkpoint after phase 4b |
| `claude/state-impl-phase-5` | Checkpoint after phase 5 |
| `claude/state-impl-phase-6` | Checkpoint after phase 6 (the separate summary store, superseded by 6b) |
| `claude/state-impl-phase-6b` | Checkpoint after phase 6b |

After each phase, push the working branch and create the next checkpoint:
`git push origin HEAD:refs/heads/claude/state-impl-phase-<N>`.

## Done

Every phase ended with an orchestrator check (`npm run check` green, clean tree, diff skim). AGENTS.md
was updated with every new contract; read its sections on sinks, randomness, chat settings, collections,
story state and post-turn runs.

| Phase | What it added | Tests |
| --- | --- | --- |
| 1. Engine foundations | Sink nodes (run even when no Chat Output needs them); a seed per run and `ctx.random()`; `ctx.log` → `nodes[id].logs`; the `requiredIfConnected` port flag; the **Random** node (number, integer, weighted pick, chance gate) and the **Parse JSON** node | 833 |
| 2. Chat settings | `workflow.settings` declarations and a "Chat settings" panel in the workflow editor; `session.settings` and `PATCH /api/sessions/:id` (`400 CHAT_SETTING_INVALID`, never moves `updatedAt`); `resolveChatSettings`; `{{settings.*}}` with hints; the **Chat Settings** node; the chat side panel `ChatPanel` (button in the chat header) | 1004 |
| 3. Authored collections | YAML records under `data/collections/`, API and `collections.changed`; list and editor in the right column; the **Recall** and **Draw** nodes with custom config panels; `docs/COLLECTIONS.md` | 1206 |
| 4a. Story state, backend | State definitions (YAML records under `data/state/definitions/`, API, `stateDefinitions.changed`, 409 rules, seeded `scene`); `session.state.turns` and the pure fold in `packages/shared/src/state/`; **State Read** and **State Write** (a sink; `when` gate input; fixed config `value`); buffered writes; `{{state.*}}`, `{{trigger.turn}}`; Draw `avoidRecent`; `GET /api/sessions/:id/state`; `editedAt`; definition edits prune workflow edges | 1894 |
| 4b. Story state, web | State definitions editor in L (`left=stateDefinition:<id>`, phone menu under Setup, disk sync, reactive name lock with "Duplicate as"); `state.*` hints; **State Read**/**State Write** panels with pickers and a typed fixed-value editor; one shared state-view fetch per chat feeding a "Story state" section in the chat panel (sparklines, "written at turn k", node memory), per-reply chips and a delete confirmation listing what is undone (shared fold); `useFileSync` shared by the provider, collection and definition editors | 2303 |
| 5. Post-turn runs | The **After Reply** node and the reply/post partition (`PreparedWorkflow.parts`; a Chat Output depending on After Reply is a validation issue); the post part runs after the reply is delivered, inside the turn's queue slot (the next message waits; Stop stops it; a queued message can be cancelled); seed `${seed}:post`; its writes join the turn's entry (undone with its replies), and nodes that also ran in the reply part write nothing in the post part; `postStatus`/`postError` per turn (a stored `running` the server no longer holds reads as "interrupted by a server restart", computed on read); status row above the composer, one failure toast, post details on the chip and failed runs listed in the Story state panel | 2541 |
| 6. History summaries | `session.summaries` per set (tolerant read, additive), a pure fingerprint/validity/chunk planner/composer in `packages/shared/src/summaries/` (the engine's seed hash moved to `shared/src/hash.ts`, output unchanged); **Next Chunk** (one chunk per run: the first invalid summary re-planned, else the next `chunkSize` uncovered messages outside `rawWindow`; optional `after` input for After Reply) and **Save Summary** (a sink; buffered like state writes via `SummaryRun`, `summaryWrites` on the result and on failures); Memory `summarySet` (a summary is used only when valid and wholly before the last-N raw part); commit in `settleTurn`/`settlePostRun` with a commit-time fingerprint re-check (dropped writes become `summaryWarnings` on the turn entry, shown on the turn chip), `replaces`, pruning of summaries with no message left; summaries are not turn state; `summaries` in `GET /api/sessions/:id/state`; a "Summaries" section in the chat panel (valid/invalid badge, markdown text, click scrolls to the first covered message via `data-message-id`) | 2768 |
| 6b. Message links; summaries as story state | Per [amendment 1](../STATE-DESIGN-AMENDMENT-1.md): the phase 6 store removed; collection items may carry `messages: { ids, fingerprint }` (only through State Write's new `messages` input on `add`: a link, a message or a list of messages); link status `intact/changed/partial/gone` computed on read (`packages/shared/src/links/`), with the shared `replaced` and chat-order (`repeated`) rules; commit-time link check in `settleTurn`/`settlePostRun` (`linkWarnings` on the turn entry and chip); snapshot items carry a read-only `link`; generic **Next Chunk** (collection key) and new **Unlinked Messages**; the `linked` template helper and State Read's `linked` mode; Memory restored plus `all`; Save Summary dropped; linked items, message markers ("Show in Story state"), edit/delete notes and the cap note in the web; checkbox hints in the generic form | 2881 |

How to try each one, written for the user: [howto/](howto/).

## Remaining work, in order

Specs are in [specs/](specs/). Each starts with a context note written at a checkpoint (phase 6 for 6b,
phase 5 for 7, with a 6b addendum); re-read the AGENTS.md sections it names and adjust it to what the code actually holds.

| Phase | Spec | UI | Notes |
| --- | --- | --- | --- |
| 4a–6b (**done**) | [phase-4a.md](specs/phase-4a.md), [phase-4b.md](specs/phase-4b.md), [phase-5.md](specs/phase-5.md), [phase-6.md](specs/phase-6.md), [phase-6b.md](specs/phase-6b.md) | | |
| 7. Trigger + example + guide | [phase-7.md](specs/phase-7.md) | yes | Trigger node (implicit node state like Draw's); seeded "Fresh texture" example (collection, preset, workflow; idempotent seeds; seeded-workflows test; decide how `scene` is seeded for users who already have definitions); user guide `docs/STATE-AND-LORE.md` folding in the howto files |

Then finish with a summary for the user: what is testable and how (`npm run dev`), the checkpoint
branches, known limitations, and links to the guide.

## How to run a phase

**Recommended: the Agent tool with the briefs in [agent-briefs/](agent-briefs/README.md)** (how phases
4a–5 ran). Copy `agent-briefs/common.md` and `agent-briefs/roles/` to the session's scratchpad, fill in
the placeholders, write `<scratch>/briefs/phase-<N>.md` (header, then the spec file), and run the 4–5 agent
pipeline described in the briefs' README. Every agent prompt is short: "read common.md, the phase brief
and your role file, then …".

**Alternative: the Workflow-tool script** in [PHASE-WORKFLOW.md](PHASE-WORKFLOW.md) (phases 1–3). It runs
the older 12-agent pipeline; trim its review lenses to spec, correctness and ui first. It needs the user
to opt into workflows explicitly.

Either way:

1. **Usage limits** ("You've hit your session limit · resets HH:MM UTC", and once a weekly limit) cut
   agents mid-task several times. A stopped agent keeps its transcript: after the reset, send it a
   message to continue; its uncommitted work is in the tree.
2. **Verify before checkpointing:** `git status` clean, `npm run check` green (run it twice: one race in a
   post-run test only showed under full-suite load), skim the core diffs, then push the working branch and
   the checkpoint branch.
3. Uncommitted changes while an agent works are normal: don't commit them yourself (a stop hook may ask;
   explain instead). Commit trailers:

   ```
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   Co-Authored-By: <the attribution line the harness gives>
   Claude-Session: <the session's URL>
   ```

## Environment notes

- The cloud container is Linux with bash; AGENTS.md's Windows/PowerShell notes don't apply here.
- Run `npm ci` first in a fresh container (Biome isn't found otherwise). `npm run check` takes about
  45 seconds here, not 7.
- Chromium and Playwright are available at `/opt/pw-browsers` (don't run `playwright install`). Live
  checks run the server from a temp data directory on a free port and vite with an out-of-repo config,
  because the `/api` proxy target in `apps/web/vite.config.ts` is hard-coded to `localhost:3001`.
- Never run anything against `apps/server/data`.
- Server tests leave an empty `.test-data/` directory; it is gitignored.

## Open notes for the remaining phases

- **Preset inputs are only text or messages**, so `{{input.seed.level}}` can't work in a preset. Draw has
  a `level` output; phase 7's seeded example must word the seed by level through wiring (see the note
  at the top of [phase-7.md](specs/phase-7.md)).
- Template macros inside collection entry text are not rendered (documented in `docs/COLLECTIONS.md`).
- AGENTS.md says the orchestrator owns it; agents update its key contracts as part of each phase, and the
  orchestrator reviews those edits. Keep doing that, and keep PLAN.md untouched.
- Known limitations carried forward from phase 5: a message waiting behind a post run gets no response
  bytes until the run ends; nodes needed by both parts run (and cost) twice; there is no retry for a
  failed or interrupted post run.
- Phase 6's summary store was replaced in phase 6b (README, AGENTS.md and the how-tos describe 6b; the
  phase 6 how-to carries a "superseded" note).
- Known limitations from phase 6b (details in [howto/phase-6b-howto.md](howto/phase-6b-howto.md)):
  deleting or regenerating the turn that wrote a summary removes it (the next turn redoes it); linked items
  can't be edited by hand; the cap note can't check workflows; linked text is sent whole in the state view.
  Pre-existing issues seen in the 6b live check, not fixed: a fresh LLM node toasts "Preset (none) not
  found", and Validate saves an invalid draft first (the chat then fails with "Workflow is invalid").
- Known limitations from phase 6 (details in [howto/phase-6-howto.md](howto/phase-6-howto.md)): Memory with a
  summary set sends older, not-yet-summarized history raw (Last N bounds only the raw part); chunks lag one
  turn (the post part sees the reply part's history); a failed post run stays listed in the panel after a
  later turn succeeds; post-run failure text names the node by its UUID (`failureMessage` in
  `apps/server/src/services/failure.ts`, predates phase 6; AGENTS.md wants `nodeDisplayName`); summaries
  can't be deleted by hand; `packages/engine/src/executor.ts` is ~390 lines, over the file-size guideline.
- Phase 6 ran the lean pipeline with one change worth keeping: the backend reviewer ran in parallel with
  implementer B (backend commits were final), then a web reviewer and the live UI reviewer ran together.
