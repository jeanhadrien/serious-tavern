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

- **Item 9 has no data source.** No endpoint lists the executions of a workflow, and scanning `data/executions`
  (one file per run) is not an option.
  - `coerceValue` and `stringify` now live in shared, beside `canConnect`, so the web can use them.
  - The execution log does not record which version of the workflow ran.
- **Item 7:** descriptors are JSON, sent through `/api/node-types`, so a formatter function can't live there. Also,
  `nodeTypeDescriptorSchema` is a plain `z.object`, which strips unknown keys.
- **Item 13 is the largest item.** See its section.

## Overlays

The rule is recorded in `pages/workflows/AGENTS.md` (overlays are never part of the draft). `CanvasOverlayContext`
exists and holds the issues by node id and the live run status by node id. Node summaries (7) add the catalogs they need.

## Order

One feature per commit. `npm run check` before each one. Phases run in order; items inside a phase are mostly
independent.

| Phase | Commits |
| --- | --- |
| C. Runs | 9b last run in the panel |
| D. Larger additions | 7 node summaries · 13 sticky notes |

13 comes last because it touches every reader of the
canvas `nodes`. Tidy (14) must then learn about notes; see the open questions.

---

## Phase C: runs

### 9b. Last run in the config panel

- **Goal:** the config panel shows the selected node's inputs and output from the last run of this workflow, collapsed
  by default.
  - The output is the log's `nodes[id].output`.
  - The inputs are rebuilt from the upstream outputs in the log, the draft's edges, and `canConnect` plus `coerceValue`
    (shared `coerceValue`).
  - Skipped nodes show the item 5 reason.
- **Which run:** see the open questions. The default proposal is the open chat's most recent run of this workflow,
  from the session's turn entries (`readTurnEntries`, `runs[]` holds `workflowId` and `executionId`). The live store
  (`stores/runActivity.ts`) keeps no run id and clears after the turn, so it is no source. The log comes from `executionsApi.get`, which is already cached by id.
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
4. **Notes (item 13):** separate state (a, proposed) or a second node type (b)? Should Tidy (14) move notes, and
   should copy and paste carry them? The proposal: Tidy leaves notes where they are, and copy and paste come later.
   Undo and the dirty check are required either way.
