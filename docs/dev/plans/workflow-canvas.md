# Workflow canvas: plan

Five improvements to the workflow editor (`apps/web/src/pages/workflows/`, React Flow 12.12) are left. Phases A (canvas
basics) and B (validation: draft endpoint, issues on the canvas, template warnings in panels) are built; they live in
`docs/dev/reference/web.md` and the `AGENTS.md` files. When an item lands, move what it decided there and strike it from this plan. Delete the file
once it is empty.

Out of scope: MiniMap, alignment guides, subflows, cmdk, performance work.

Read first: the root `AGENTS.md`, `apps/web/AGENTS.md`, `apps/web/src/pages/workflows/AGENTS.md`,
`packages/engine/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/node-ui/AGENTS.md`,
`apps/server/src/services/AGENTS.md`, `docs/dev/reference/web.md` (workflow editor) and `engine.md` (executing, logs).

## What the code says, against the brief

The brief came from an earlier review. These points differ from it and shape the plan:

- **Item 8: the server emits node events, but the web drops them.** `TurnStream.onEvent`
  (`apps/server/src/services/turn-stream.ts`) emits `node.start` and `node.complete`. It emits nothing for
  skipped, cancelled or failed nodes. `api/turnStream.ts` ignores both node events in its `default` branch.
  - Only the **reply section** streams. `after-section.ts` calls `executeWorkflow` without `onEvent`, and the stream
    has ended by then anyway. A workflow that runs after the reply can never light up live.
  - The stream belongs to the chat view's request (`useChat`). The editor has no access to it today.
- **Item 9 has no data source.** No endpoint lists the executions of a workflow, and scanning `data/executions`
  (one file per run) is not an option.
  - `coerceValue` and `stringify` live in `engine/src/text.ts`. The web does not depend on `@st/engine`.
  - The execution log does not record which version of the workflow ran.
- **Item 5:** confirmed. Executor line ~131 (not needed) and line ~194 write `skipped` with no reason. Line ~194
  covers two causes: every gating connection is inactive, or a required input's source was skipped.
- **Item 6:** the editor store's `focus` is a single string, used only for an edge id (`url.ts`, `routes.ts`,
  `useLayoutUrl.openItem`, `editorStore`, `useWorkflowEditor`).
- **Item 7:** descriptors are JSON, sent through `/api/node-types`, so a formatter function can't live there. Also,
  `nodeTypeDescriptorSchema` is a plain `z.object`, which strips unknown keys.
- **Item 13 is the largest item.** See its section.

## Overlays

The rule is recorded in `pages/workflows/AGENTS.md` (overlays are never part of the draft). `CanvasOverlayContext`
exists and holds the issues by node id. Live run status (8b) adds run status by node id to it, and node summaries (7)
the catalogs they need.

## Order

One feature per commit. `npm run check` before each one. Phases run in order; items inside a phase are mostly
independent.

| Phase | Commits |
| --- | --- |
| C. Runs | 8a stream contract · 8b live status · 9a move coercion to shared · 9b last run in the panel |
| D. Larger additions | 7 node summaries · 13 sticky notes |

Phase C builds the cross-view store in 8b, and 9b reuses it. 13 comes last because it touches every reader of the
canvas `nodes`. Tidy (14) must then learn about notes; see the open questions.

---

## Phase C: runs

### 8a. Stream contract for node outcomes

- **Contract (`shared/src/api/sessions.ts`, `turnEventSchema`):** add `node.skipped` (with item 5's `skip`),
  `node.error` and `node.cancelled`, each `{ nodeId, runId? }`. They are additive union members, and the web's
  `safeParse` already ignores types it doesn't know.
  - `node.error` carries no message: the log has it, and stream frames stay small.
- **Server:** `TurnStream.onEvent` emits them, in the same serial chain as the others.
- **Tests:** the server stream tests parse every frame with the contract (`app.test.ts` already does), so add a case
  with a skipped node and a failing one.
- **Docs:** `reference/turns.md` (streaming), `reference/api.md`.

### 8b. Live run status on the canvas

- **Goal:** while the open chat streams a run of the workflow open in the editor, its nodes show running, done,
  skipped, error or cancelled. The marks fade or clear at `turn.complete` or `turn.error`.
- **Cross-view state:** a small module store, for example `stores/runActivity.ts`:
  - `useChat` writes to it from `run.start` (`workflowId`, `runId`) and the node events;
  - the editor reads it.
  - This is the first time the chat publishes to another view, so keep the store tiny and free of session data.
- **Touches:**
  - `api/turnStream.ts`: handlers for the node events;
  - `useChat.ts`;
  - the new store;
  - `WorkflowNode` through the overlay context;
  - `workflows.css`.
- **Limits, to state in the guide:**
  - Only the **reply section** streams. Workflows that run after the reply don't light up (no `onEvent` in
    `after-section.ts`, and the stream has ended).
  - Only in the tab that sent the message.
  - Node ids match the **saved** workflow that ran. A draft that deleted or re-added nodes simply shows nothing for
    them.
- **Docs:** `docs/WORKFLOWS.md`, `reference/web.md`, `pages/chat/AGENTS.md` (the chat publishes run activity, never per
  token to the shell), `pages/workflows/AGENTS.md`.

### 9a. Move port coercion to shared

- **Goal:** `coerceValue` and `stringify` move from `engine/src/text.ts` to shared, next to `canConnect`. They are
  pure and belong with the coercion kinds `canConnect` returns. The engine imports them from there. No behaviour
  change; the engine's tests stay.
- **Why its own commit:** it makes "one home" true before the web needs the rule.
- **Docs:** `shared/AGENTS.md`, the root `AGENTS.md` "ports are typed" line (coercion lives with `canConnect`).

### 9b. Last run in the config panel

- **Goal:** the config panel shows the selected node's inputs and output from the last run of this workflow, collapsed
  by default.
  - The output is the log's `nodes[id].output`.
  - The inputs are rebuilt from the upstream outputs in the log, the draft's edges, and `canConnect` plus `coerceValue`
    (9a).
  - Skipped nodes show the item 5 reason.
- **Which run:** see the open questions. The default proposal is the open chat's most recent run of this workflow,
  from the session's turn entries (`readTurnEntries`, `runs[]` holds `workflowId` and `executionId`), or the `runId`
  item 8b stored. The log comes from `executionsApi.get`, which is already cached by id.
- **Greyed out:** greying when the draft is dirty is not enough. A save made after the run also changes the edges the
  inputs are rebuilt from. Add `workflowUpdatedAt` to the execution log (additive, optional; the engine stamps it from
  the prepared workflow). Grey the panel when the log's stamp differs from the saved workflow's `updatedAt`, or when
  the draft is dirty. Old logs have no stamp: grey. The server's edge prunes after a preset or definition update
  (`services/presets.ts`, `state-definition-usage.ts`) already bump `updatedAt`, so the stamp catches them too.
- **Touches:**
  - a pure `lastRunIO.ts` (log, node id, edges, ports) → `{ inputs, output, skip }`, with tests;
  - `WorkflowConfigPanel.tsx`;
  - `engine/executor.ts` (the stamp);
  - `shared/models.ts`.
- **Risks:**
  - Rebuilding is an approximation. `requiredIfConnected` skips, `neverSkips` inputs and dynamic ports that changed
    since the run are only right while the graph is unchanged; the stamp is what keeps that honest.
  - Large values: Chat Input's history and LLM outputs. Show them truncated, with an expander.
- **Docs:** `docs/WORKFLOWS.md`, `reference/web.md`, `reference/engine.md` (log fields).

---

## Phase D: larger additions

### 7. One-line config summary on each node

- **Goal:** a muted line under each node's header: the LLM's model and preset name, State Read/Write's
  `definition.key` and operation, Condition's operator, Random's mode, and so on.
- **Where:** node-ui exports `nodeSummary(descriptor, config, context): string | undefined`, backed by a per-type map
  next to `customPanels`.
  - Node-ui already holds per-type panels and receives the catalogs (preset id → name, definitions), so a summary can
    reuse the panels' helpers and their `Unknown … (id)` wording.
  - The editor calls only `nodeSummary`, with no per-type branch.
  - A type with no entry shows no line.
- **Touches:**
  - `node-ui/src/summaries.ts` and tests;
  - `WorkflowNode.tsx` reads the catalogs from the overlay context;
  - `useWorkflowEditor`/`WorkflowCanvas` provide that context.
- **Risks:** a summary must not widen the node; cut it with an ellipsis and use the full text as the tooltip.
- **Docs:** `node-ui/AGENTS.md` (summaries live in node-ui, beside panels; a new node type may add one),
  `engine/src/nodes/AGENTS.md` ("Adding a node type", step 4), `reference/web.md`.

### 13. Sticky notes

- **Goal:** free text notes on the canvas (movable, resizable, editable), saved with the workflow but outside `nodes`,
  so the engine never sees them.
- **Schema (`shared/src/models.ts`):**
  - `workflowSchema` gets `notes: z.array(noteSchema).optional()`, where `noteSchema` is
    `{ id, text, position, size? }`, passthrough;
  - a read helper `workflowNotes(workflow)` tolerates a missing field or a non-list, like `workflowSettings()`. Stored
    workflows are not parsed on read.
- **Contract:** add `notes` to the `updateWorkflow` and `createWorkflow` body picks, and to item 4's draft body. Check
  whether zod 4's `.pick` keeps passthrough on the picked object; don't rely on it either way.
- **Server:**
  - `createWorkflow` builds the record field by field, so copy `notes` there;
  - `updateWorkflow` merges the body;
  - like `settings`, an omitted `notes` keeps the stored ones.
- **Web: the hard part.** Every reader of the canvas `nodes` assumes `data.descriptor`: `canvasToWorkflow`,
  `checkConnection`, `withDisplayNames`, `connectCandidates`' Chat Input check, the clipboard, `useDynamicPorts`, the
  dirty snapshot and the history. Two shapes:
  - (a) Notes in their own state, merged into the `nodes` prop only at render. `onNodesChange` routes changes by id.
    The history snapshot gains a `notes` list.
  - (b) Notes as a second React Flow node type in the same array, with a type guard in every reader.

  (a) keeps the many readers untouched; (b) spreads a guard everywhere. **Proposal: (a).** See the open questions.
- **Engine:** nothing. `prepareWorkflow` reads only `nodes` and `edges`. Add a test that a workflow with notes
  validates and runs unchanged.
- **Required, not optional:**
  - Notes are part of the draft: `canvasToWorkflow` writes them and the dirty `snapshot()` includes them. Otherwise a
    note-only edit reads as clean, so the unsaved guard never asks, Ctrl/Cmd+S skips it, and Revert ignores it.
  - Editing a note records a history step, grouped like config edits (`note:<id>`).
  - The note's textarea needs React Flow's `nodrag` and `nowheel` classes.
  - Duplicate (`duplicateWorkflow`) copies the notes.
- Copy and paste of notes is out of this commit.
- **Docs:** `docs/WORKFLOWS.md`, `reference/storage.md` (the workflow record), `shared/AGENTS.md` (read through
  `workflowNotes`), `pages/workflows/AGENTS.md` (how notes sit beside the nodes), `reference/web.md`.

---

## Open questions

1. **Categories (palette, built in phase A).** The palette keeps the engine's categories and only changes how a lone category renders. Do
   you also want Random moved to Creativity in the engine? That is a real regrouping, and it changes node headers and
   the `docs/WORKFLOWS.md` headings.
2. **Which "last run" (item 9):** the open chat's last run of the workflow (proposed), or any chat's? Any chat needs a
   per-workflow index of executions on the server, which does not exist.
3. **Rebuild or record inputs (item 9).** Rebuilding (proposed) is approximate even with the version stamp. Recording
   each node's inputs in the log is exact, but it bloats every log: every LLM node's `history` would be stored again.
4. **Live status after the reply (item 8).** Is reply-section-only acceptable, or should after-section runs publish
   too? That would mean another channel, such as `/api/events` or a per-chat SSE.
5. **Notes (item 13):** separate state (a, proposed) or a second node type (b)? Should Tidy (14) move notes, and
   should copy and paste carry them? The proposal: Tidy leaves notes where they are, and copy and paste come later.
   Undo and the dirty check are required either way.
