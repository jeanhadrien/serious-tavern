# packages/shared — agent notes

Zod schemas, types and the pure rules that the engine, the server, node-ui and the web all use. A rule that lives here is called by every side, never copied. Refined zod schemas extend with `.safeExtend`, not `.extend`.

Story state, message links and prompt messages have their own notes: `src/state/AGENTS.md`, `src/links/AGENTS.md`, `src/conversation/AGENTS.md`.

## API contract (`src/api/`)
- Every entry is `endpoint({ method, path, description? }, response, body?, params?, query?)`, collected in `apiContract`. The key is the endpoint's name.
- `path` is the full Fastify template with the `/api` prefix (`/api/presets/:id`); the `:names` are exactly the keys of the `params` schema (a test checks it), and no two entries share a method and path.
- `description` is optional, plain language for API consumers (an MCP agent reads it): what the call does and what to watch for, never how the server does it. Keep it true when behaviour changes.
- Server routes register through `route()` from the contract, so nothing here is copied into a route; the web client still writes its own paths until it moves onto these.

## Workflow nodes
- `position` is required in the stored `nodeSchema` and optional only in the write schemas (`nodeDraftSchema`, `workflowDraftSchema`). `layoutNodes` is the one rule that fills it: the server calls it on save; the sizes it spaces by are the editor's node cards (`.flow-node` in the web's `style.css`), so revisit them together.

## Templates and macros
Preset content and template-taking node configs are rendered with the `handlebars` runtime (`noEscape: true`, no code eval) over a data object built from the turn context. The syntax and the helper list are documented in `docs/TEMPLATING.md`.
- The macro registry (`macros.ts`) defines every available path, and the helper list lives next to it. Preset validation walks the parsed AST, so editor hints and warnings stay in step with what renders. **Never hand-write a hint or key list:** settings keys come from workflow declarations (`macroHints(inputs, settings)`, `settingsCatalog` unions them across workflows), state paths from `stateHints(definitions)`.
- Namespaces: `{{character.<field>}}`, `{{persona.name|description}}`, `{{input.<key>}}`, `{{trigger.*}}` (including `trigger.turn`), `{{settings.<key>}}`, `{{state.<definition>.<key>}}`. Short aliases: `{{char}}`, `{{user}}` (defaults to "User"), `{{description}}`, `{{personality}}`, `{{scenario}}`, `{{persona}}` (the persona description).
- `{{char.*}}`/`{{user.*}}` were removed on purpose. Don't add legacy `<BOT>`/`<USER>` or SillyTavern's extra macros unless asked.
- Templates are **case-sensitive** (stock Handlebars resolution). Unknown macros and known macros without a value render as empty text. Unknown paths in enabled entries produce a preset warning, except under `state.*` (no warning). An unknown `{{input.x}}` is a validation **error**.
- Macros also resolve inside character and persona fields, with protection against cycles.
- **Prompt behaviour is chosen by the user:** never apply automatic SillyTavern rules (card system prompt overriding the main prompt, splitting examples at `<START>`, ...). Users reference fields in their presets themselves.

## Presets (schema side)
- Every entry's editor label is the required `displayName`. A message entry's optional `name` is a template rendered like `content`; slots have no `name`. Name templates are validated like content: use `entryTemplates`/`entryUsesInput` instead of reading `content` alone.
- **Legacy rule:** an entry with `name` and no `displayName` is a pre-`displayName` entry: its `name` is the label and it has no message name. `upgradeLegacyPreset` applies this to **raw** data before validation, in the YAML loader and the JSON migration only. Never put it in the zod schema (`z.preprocess` erases the input type the web client relies on) and never apply it to API write bodies.
- Entry types are `passthrough`, so a stray `name` key compiles anywhere. When building or copying entries, set `displayName`: a leftover `name` silently becomes a message name.

## Chat settings
User-owned per-chat knobs: the workflow declares them (`workflow.settings`), the session stores them (`session.settings`).
- Both fields are `.optional()`, not defaulted, because stored records are never parsed on read. Read declarations with `workflowSettings()` (it also tolerates a non-list) and values with `session.settings ?? {}`; never trust the zod output type for a raw record.
- Readers that need one declaration per key go through `usableSettings` (usable key, first declaration wins): the resolver, PATCH validation, hints and the chat panel must agree on duplicates.
- `resolveChatSettings` is the single resolver (server turns, preset preview, chat panel): a stored value is used when it fits, else the default with an issue. Stored data is never rewritten; undeclared stored keys are kept and ignored.
- The preset preview without a session uses each key's default (`settingsCatalog`). Declaration problems are workflow validation issues (`workflowSettingIssues`).
- Keys must pass `isSettingKey`: an identifier, and not reserved (`__proto__`/`constructor`/`prototype`, the Handlebars literals `this`/`true`/`false`/`null`/`undefined`, and `toString`, which the template data defines on `settings`).

## Reply list (triggers)
A chat runs an ordered, toggleable list of workflows on each reply, `session.triggers.reply: { workflowId, enabled }[]`.
- **`replyWorkflows(session)` is the only reader** (a legacy chat reads as its `workflowId` alone). `session.workflowId` only mirrors the list's first entry for older readers: never read it to decide what runs or which settings exist.
- The settings of a whole list are `listedSettings` (PATCH validation, preset preview, chat panel); a run resolves against its own workflow only.

## Alternatives and fork
- `inactive` is absent on active replies and read only as `=== true`, so old messages need nothing. `activeMessages` is the chat (see the root AGENTS.md).
- **A fork cuts by turn, never by message position:** `forkPoints` (the last shown, settled assistant reply of each turn; never a user message) and `forkCut` (messages to the end of the turn, `state.turns` up to the last entry whose `executionId` a kept message carries) are the only rules, tested here with the fold property.

## Other records
- **Collections:** the YAML codec parses every file on read, so `.default()` is safe in the stored schema (unlike JSON records). Write bodies use `collectionWriteSchema`, where `entries` is required (a defaulted list on a write would erase them). Entry ids are positions (`entry-<n>`), never stored: nothing may rely on them surviving a save, and an `id` key in a file is just an unknown field.
- **Providers:** stored ids are UUIDs, so a file claiming a built-in id is invalid by schema. `normalizeModels` is the one generic path for model lists, with no per-backend branches.
- **App settings:** a new setting is a field in `appSettingsSchema` (with a `.catch` default) and in `updateAppSettingsSchema`.
