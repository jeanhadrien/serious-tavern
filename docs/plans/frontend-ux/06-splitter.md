# Step 6: splitter

Spec: `docs/FRONTEND-UX.md`, Resizing. One generic splitter, with remembered sizes, used inside editors and the chat.

## Decision: scope

- **In:** a generic `Splitter`; `layout/ResizeHandle.tsx` rebuilt on it, with the same behaviour and tests; three in-page splits:
  - the chat panel's width;
  - the workflow node config panel's width;
  - the preset editor's entry list vs entry editor, in its two-column layout.
- **Out (recorded in `FRONTEND-UX.md` as later):** collapsing a column by dragging it below its minimum; the preset preview pane; vertical splits. The component supports `orientation`, but nothing uses vertical yet.

## 1. `apps/web/src/components/splitter/`

- `storedSize.ts` (pure, tested):
  - `clampSize(value, min, max)`.
  - `loadSize(key, fallback)` / `saveSize(key, value)` over `localStorage` under `st.size.<key>`. Every access is wrapped in try/catch, like `layout/widths.ts` (copy its `storage()` guard, or move it to a shared helper both import).
  - A stored value that isn't a finite number reads as the fallback.
- `useStoredSize(key, { initial, min, max })` → `{ size, setSize, reset }`:
  - `setSize` clamps and saves;
  - `reset` goes back to `initial` and removes the stored value.
- `Splitter.tsx`: a `role="separator"` div, with `aria-orientation`, `aria-valuenow`, `aria-label`, `tabIndex={0}`.
  - Props: `{ label, value, onChange(next), onReset?, orientation = 'vertical', direction = 1 | -1, step = 16 }`.
  - Pointer drag, generalized from `layout/ResizeHandle.tsx` (pointer capture, `direction` says which way grows).
  - Arrow keys move by `step`, Home/End aren't needed, and a double-click calls `onReset`.
  - The visual style is `.resize-handle`'s, moved into `splitter.css`.
- Rebuild `layout/ResizeHandle.tsx` as a thin wrapper of `Splitter` (it keeps the grid `area` and the column width logic in `widths.ts`). Double-clicking a column handle resets that column to `DEFAULT_WIDTHS`. Add `resetSide` to `widths.ts` and `useColumnWidths`, with a test.

## 2. The three splits

| Split | Where | Default / min / max | Notes |
|---|---|---|---|
| Chat panel width | `pages/chat/ChatPanel.tsx`, `chatPanel.css` (fixed `width: 320px` today) | 320 / 260 / 640 | Only where the panel sits next to the thread. Inside `@container chat (max-width: 760px)` it overlays the thread: no splitter, and the stored width doesn't apply there (CSS keeps `min(360px, 100%)`). |
| Workflow config panel width | `pages/workflows/WorkflowConfigPanel.tsx` (+ the settings panel, which shares the slot), `workflows.css` | the current width / 240 / 720 | Not at `@container editor (max-width: 560px)`, where the panel covers the canvas. |
| Preset entry list vs entry editor | `pages/Presets.tsx`, `presets.css` | the current `minmax(260px, 2fr)` share as a pixel default / 220 / 640 | Only in the two-column container layout; at `max-width: 640px` (stacked) no splitter and no stored width. |

- Apply a stored size through a CSS custom property on the container (e.g. `--chat-panel-width`). The container queries' own rules then still win when they stack or overlay: the property is only read by the side-by-side rules. This keeps one source of truth for the layout in CSS.
- Hide the splitter element in the stacked and overlay container queries (`display: none`).
- Read each file before deciding the default; don't change the default look.

## 3. Tests

- `storedSize.test.ts`: clamp; load and save round trip; a throwing `localStorage` (getter or methods) falls back silently; a non-number reads as the fallback.
- SSR test of `Splitter`: the ARIA attributes.
- The `layout/widths` tests still pass, plus a `resetSide` case.

## 4. Docs

- `AGENTS.md`, `apps/web` → `components/`: a **Resizing** bullet. Splits use `components/splitter` (`Splitter`, `useStoredSize`); a stored size is applied as a CSS custom property that only side-by-side rules read; there are no splitters in stacked or overlay layouts.
- `docs/FRONTEND-UX.md`:
  - the Resizing section: list the three splits and the "out" items above;
  - the build order: mark step 6 done.

## Done when

- `npm run check` passes.
- Live check (orchestrator) at 1400x900:
  - drag each splitter, reload, and the size is kept;
  - double-click resets it;
  - at 390x844 no splitter shows inside the chat, the workflow editor or the preset editor.
