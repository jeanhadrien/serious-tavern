# packages/node-ui — agent notes

Node config forms generated from JSON Schema, custom panels (`src/panels/`) and template-variable hints.

## Boundaries
- Panels get catalogs (presets, characters, providers, collections, state definitions as whole records, snippets, the open workflow's chat `settings`), `loadModels` and `renderLink` through a typed `context` prop. **node-ui never imports react-router or the web API clients**, and can't import from the web app.
- **Template warnings** under a template field come only from shared's `templateWarnings` (through `templateFieldWarnings`, which also reads each row's value of a key/value list). They live in the panel only and are never validation issues; the node's input port names are the `inputKeys`, and `context.snippets` (when given) the `snippetNames`. A custom panel that draws its own template field must call the same helper.
- Template hints come from `macroHints`/`stateHints` in shared (`NodePanelContext.stateDefinitions`, `NodePanelContext.snippets`). Never hand-write a hint list.

## Generic form
- A field's zod `.describe()` text is shown as a hint.
- A cleared number field **without a schema default** is stored as unset (`numberFieldValue`), so optional numbers fall back to a node's own default (Random's per-mode bounds). A field with a default keeps storing `0` when cleared: storing unset would redisplay the default mid-edit (typing after clearing `10` gave `105`).
- Array fields in any shape other than `{key,value}[]` are shown as read-only JSON.
- Lists here reorder with up/down buttons and `Alt+↑/↓` only (no drag: dnd-kit lives in the web app).

## Node summaries
- `nodeSummary(descriptor, config, context)` (`summaries.ts`, a per-type map beside `customPanels`) is the one-line text under a node's header. The editor calls only it, never a per-type branch. It is plain text and tolerant of any config, uses the panels' `Unknown … (id)` wording for a record that is gone, and gives nothing while a node is not set up; a type with no entry has no line. A new node type may add one.

## Pickers and panels
- The provider dropdown takes `{ id, name }` and shows "Unknown provider (id)" when the node's id has no record. The model picker only suggests (through `context.loadModels`); the model field stays a plain string.
- **State panels** (State Read, State Write, the shared `StateKeyPicker`):
  - The operations a key allows always come from `stateOpsFor`, never a hand-written list.
  - `retarget`/`pickDefinition`/`pickKey` are the only way a panel changes `definitionId`/`key`: they fit `op` to the key type and drop State Write's fixed `value` (and `keepReasoning` when the key stops being a thread) when the target changes. `pickOp` is the only way to change `op`, and it drops the fixed value too. `pickerHint` says what to pick next.
  - Unknown ids stay visible as `Unknown definition (id)`/`Unknown key (name)`.
  - `PickerKind`: `target` (any key except threads, only `definitionId`/`key` set; the LLM Tools section), `collection` (list keys only, `read`/`op` untouched; Next Chunk, Unlinked Messages), `thread` (thread keys only; Thread node). These panels sit over the generic form (`GenericPanel`'s `lead` and `hidden`).
  - The "Edit definition ↗" link is the `/state-definitions?id=` alias.
- **State Write's fixed value** is edited by `StateValueEditor` (pure logic in `stateValue.ts`): clearing a control removes the key (`withFixedValue`: undefined or null drop it; `0`, `false` and `''` stay values), and `fixedValueProblem` mirrors the node's run-time checks (numbers are clamped, never a problem). A thread key has no fixed value (`valueKind` `none`). "Keep reasoning" stores `keepReasoning: true` or removes the key, never `false`.
- **Trigger signals** are edited only by the custom panel (`panels/trigger.tsx`).
- **LLM Tools section** (`LlmTools.tsx` over the pure `toolsConfig.ts`): add, remove and dedupe targets and the `Unknown …` labels live in the pure module.

## Tests
SSR panel tests (`renderToStaticMarkup`) don't run effects: a hook's initial state must already be right without them.
