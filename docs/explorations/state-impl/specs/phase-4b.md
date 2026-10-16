STORY STATE, WEB (STATE-DESIGN-PROPOSAL-3 Part 2 "Seeing it"). The backend (definitions API, session state storage, fold, `GET /api/sessions/:id/state`, nodes) was built in the previous phase — read its code, README and AGENTS.md sections first.

1) STATE DEFINITIONS EDITOR
- Definitions are technical setup → list + **narrow editor in L**, like providers (`left=stateDefinition:<id>` style URL via the existing L-editor mechanism; `LayoutTarget.leftEditorOpen`/`LayoutUrl.leftId` are the L twins — extend them generically if they are provider-specific). Header icon in L (lucide, e.g. `Database` or `Brain`), phone menu entry under Setup, `VIEW_INFO` entry, list store refreshed by `stateDefinitions.changed`, dirty dot, live sync from disk like the provider editor (never overwrite a dirty draft; classify own-save echoes like `classifyProviderChange`).
- Editor: name (read-only with a hint when the server says it has data — handle the 409 with a clear inline message and offer "Duplicate as…" which creates a copy with a new name), description, and a keys table: add / remove / rename key, type select, and per-type fields (default, min/max, options, cap, fields as `name:type` pairs). Validation inline. A YAML view is optional.

2) CHAT PANEL: STORY STATE SECTION
- The chat side panel built in phase 2 (`ChatPanel`, toggled from the chat header) gains a "Story state" section (and the toggle button stays the same; consider renaming the button's title to "Chat panel" if it now holds more than settings — keep aria-label/title accurate). It loads `GET /api/sessions/:id/state` through a typed client, refreshes after every settled turn, message delete/edit and `sessions.changed` for this session (but never re-fetches per streamed token).
- Per definition: key → current value (collections as a list, newest first, with "N older items dropped by the cap" when applicable), "written at turn k" as a link that scrolls to that turn's reply, "never written" when not, a small inline SVG sparkline for numeric keys using the per-key history (no chart library), and warnings (value doesn't fit the definition → using default). Node implicit state (e.g. Draw's recent draws) in a collapsed "Node memory" group.
- Empty state: no writes yet → short explanation + link to the state definitions editor.

3) PER-MESSAGE CHIP
- On each assistant message whose turn wrote something (from the state view's per-turn data), show a small icon button (lucide e.g. `Database`, aria-label + title "What this turn stored") that opens a popover listing the turn's writes in plain words ("scene.tension → 6", "scene.injected + 'a bell on a lost animal'", "Draw: drew 'resin smell'"). For multi-reply turns show the chip on the last reply of the turn only.
- If the message was edited after its turn stored state (`editedAt` on the message, set by the server since the previous phase), the chip shows an "edited after it was stored" note.

4) DELETE CONFIRMATION
- Today message delete has no confirmation. Add one ONLY when deleting this message would remove the last surviving reply of a turn that stored something: `window.confirm` (the app's existing pattern) listing what will be undone ("Deleting this reply also undoes: scene.tension (back to 4), injected 'a bell…'"). Values that won't change are not listed. Other deletes stay one-click as today.

GENERAL
- Typed API clients only; follow `apps/web` structure and AGENTS.md (stores, layout rules: every view mounted once in VIEW_KEYS order; layout rules in layout/state.ts with tests; `useChat` re-renders per token so keep new chat-panel components memoized / independent of token updates).
- Tests: reducer/url tests for the new L editor, pure helpers (formatting writes, undo list, sparkline points) with unit tests, SSR panel tests where the repo has that pattern.
- Live check with Playwright at desktop and phone sizes: create a definition, run a workflow that writes state (no LLM needed: e.g. Chat Input → State Write increment → Chat Output, or a Random → State Write), see the panel update, the chip, delete the last reply with the confirmation and see the value rewind. Screenshots to the scratch dir.
- DOCS: README (UI), AGENTS.md if new conventions appear.
