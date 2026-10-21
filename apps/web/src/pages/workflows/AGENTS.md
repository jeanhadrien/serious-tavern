# Workflow editor — agent notes

## Canvas state
- Keep nodes and edges as **controlled state**. Don't rebuild them from workflow data on every render: that broke dragging and selection before.
- **Never drop nodes.** Unknown node types stay as read-only placeholders and are saved unchanged.
- The editor resolves the ports of dynamic nodes (`dynamicPorts: true`) and re-resolves them when the state definitions list changes. Never add per-type branches here. After handles change, refresh React Flow's node internals.
- A port resolution that fails toasts once per node (`createPortErrors`); the toast goes away when the node resolves or is deleted. A node that isn't set up yet toasts nothing.
- Edges to ports that disappear are pruned once the ports resolve successfully without them (the engine's `pruneInvalidEdges` rule). Prune the handle, never the node.

## Node type lists
- The palette, the connect picker and quick add list node types in one order, `nodeTypeOrder.ts` (category, then label). Never sort types anywhere else.
- The palette renders a category with exactly one type as a plain button (a count rule, never a per-category branch) and one with several as a `<details>`. Its open state is one `localStorage` key, `st.palette.open` (JSON map category → boolean, absent means open), read and written only through `paletteOpen.ts`, which guards both.

## Overlays
- Issue badges, edge marks and anything else derived from a run or a check (live status, config summaries later) are **not part of the draft**. Never put them in node `data`: the history's `snapshotOf` copies `data`, so an undo would bring back stale marks. Derive them at render, as `styleEdges` does for edges, and hand them to `WorkflowNode` through `CanvasOverlayContext`.
- The run streaming in the open chat (`runActivity`, only when it is a run of the open workflow) reaches `WorkflowNode` as `CanvasOverlayContext.runStatus`: marks, never draft data.
- Selecting what an issue names is selection only (`focusIssue`): no `recordStep`.

## Last run
- A node's last run is REBUILT, not recorded: inputs come from the sources' outputs in the log through `canConnect`/`coerceValue` (`lastRunIO`). It is only trustworthy while the graph is unchanged, so the panel greys on a dirty draft or a differing `workflowUpdatedAt` stamp (no stamp, always grey). Never present it as exact.

## Validation
- It runs on the draft, never on the saved workflow: debounced, silent, one request in flight (`useDraftValidation`). Never validate per keystroke: the server rescans the YAML repositories and resolves dynamic ports on every call.
- The body leaves out chat settings declarations that don't parse (`canvasToDraftBody`); the settings panel and `unsavableSettings` already report those.
- Issue messages name nodes with the same `nodeDisplayName` rule as the canvas, so a name in a message is the name on the node.

## Quick add
- It is the connect picker with no origin, never a second picker. A double-click acts only when its target is the `.react-flow__pane` element itself (nodes live inside the pane, so `closest` would match them). `/` is the `quickAdd` area shortcut, kept out of fields by `areaShortcutAllowed`.

## History (undo/redo)
- Snapshots hold nodes and edges without selection, `dragging`, `resizing` or `measured` (`snapshotOf`). A restore keeps the live nodes' `measured` (`restoreNodes`) so they don't blink out.
- The canvas calls `history.record(before?, groupKey?)` right BEFORE it changes nodes or edges. Calls in the same tick count once (one user action may change both); a `groupKey` repeated within a second joins the last step (`config:<nodeId>`); a drag records its start snapshot on drag stop, only if a node moved.
- Anything new that edits the draft calls `recordStep()` once before applying. Tidy is one `record()`, then `setNodes` with every new position: never one step per node.
- `load`/`clear` reset the history (so Revert does); saving doesn't.
- Edges pruned by dynamic ports are not recorded: that code uses the raw setters, never `record`. Undo and redo set nodes and edges directly, never through `onNodesChange`/`onEdgesChange` (that would record).

## Copy and paste
- Uses the native `copy` and `paste` events through `useShortcutArea` handlers, never `navigator.clipboard` (no permission, works across tabs). A handler returns true only when it acted, so a copy with nothing selected and a paste of ordinary text go on normally.
- The payload (`kind: 'serious-tavern/nodes'`, `version: 1`) and the paste rules are the pure `canvasClipboard.ts`. A paste is ONE `recordStep`.
- Node names always come from `withDisplayNames`, shared by adding and pasting.

## Settings and links
- The workflow's chat settings list stays raw in the draft (`withDraftSettings`): a declaration that doesn't parse is a read-only row the user can only remove, never dropped on load (that would delete it on the next save). Save and Duplicate refuse such a draft with a plain message (`unsavableSettings`) instead of the API's 400.
- `PanelLink` opens a collection link in R and a state definition link in L in place (`panelLinkTarget`): following the alias URL would close the workflow.
- The node/settings panel width is one shared stored size (`workflow-panel`).
