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

ADDITIONS FROM THE ORCHESTRATOR (from phase 4a's plan, decisions D19/D20; they are part of this phase):

5) NODE PANELS FOR STATE READ / STATE WRITE
- With only the generic form, a user would paste a definition UUID. Add custom node-ui panels for `state-read` and `state-write` (pattern: the Recall/Draw panels from phase 3 with `CollectionPicker`): a definition picker (catalog of definitions passed through the typed `NodePanelContext`, like collections; node-ui never imports web clients), a key picker filled from the chosen definition's keys, State Read's `read` (value/meta) and State Write's `op` select limited to the ops the key's type allows (use the helpers phase 4a exported from shared, e.g. `stateOpsFor` / `stateKeyPortType`, never a hand-written list). Unknown definition id / key shows an "Unknown definition (id)" style entry like the provider dropdown, and an "Edit definition" link through `renderLink` that opens the definitions editor (add an inbound alias in `layout/routes.ts` if the link uses a legacy-style path, like collections do).
- After a config change that changes ports, the editor already re-resolves dynamic ports (the nodes have `resolvePorts`).

6) TEMPLATE HINTS FOR `state.*`
- Phase 4a added an optional third argument to `macroHints(inputs, settings, state)` built by `stateHints(definitions)` in shared. Wire it in the web wherever hints are shown (preset editor hints, template-taking node config fields) using the definitions list store, so `{{state.<definition>.<key>}}` is suggested. Never hand-write hint lists.

7) STATE WRITE FIXED VALUE EDITOR (from phase 4a's last fix)
- State Write gained an optional config `value` (`z.unknown().optional()`, a typed JSON literal used when the `value` input isn't connected; a connected input wins; `null`/absent = none). The generic form shows it as a text box that stores text, so a number key fails at run time ("needs a number, got text") and an object shows `[object Object]`. The State Write panel (item 5) must render a typed literal editor per key type and op: number input for number keys (set) and increment amounts, checkbox for boolean, select of the enum options, textarea for text, a JSON textarea for object, text or `{text, ...declared fields}` for collection `add`, item id text for `remove`, nothing for `delete`. Clearing removes the key (stores `undefined`, never `''`). Ports change with the config (with a fixed value the `value` input becomes `requiredIfConnected`); the editor already re-resolves dynamic ports.
- Also show the optional `when` gate input in the panel's help text (State Write has a `when` input on every op: connect a Condition branch or Random chance output to write only on that branch).
