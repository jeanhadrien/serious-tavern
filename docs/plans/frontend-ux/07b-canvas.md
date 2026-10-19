# Step 7b–7d: workflow canvas (drag to empty space, undo/redo, copy/paste)

Spec: `docs/FRONTEND-UX.md`, Features in this round → Workflow canvas. **Depends on step 3** (the keyboard module, `useEscapeLayer`, areas).

Three parts, each coded by its own agent, in this order. They all touch `pages/workflows/useWorkflowCanvas.ts` (190 lines today). Keep it under ~250 lines by putting each part's logic in its own module and hook.

Read first: `pages/workflows/useWorkflowCanvas.ts`, `WorkflowCanvas.tsx`, `model.ts`, `useDynamicPorts.ts`, `apps/web/src/connection.ts`, `packages/shared/src/ports.ts` (`canConnect`), and the React Flow controlled-state gotcha in `AGENTS.md`.

---

## 7b. Drag a connection to empty space → node picker

**Behaviour.**
- Dropping a connection (from an output or an input handle) on empty canvas opens a small picker at the drop point.
- The picker lists only node types that have a port that accepts the connection, and has a filter input.
- Picking one creates the node there and connects it. Escape, a click outside, or an empty pick closes the picker and nothing changes.

**Pure logic: `pages/workflows/connectCandidates.ts`** (table tests).

```ts
export interface DragOrigin { side: 'source' | 'target'; port: PortDef }   // the handle the drag started from
export interface Candidate { descriptor: NodeTypeDescriptor; port: PortDef; coerce: boolean }
export function connectCandidates(origin: DragOrigin, types: NodeTypeDescriptor[], options: { hasChatInput: boolean }): Candidate[];
```

- From an output (`side: 'source'`): each type's first **input** that `canConnect(origin.port, input)` accepts. From an input: the first **output** with `canConnect(output, origin.port)`.
- Per type, prefer a port with an exact match over one that needs coercion (`result.coerce`). Types with no fitting port are left out.
- Leave out `chat-input` when the workflow already has one.
- For types with `dynamicPorts`, use the descriptor's own ports (its default ports). A type whose default ports don't fit isn't offered; say so in a code comment.
- Order the candidates by category, then label, like the palette.

**Wiring.**
- `onConnectEnd(event, state)` in `useWorkflowCanvas`: today it only handles invalid drops onto a handle. Add the empty-space case: no `toHandle` and no `toNode`, and a `fromHandle` exists.
- Get the screen point from the event (`MouseEvent` `clientX/Y`, or a `TouchEvent`'s `changedTouches[0]`). Store `{ screen, flow: screenToFlowPosition(screen), origin }` in picker state.
- `pages/workflows/ConnectPicker.tsx`: absolutely positioned inside `.canvas` at the screen point relative to the canvas rect, clamped to stay inside it.
  - A filter `input` (focused when it opens) and a `div role="listbox"` of `div role="option" tabIndex={-1}`, each with `onMouseDown={e => e.preventDefault()}` (the combobox gotcha in `AGENTS.md`).
  - Arrows move, Enter picks, and Escape closes through `useEscapeLayer`. A click outside closes it.
  - Each option shows the type label and the port name, with "→ text" when it coerces.
- Picking adds the node at the flow point, through the same path as palette drops (`addNode`; refactor it to return the new id), then the edge. Build the edge through `connect` or the same edge rules (one edge per target handle), so it is replaced like a manual connection would be.

---

## 7c. Undo / redo

**Pure history: `pages/workflows/canvasHistory.ts`** (table tests).

```ts
export interface CanvasSnapshot { nodes: CanvasNode[]; edges: Edge[] }   // selection, `measured`, `dragging` stripped
export interface History { past: CanvasSnapshot[]; future: CanvasSnapshot[]; group?: { key: string; at: number } }
export function record(history, before: CanvasSnapshot, groupKey?: string, now?: number): History;  // limit 100
export function undo(history, current: CanvasSnapshot): { history: History; snapshot?: CanvasSnapshot };
export function redo(history, current: CanvasSnapshot): { history: History; snapshot?: CanvasSnapshot };
```

- `record` pushes the state *before* a change and clears `future`.
- A `groupKey` equal to the last one within 1000 ms doesn't push again, so typing into one node's config is one step: key `config:<nodeId>`.

**What records a step** (in a `useCanvasHistory` hook used by `useWorkflowCanvas`):
- adding a node (palette drop or click, picker);
- removing nodes or edges (keys or the Delete selection button);
- connecting;
- a node drag: snapshot on `onNodeDragStart`, recorded on `onNodeDragStop` only if a position changed;
- a config change (`updateConfig`, grouped);
- a node rename, if the canvas has one;
- a paste (7d), as one step.

Not recorded: selection changes, React Flow measurements, `load`/`clear` (they reset the history), and edges pruned by `useDynamicPorts`. Undo restores nodes and edges; ports re-resolve on their own.

**Restore.**
- `setNodes`/`setEdges` with the snapshot, all selections cleared.
- The selected node (config panel) closes if it no longer exists.
- Dirty stays computed as today, so undoing back to the saved state is clean again.

**Keys and buttons.**
- `Ctrl/Cmd+Z` undo, and `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redo.
- They're active only when the area is `editor:workflows` and focus is not in a field (a field keeps its own text undo).
- Add them to `SHORTCUTS` (scope `canvas`). Dispatch through step 3's keyboard module: if it has no area-scoped shortcut handlers yet, add `useShortcutArea(viewKey, handlers)` following `useEscapeArea`'s registry pattern, with tests.
- Undo and Redo icon buttons (lucide `Undo2`, `Redo2`) go in a React Flow `<Panel>` next to the Delete selection one, for touch. They're disabled when there's nothing to undo or redo.

---

## 7d. Copy / paste nodes

**Use the native `copy` and `paste` events** (on `document`, scoped like the shortcuts: the area is `editor:workflows`, focus is not in a field, and for copy a selection exists). They need no clipboard permission and work across tabs. Register them through the keyboard module (an area handler), not as one-off listeners.

**Payload: `pages/workflows/canvasClipboard.ts`** (pure, tested).

```ts
{ kind: 'serious-tavern/nodes', version: 1,
  nodes: [{ id, type, config, name?, position }],
  edges: [{ source, sourceHandle, target, targetHandle }] }   // only edges with both ends selected
```

- `serializeSelection(nodes, edges): string` (JSON).
- `parseClipboard(text): Payload | undefined`: a wrong kind, version or shape gives `undefined`, and the paste is ignored silently (it may be ordinary text).
- `pasteNodes(payload, { types, existing, offset }): { nodes: CanvasNode[]; edges: Edge[]; skipped: string[] }`:
  - new UUIDs for nodes and edges; edges remapped;
  - configs deep-cloned;
  - positions offset by `offset` (40 px per consecutive paste of the same payload);
  - unknown types skipped;
  - `chat-input` skipped when the canvas has one;
  - names re-numbered with `nodeDisplayName` like `addNode` does.

**Paste.**
- Deselect everything, then add the pasted nodes and edges, selected. It's one undo step.
- If something was skipped, show `alerts.info` naming it ("Chat Input was not pasted: a workflow has exactly one").
- **Copy** with nothing selected does nothing (the event goes on normally).

---

## Docs (each part adds its own lines)

- `README.md`, the workflow editor section: drag to empty space, undo/redo (keys, buttons, what counts as a step), copy/paste (native events, payload kind).
- `AGENTS.md`, under the React Flow gotcha:
  - history snapshots strip selection and `measured`;
  - `load`/`clear` reset the history;
  - pruned edges aren't recorded;
  - copy/paste use the native events, never `navigator.clipboard`.
- `docs/FRONTEND-UX.md` build order: mark each part done.

## Done when (each part)

- `npm run check` passes.
- Live check (orchestrator), on a workflow:
  - 7b: drag from an LLM node's `text` output to empty space, pick Chat Output: it is created and connected.
  - 7c: move a node, Ctrl+Z puts it back, and Ctrl+Shift+Z moves it again; typing in a config field undoes in one step.
  - 7d: select two connected nodes, Ctrl+C, Ctrl+V: two new nodes with their edge, offset; pasting a Chat Input is refused with the info toast.
