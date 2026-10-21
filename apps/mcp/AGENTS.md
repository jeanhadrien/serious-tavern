# apps/mcp — agent notes

A stdio MCP server that lets agents read and write presets, workflows, characters and personas through the running app's HTTP API. How the projection works: `docs/dev/reference/mcp.md`. User setup: `docs/MCP.md`.

## The rule that shapes everything
**Adding a feature to the app must not mean maintaining the MCP.** The MCP is a generic projection of `apiContract`: no per-endpoint code, no copied paths, no copied schemas, no hand-written tool descriptions.
- **`src/expose.ts` is the only per-endpoint thing.** It is typed `Record<ApiEndpoint, …>`, so a new contract endpoint fails typecheck until someone marks it `expose`, `readonly` (a POST that only reads) or `{ skip: reason }`. A new node type or a new field on a record costs nothing here.
- The description an agent reads is the contract entry's `description`; an exposed endpoint without one fails a test. Write it for an agent, and name other endpoints by their key (`getNodeType`): the tool builder rewrites keys to tool names. If a tool's behaviour needs more explaining, change the contract description, not the MCP.
- Never import a schema, path or type from another workspace except through `@st/shared`'s `apiContract`.

## Contracts
- **The server is the only writer.** The MCP never reads or writes `data/`: saves must go through the routes, which announce changes (live sync in open editors) and apply the route rules.
- **Nothing but the transport writes to stdout** (it carries the protocol). Log with `console.error`; a test greps the sources. Clients must launch it with `node <repo>/node_modules/tsx/dist/cli.mjs <repo>/apps/mcp/src/main.ts`, never through `npm run`/`npx`, which print banners to stdout.
- **Tool input** is path params and query fields at top level plus the request body **nested under `body`** (never flattened: a record's own `id` would collide with the path `id`). Unknown top-level arguments are refused with a hint. An endpoint without a body (`z.unknown()` in the contract) gets no `body` property at all.
- **Input schemas** come from `z.toJSONSchema` (input mode, draft-07, `unrepresentable: 'throw'`) and are cleaned in `schema.ts`. They must stay self-contained (no `$ref`/`$defs`, which nesting under `body` would break); a test checks every exposed tool. A schema JSON cannot express (a binary body) throws, so such an endpoint cannot be exposed by accident.
- **Errors** become tool errors (`isError`) whose text is `Error <status> <CODE>: <message>` plus `Details: <json>`, so an agent can act on the code and on `details`. A failed connection says how to start the app. Calls never throw.
- **Lists are trimmed by one rule** (`trim.ts`): the answer of every `list…` endpoint keeps `id`/`type`, `name`/`label` and `description` (cut to 200 characters). The API's own lists stay full; the agent calls the matching `get_` tool. Don't add per-endpoint trimming.
- **Guides:** `read_guide` serves `docs/*.md`, found relative to the package (not the cwd). The topics come from the files, so a new guide appears by itself.
- The base URL comes from `SERIOUS_TAVERN_URL` (default `http://127.0.0.1:3001`). Use `127.0.0.1` rather than `localhost` in docs and defaults: the server binds IPv4 only.

## Gotchas
- `superRefine` rules (preset input keys, depth placement) never reach the JSON Schema: agents learn them from error messages, so keep those messages plain and precise.
- Preset entry and input ids are re-derived on every save; node and edge ids are chosen by the client. The server `instructions` (`instructions.ts`) say so: keep that primer short and true when behaviour changes.
- `previewPreset` takes a full preset record (uuid and timestamps), which is awkward for an unsaved draft; any valid values do.
- Tests: `server.test.ts` runs a real `createApp` on a temp dir, listening on port 0, behind an in-memory MCP client. Never point a test (or a live check) at `apps/server/data`.
