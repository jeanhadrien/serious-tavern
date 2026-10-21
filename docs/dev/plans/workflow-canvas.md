# Workflow canvas: plan

Fourteen improvements to the workflow editor (`apps/web/src/pages/workflows/`, React Flow 12.12). Nothing here is
built yet. When an item lands, move what it decided into `docs/dev/reference/` and the `AGENTS.md` files, and strike it
from this plan. Delete the file once it is empty.

Out of scope: MiniMap, alignment guides, subflows, cmdk, performance work.

Read first: the root `AGENTS.md`, `apps/web/AGENTS.md`, `apps/web/src/pages/workflows/AGENTS.md`,
`packages/engine/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/node-ui/AGENTS.md`,
`apps/server/src/services/AGENTS.md`, `docs/dev/reference/web.md` (workflow editor) and `engine.md` (executing, logs).

## What the code says, against the brief

The brief came from an earlier review. These points differ from it and shape the plan:

- **Item 10's check is not in the engine.** The template check is shared: `analyzeTemplate` in
  `shared/src/template-analysis.ts`, and `presetWarnings` in `shared/src/preset.ts` on top of it. The engine's
  `renderTemplate` swallows template failures, and `prepareWorkflow` never looks at node template fields. Only three
  node types have template fields today: Chat Output, Condition and HTTP Request (whose `headers` are key/value rows).
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
- **Item 1: the palette is not sorted.** It renders the registry order. `connectCandidates` sorts by category then
  label, and its comment says "like the palette", which is not true today.
- **Item 2: React Flow 12.12 has no pane double-click callback.** Its `zoomOnDoubleClick` (on by default) uses the
  gesture. The matching logic already has one home, `filterCandidates` in `connectCandidates.ts`; the real change is
  a picker with no origin port.
- **Item 3:** confirmed. `notifyError` joins the issues into one toast. The editor's `validate` saves first, then
  highlights only the first issue's `edgeId`. Some issues carry no ids at all: the cycle, the missing sink, the
  settings declarations, and a missing Chat Input (`nodeIds: []`).
- **Item 5:** confirmed. Executor line ~131 (not needed) and line ~194 write `skipped` with no reason. Line ~194
  covers two causes: every gating connection is inactive, or a required input's source was skipped.
- **Item 6:** the editor store's `focus` is a single string, used only for an edge id (`url.ts`, `routes.ts`,
  `useLayoutUrl.openItem`, `editorStore`, `useWorkflowEditor`).
- **Item 7:** descriptors are JSON, sent through `/api/node-types`, so a formatter function can't live there. Also,
  `nodeTypeDescriptorSchema` is a plain `z.object`, which strips unknown keys.
- **Item 13 is the largest item.** See its section.

## A rule for every overlay

Issue badges (3), live run status (8) and config summaries (7) are **not part of the draft**. Never store them in
node `data`. The history's `snapshotOf` copies `data`, so an undo would bring back stale badges.

Derive them at render instead, as `visibleEdges` already does for edges. Provide them to `WorkflowNode` through one
React context (call it `CanvasOverlayContext`) holding:
- issues by node id;
- run status by node id;
- the catalogs that summaries need.

Record this rule in `pages/workflows/AGENTS.md` with the first item that adds an overlay.

## Order

One feature per commit. `npm run check` before each one. Phases run in order; items inside a phase are mostly
independent.

| Phase | Commits |
| --- | --- |
| A. Canvas basics (web only) | 12 required dot · 11 touch · 1a shared type order · 1b palette groups · 2 quick add · 14 Tidy |
| B. Validation | 10a shared template check · 4 draft validation endpoint · 3 issues on the canvas · 10b template checks in panels |
| C. Runs | 5 skip reasons · 6 node focus · 8a stream contract · 8b live status · 9a move coercion to shared · 9b last run in the panel |
| D. Larger additions | 7 node summaries · 13 sticky notes |

Phase C builds the cross-view store in 8b, and 9b reuses it. 13 comes last because it touches every reader of the
canvas `nodes`. Tidy (14) must then learn about notes; see the open questions.

---

## Phase A: canvas basics

### 12. Required-input dot

- **Goal:** a small dot on each input whose port has `required: true`. Not for `requiredIfConnected`, which only
  matters once the input is connected.
- **Decision:** a plain dot that never changes colour. An unconnected required input is already an engine issue
  ("needs a connection"), so item 3's badge reports it. A second, client-side copy of that rule would break "a rule
  has one home".
- **Touches:** `WorkflowNode.tsx`, `workflows.css`.
- **Rules:** `PortDef.required` as resolved. Dynamic ports already carry the flag after resolution.
- **Docs:** `docs/WORKFLOWS.md` (ports), `reference/web.md`.

### 11. Touch: bigger handles and a connection radius

- **Goal:** larger handle hit areas and `connectionRadius` on `<ReactFlow>` when `(pointer: coarse)`.
- **Touches:**
  - `WorkflowCanvas.tsx`: the existing `useMediaQuery('(pointer: coarse)')`, then `connectionRadius` (around 40, against
    the default 20);
  - `workflows.css`: an `@media (pointer: coarse)` rule on `.react-flow__handle`, with an invisible `::after` hit area
    so the drawn handle keeps its size.
- **Risks:** a larger hit area overlaps the port label row and can steal taps meant for selecting the node. Keep it
  to the node's edge. On the Windows machine this needs a manual check (DevTools touch emulation).
- **Docs:** `docs/dev/design/FRONTEND-UX.md` (touch notes).

### 1a. One order for node types

- **Goal:** the palette, the connect picker and quick add list node types in one order.
- **Touches:** a small pure module in `pages/workflows/` (for example `nodeTypeOrder.ts`, with table tests), holding
  - `compareTypes`: category, then label (moved out of `connectCandidates`);
  - `groupByCategory(types)`: returns `{ category, types }[]` in that order.
- **Rules:** the ordering lives only there; `connectCandidates` calls it.

### 1b. Palette categories

- **Goal:** each category is a native `<details>`/`<summary>`. The open state of each category is remembered per
  browser through `safeStorage` (one key, `st.palette.open`, a JSON map from category to boolean; every read and write
  guarded). A category opens by default. No search box. The "Port types" legend and the hint stay below the groups.
- **Categories with a single node.** Today these are AI (LLM), Creativity (Trigger) and Integration (HTTP Request).
  **Decision:** the palette renders a category with exactly one type as a plain button at group level, with the
  category as its small caption (as now), not as a `<details>`. Reasons:
  - A one-item disclosure costs a click and saves nothing. LLM, the node users add most, would sit behind it.
  - The rule is generic (a count), so there is no per-category branch, and it holds as new types arrive. The day
    Creativity gets a second node, it becomes a group on its own.
  - The categories themselves are the engine's (`definition.category`). They also show on node headers, in the
    picker and as headings in `docs/WORKFLOWS.md`, so the palette should not rename or merge them.

  Moving Random from Logic into Creativity is a defensible engine change, since both draw with `ctx.random()`. It is
  not needed here; see the open questions.
- **Phone (< 560px container):** the palette is a horizontal scrolling strip. `<details>` inside a flex strip needs
  explicit CSS:
  - Each `details` is a flex item whose summary is a chip.
  - An open group's buttons follow the chip in the same row: an inner wrapper with `display: flex`, since
    `display: flex` on `details` itself is not reliable across browsers.
  - Lone types are plain chips.
  - The remembered open state applies in both layouts.

  This needs a manual check on a narrow window. The strip must not grow taller than one row.
- **Touches:** `NodePalette.tsx`, `workflows.css`.
- **Docs:** `docs/WORKFLOWS.md` (the editor), `reference/web.md`, `pages/workflows/AGENTS.md` (the singleton rule and
  the storage key).

### 2. Quick add (double-click, `/`)

- **Goal:** a double-click on empty canvas, or `/` while the canvas area has the keyboard, opens `ConnectPicker`
  listing every node type (except a second Chat Input). Picking one adds the node, with no edge.
- **Touches:**
  - `connectCandidates.ts`:
    - the origin becomes optional; with none, every type is a candidate and `port` is absent (`coerce` false);
    - `filterCandidates` stays the one matching rule. It reads `port.label` and `port.name` today, so it needs
      `port?.` handling, with a test.
  - `useConnectPicker.ts`:
    - `PickerState.from` becomes optional;
    - a second entry point, `openAt(screenPoint)`;
    - `pick` adds an edge only when `from` is set.
  - `ConnectPicker.tsx`: with no port, the caption shows the category alone (no port label, no "→ text"), and the
    aria label and empty-list text differ.
  - `WorkflowCanvas.tsx`:
    - `zoomOnDoubleClick={false}`;
    - `onDoubleClick` on the `.canvas` wrapper, acting only when the target is inside `.react-flow__pane` (never a
      node, edge, control or panel).
  - Keyboard: `/` is a new area shortcut: a `matchShortcut` result, an `AreaShortcut` member, a `SHORTCUTS` entry and
    a `useShortcutArea` handler name (see `apps/web/AGENTS.md`).
- **Where `/` places the node:** see the open questions. The default proposal is the last pointer position over the
  canvas, else its centre.
- **Risks:**
  - Disabling double-click zoom removes a gesture people use. The Controls' zoom buttons and the wheel remain.
  - Match `/` on `event.key` with Shift allowed: on AZERTY, `/` is Shift+`:`.
  - `areaShortcutAllowed` already keeps `/` out of fields.
  - Firefox's quick find is also bound to `/`; the handler's `preventDefault` covers it.
  - On a phone a double tap may be eaten by the browser's own zoom. Check it manually.
- **Docs:** `docs/WORKFLOWS.md`, `FRONTEND-UX.md` (the shortcut table and the canvas section), `reference/web.md`
  (connect picker), the palette hint text.

### 14. Tidy (auto-layout)

- **Goal:** a "Tidy" button in the canvas `Panel` lays out every node once with `@dagrejs/dagre` (left to right, since
  inputs are on the left and outputs on the right). It is one undo step, followed by a `fitView`.
- **Touches:**
  - a pure `tidyLayout.ts`: (nodes with sizes, edges) → positions, with tests;
  - `useWorkflowCanvas` calls `recordStep()` once, then `setNodes`;
  - `apps/web/package.json` gets the dependency.
- **Rules:**
  - Sizes come from `node.measured`, with a fallback size for unmeasured nodes.
  - Unknown-type placeholders are laid out like any node.
  - Ranks follow edges only; dagre ignores which port an edge uses, so crossings inside a rank are possible.
- **Risks:**
  - A new dependency means `package-lock.json` changes and knip must see it used. Check that its types ship with the
    package; otherwise knip and typecheck need `@types`.
  - A disconnected node lands in its own column.
  - Tidy rewrites every position, so an undo is the way back. Don't ask for confirmation: it is a draft edit
    (`FRONTEND-UX.md`, "inside a draft, no confirmation").
- **Docs:** `docs/WORKFLOWS.md`, `reference/web.md` (history: what counts as a step), `pages/workflows/AGENTS.md`
  (Tidy is one `recordStep`).

---

## Phase B: validation

### 10a. One template check in shared

- **Goal:** pull the per-template part of `presetWarnings` into a shared helper, for example
  `templateWarnings(template, { inputKeys? })`. It runs `analyzeTemplate` and `findMacro`, and checks `input.<key>`
  against `inputKeys` when given. `presetWarnings` calls it, so preset behaviour is unchanged.
- **Touches:** `shared/src/preset.ts`, a new export next to `template-analysis.ts`, table tests.
- **Rules:** the template check has one home in shared. Presets pass no `inputKeys` (their inputs are checked
  separately); nodes pass their input port names.

### 4. Validate the draft

- **Goal:** the editor validates the canvas as it is, without saving, debounced while editing. The rules stay in
  `prepareWorkflow`.
- **Contract (`shared/src/api/workflows.ts`):**
  - a new `validateWorkflowDraft` endpoint, `POST /api/workflows/validate`;
  - its body is `workflowSchema.pick({ nodes, edges, settings })` (and `notes` once item 13 lands);
  - it answers **200** `{ issues: ValidationIssue[] }`. Issues are the expected answer here, not a failure, and a 422
    would be toasted by the client.
  - The existing `POST /api/workflows/:id/validate` stays as it is: the contract keeps it, and `app.test.ts` keeps
    exercising it.
- **Server:** a thin handler in `routes/workflows.ts` calling `validateWorkflow`. It writes nothing and needs no lock.
  The body has no `id`, `name` or timestamps, while `validateWorkflow` takes a whole `Workflow`.
  - Narrow its parameter to the fields `prepareWorkflow` reads: `Pick<Workflow, 'nodes' | 'edges' | 'settings'>`, plus
    `id` if `prepared.workflow.id` is used later.
  - Placeholders would also work, but they would leak into issue details sooner or later. The contract entry, the route and the `app.test.ts` coverage land in one commit.
- **Web:**
  - `workflowsApi.validateDraft`, called with `{ silent: true }`;
  - a `useDraftValidation` hook: about 600 ms after the last change to nodes, edges or settings, and once on load;
  - one request in flight, stale answers dropped (the dynamic ports hook has the pattern).
- **Gotchas:**
  - The draft keeps chat settings declarations that don't parse (`withDraftSettings`), so the body parse would answer
    400 on every debounce. Send only the declarations that parse; the settings panel already shows the rest
    (`unsavableSettings`).
  - The YAML repositories rescan their directory on every `get`, and dynamic ports resolve again on each call. Keep the
    debounce; never validate per keystroke.
  - Issue messages name nodes with `nodeDisplayName` over the draft's node order. That is the same rule as the canvas
    (`withDisplayNames`), so names match.
- **The Validate button:** it no longer saves first. See the open questions on whether it stays.
- **Docs:**
  - `reference/api.md` (the new endpoint);
  - `docs/WORKFLOWS.md`: the "Validate in the toolbar" text changes, and issues show while editing;
  - `reference/web.md`;
  - `pages/workflows/AGENTS.md`: validation runs on the draft, debounced and silent; settings that don't parse are
    left out.

### 3. Issues on the canvas

- **Goal:**
  - Every node named in an issue's `nodeIds` gets a badge (count, with the messages as tooltip).
  - Every edge named in an `edgeId` gets the red outline, not only the first.
  - A clickable issue list: a toolbar toggle with a count, like Chat settings, opening a list over the canvas.
    Clicking an issue selects its nodes (and edge) and fits the view to them (`fitView({ nodes })`).
- **Source:** item 4's answer. Without item 4, the same list would come from the old endpoint's 422 details.
- **Touches:**
  - `useWorkflowCanvas`: `highlightedEdge` becomes a set of issue edges, plus the one-shot URL edge;
  - `visibleEdges` styling;
  - `WorkflowNode` reads the badge from the overlay context;
  - a new `IssueList.tsx`, through `useEscapeLayer`;
  - `WorkflowToolbar.tsx`.
- **Issues with no ids** (a cycle, no sink, a missing Chat Input) appear in the list, not on the canvas; clicking
  them does nothing. Settings issues already show in the settings panel and its toolbar count, so leave them out of
  this list. An issue does not say where it comes from, so this means matching messages against
  `workflowSettingIssues(settings)` on the client. See the open questions.
- **Risks:** the chat's `WORKFLOW_INVALID` toast with its `edge=` link stays. Once the editor validates on open, the
  link's highlight is redundant but harmless. Keep the param: it is also a legacy alias.
- **Docs:** `docs/WORKFLOWS.md`, `reference/web.md`, `pages/workflows/AGENTS.md` (overlays, the overlay context).

### 10b. Template checks in node panels

- **Goal:** under each template field of the generic form (`descriptor.templateFields`), show warnings from
  `templateWarnings(value, { inputKeys: descriptor.inputs.map(p => p.name) })`, the way the preset editor does. For
  HTTP Request's key/value `headers`, check each row's value.
- **Touches:** `node-ui/src/index.tsx` (`GenericPanel`'s `hints`) and node-ui tests. Condition has a custom panel, but
  it renders `GenericPanel` under a hint, so it is covered. A future custom panel that draws its own template field
  must call the same helper.
- **Decision to confirm:** warnings stay in the panel only and never become validation issues. See the open
  questions.
- **Docs:** `docs/TEMPLATING.md` (where warnings appear), `node-ui/AGENTS.md` (template warnings come only from the
  shared helper).

---

## Phase C: runs

### 5. Why a node was skipped

- **Schema (`shared/src/models.ts`, `nodeExecutionSchema`):** a new optional `skip` field:
  - `reason`: one of `'not-needed'`, `'inactive-inputs'`, `'source-skipped'`;
  - `by`: an optional node id, for `source-skipped` (the upstream node that caused it).
  - Use `.optional().catch(undefined)` so an unreadable value never fails a log. Additive only; old logs have no
    reason.
  - Codes and ids, never free text ("data travels as data"). The plain words live in one shared function
    (`skipReasonText`), used by the chat's Execution details and the editor.
- **Engine (`executor.ts`):** the "not needed" site writes `not-needed`. The branch site splits its two causes from
  the booleans it already computes. The `node:skipped` event carries the same object as `detail`.
- **Merge** is exempt from the required-input rule; its skips can only be `inactive-inputs`.
- **Web:** `ExecutionDetails.tsx` shows the reason next to `skipped`.
- **Docs:** `reference/engine.md` (execution logs), `engine/AGENTS.md` (every skip records a reason code), the shared
  schema comment.

### 6. "Show on canvas" from Execution details

- **Goal:** each node row in Execution details gets a "Show on canvas" link. It opens the run's workflow (`workflowId`
  from the log) and selects and fits that node. It is one-shot, like `edge=`.
- **Touches:**
  - `layout/url.ts`: a new `node=<id>` param, one-shot like `edge`;
  - `layout/routes.ts`, `useLayoutUrl.openItem`;
  - `stores/editorStore.ts`: the store is generic, shared by every editor. Give it a focus type parameter, defaulting
    to `string`, so the workflow store takes `{ edge?: string; node?: string }` and the other editors are untouched.
    This is better than a prefixed string (`node:<id>`), which every reader would have to parse. Update its tests;
  - `useWorkflowEditor` applies the focus;
  - `ExecutionDetails.tsx` builds the link with `layoutHref`.
- **Rules:** a clicked link goes through `confirmSwitch` (existing `openItem` behaviour). Opening the workflow that is
  already open only moves the focus and keeps the draft.
- **Gotchas:**
  - The node may no longer exist: the workflow was edited after the run, or the log belongs to a fork's source. Show
    an info toast ("This node is no longer in the workflow") and open the workflow anyway.
  - A deleted workflow: `openItem` already closes the editor.
- **Docs:** `apps/web/AGENTS.md` (the URL params list), `reference/web.md` (shell and URL).

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

1. **Categories (item 1).** The plan keeps the engine's categories and only changes how a lone category renders. Do
   you also want Random moved to Creativity in the engine? That is a real regrouping, and it changes node headers and
   the `docs/WORKFLOWS.md` headings.
2. **Where `/` places the node (item 2):** the last pointer position over the canvas, the canvas centre, or next to the
   selected node, connected to it?
3. **The Validate button (items 3, 4).** Once issues are live, does the button stay as "validate now", or is the issue
   count its replacement?
4. **Settings issues in the issue list (item 3).** Show them there too, or only in the settings panel? Filtering them
   out means matching messages, because an issue does not say where it comes from. An optional `source` field on
   `ValidationIssue` would be cleaner, and it is additive.
5. **Template problems (item 10).** Panel-only warnings, or engine validation issues as well (so they badge the node
   and appear in item 3's list)? A syntax error renders the template verbatim at run time, which arguably is an error.
6. **Which "last run" (item 9):** the open chat's last run of the workflow (proposed), or any chat's? Any chat needs a
   per-workflow index of executions on the server, which does not exist.
7. **Rebuild or record inputs (item 9).** Rebuilding (proposed) is approximate even with the version stamp. Recording
   each node's inputs in the log is exact, but it bloats every log: every LLM node's `history` would be stored again.
8. **Live status after the reply (item 8).** Is reply-section-only acceptable, or should after-section runs publish
   too? That would mean another channel, such as `/api/events` or a per-chat SSE.
9. **Notes (item 13):** separate state (a, proposed) or a second node type (b)? Should Tidy (14) move notes, and
   should copy and paste carry them? The proposal: Tidy leaves notes where they are, and copy and paste come later.
   Undo and the dirty check are required either way.
10. **Skip reason granularity (item 5):** is `by` (the upstream node) worth storing, or is the code enough?
