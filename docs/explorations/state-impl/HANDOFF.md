# State and creativity implementation: handoff

First written 2026-10-16 (after phase 3), updated 2026-10-19 after phase 7 (the plan is complete). It is everything a fresh
orchestrator needs to finish the plan in [STATE-DESIGN-PROPOSAL-3.md](../STATE-DESIGN-PROPOSAL-3.md).
All phases are done. Next work is chosen from [FOLLOW-UPS.md](FOLLOW-UPS.md); a new session can be told:
*"Read docs/explorations/state-impl/HANDOFF.md and FOLLOW-UPS.md, then do <item>."*

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
| `ccr-461e3fdb-9k78xl` | Working branch for phases 6–7 (the third session's designated branch): all phases; a PR to `main` is open from it. A new session gets its own designated branch: start it from this one (or from `claude/state-impl-phase-6`) and continue there. |
| `claude/state-impl-phase-1` | Checkpoint after phase 1 (`b3fd32b`) |
| `claude/state-impl-phase-2` | Checkpoint after phase 2 (`4465609`) |
| `claude/state-impl-phase-3` | Checkpoint after phase 3 (`9d852a9`) |
| `claude/state-impl-phase-4a` | Checkpoint after phase 4a |
| `claude/state-impl-phase-4b` | Checkpoint after phase 4b |
| `claude/state-impl-phase-5` | Checkpoint after phase 5 |
| `claude/state-impl-phase-6` | Checkpoint after phase 6 (the separate summary store, superseded by 6b) |
| `claude/state-impl-phase-6b` | Checkpoint after phase 6b |
| `claude/state-impl-phase-7` | Checkpoint after phase 7: the whole plan |

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
| 7. Trigger, examples, guide | **Trigger** (score `clamp01((baseChance + growthPerTurn × turnsSinceLastFiring + Σ weight × signal) × (0.5 + volatility))`, per-level cooldowns and weights, implicit node state `fires`, dynamic `neverSkips` signal ports, a custom panel); **Pick Fields** (generic: keep named fields of an object); **example packs** for existing users too (`seed-examples.ts`, ledger `data/.seeded.json` with `<pack>/<kind>:<id>` lines: never overwrite, deleted stays deleted, fit rules for name clashes, all or nothing, never blocks startup): "Fresh texture" (Chat Settings → Trigger → Draw → Pick Fields → State Write, leveled preset) and "Rolling summaries" (`memory` definition, amendment 1 wiring); example presets = Default + extras; user guide `docs/STATE-AND-LORE.md`; readable edge labels on the dark canvas | 3012 |

How to use all of it, written for the user: [docs/STATE-AND-LORE.md](../../STATE-AND-LORE.md) (the per-phase how-to notes were folded into it and removed).

## Remaining work

None in this plan. Follow-ups (fixes deferred by the user, small features, proposal 3's Part 7 and
amendment 1's "Later") are listed with sizes and a suggested order in [FOLLOW-UPS.md](FOLLOW-UPS.md).
User decisions of 2026-10-19: the pre-existing issues and the post-run retry are for later; the next
features are picked from the follow-up plan after the user has tried the build; examples are seeded into
existing data (once, never overwritten); the work reaches `main` through one PR the user merges.

## How to run a phase

**Recommended: the Agent tool with the briefs in [agent-briefs/](agent-briefs/README.md)** (how phases
4a–5 ran). Copy `agent-briefs/common.md` and `agent-briefs/roles/` to the session's scratchpad, fill in
the placeholders, write `<scratch>/briefs/phase-<N>.md` (header, then the spec file), and run the 4–5 agent
pipeline described in the briefs' README. Every agent prompt is short: "read common.md, the phase brief
and your role file, then …".

Phases 1–3 used an older 12-agent Workflow-tool script (removed; it is in the git history before the phase 7 checkpoint).

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

## Open notes

- **Process:** AGENTS.md is the orchestrator's; agents update its key contracts as part of each phase and
  the orchestrator reviews those edits. Coding agents never touch PLAN.md (the orchestrator marks finished
  backlog items there). Run the backend reviewer in parallel with implementer B once the backend commits
  are final, then the web reviewer and the live UI reviewer together (phases 6–7).
- **Preset inputs are only text or messages**, so a preset can't read an object such as `{{input.seed.level}}`;
  wire the parts in separately (the Fresh texture example passes Draw's `text` and `level` as two inputs).
- **Limitations:** the user-facing ones are in the guide's "Known limitations"; the ones worth work, and
  the pre-existing issues seen in the live checks, are in [FOLLOW-UPS.md](FOLLOW-UPS.md). Implementation
  notes not in either: a skipped example pack is only reported in the server log; a Fresh texture seeded
  before Pick Fields keeps its old wiring (it works, and logs dropped fields); Pick Fields names are
  comma-separated; the definitions editor's cap note can't check which workflows use a key.
