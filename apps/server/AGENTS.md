# apps/server — agent notes

Fastify 5 on port 3001. Turns, runs, story state, alternatives and fork are in `src/services/AGENTS.md`, and so are the rules of the message routes (streaming, stop, client lifetime): read it before touching `routes/messages.ts`.

## Structure
- `app.ts` only wires things together. `context.ts` sets up the repositories and secrets; `errors.ts` has `HttpError` and the error handler.
- `routes/<resource>.ts` holds thin handlers; the logic lives in `services/`.
- **Routes register only through `route(app, 'key', handler, options?)`** (`routes/route.ts`): method and path come from the contract entry, so add the endpoint to the contract first. `options` are Fastify route options (`bodyLimit`, ...). Never call `app.get`/`app.post`/... for an `/api` path: `createApp` makes that throw at startup, and `contract-routes.test.ts` checks every contract entry is served at its method and path. A test-only route lives outside `/api`.

## Writes and locks
- **Session writes always go through the per-session lock and `update`**, never `load → await → save`. The same applies to every mutation of an existing record (characters, personas, avatars): use `update` or the entity lock. Plain `save` is only for creation. Secrets use one store-wide lock.
- Locks are in-process and **not re-entrant**: never take a key inside its own critical section, or it deadlocks.
- Repository writes are atomic (temp file, then rename). The rename retries transient Windows `EPERM`/`EACCES`/`EBUSY` errors.
- Corrupt JSON files are never auto-deleted: `list()` skips them with a warning, `get()` throws with the file path.

## YAML-backed resources (presets, providers, collections, state definitions)
- They share `YamlRepository<T>`: a `YamlCodec` supplies parse/serialize/label, while the scan, stamping, locks and file naming are shared. Fix those there, once.
- Identity is the `id` inside the file, never the filename. Users may edit or rename files while the server runs, so nothing is cached and every operation scans the directory.
- Invalid files are skipped with a warning and never modified. `parseYamlRecord` stamps a valid file in place only when the blank keys are `id`/`createdAt`/`updatedAt`; any other blank value keeps it invalid and untouched.
- **Presets:** files are `data/presets/<slug-of-name>.yaml`. Legacy `<id>.json` files are renamed to `.json.migrated` at startup after their YAML is verified; never delete them. UUID entry and input ids are not stored: they are re-derived as `entry-<n>`/`input-<n>` on read (depth-target slots get a readable label id), so never rely on them surviving a save.
- **Imported presets** carry a server-owned `source`. Client writes never set it, `PUT` on such a preset returns `409 PRESET_READ_ONLY`, and only `services/import/sync.ts` writes it, under `context.importLock`. New connectors implement `ImportConnector`. `source.hash` covers the connector's `mapperVersion` as well as the file bytes: any change to a mapper's output for the same input must bump `mapperVersion`, or Sync reports the files as unchanged.
- **Providers:** built-ins are merged with stored records (`builtIn` flag) and are read-only (`409 PROVIDER_READ_ONLY` on PUT/DELETE). Route params are `{ id: string }`, not `idParamsSchema`, because of the built-in ids. Bodies are stripped of client bookkeeping (`id`, timestamps, `builtIn`).
- **Model lists:** `ModelCatalog` caches in memory only. Its key is the whole record plus `SecretStore.revision`, never `updatedAt` (hand-edited files keep their old timestamp). Any new cache whose data depends on secrets keys on `revision` too.
- **Collections:** `GET /api/collections` returns summaries (`entryCount`, no entries). `DELETE` answers `409 COLLECTION_IN_USE` (details: workflow names) while a Recall or Draw node lists the id. The serializer leaves out `weight: 1` and `enabled: true`.
- **State definitions:** names unique ignoring case (`409 STATE_DEFINITION_NAME_TAKEN`); a rename or delete is refused with `409 STATE_DEFINITION_IN_USE` while a present turn wrote the definition (a delete also while a node uses it; `state-definition-usage.ts` lists the users). Updating a definition prunes the workflows' edges to vanished ports. `scene` is seeded into an empty directory.

## Change events (`GET /api/events`)
- File-backed resources emit `presets|providers|collections|stateDefinitions.changed` with the currently invalid files. Records emit `workflows|characters|personas|sessions.changed` (`{ type, id? }`). On connect, every event type is sent once (id-less for records) so clients resync.
- Record events come from `NotifyingRepository`, which wraps those repositories in `context.ts` and announces every successful save, update and delete. A new record resource gets wrapped there too.
- `repo.silent` is the raw repository. Chat turns write through it and publish one `sessions.changed` when the turn settles, never per token. Tests that spy on a repository's `get` to pause inside `update` must spy on `.silent`.
- File events come from the directory watchers **and** from every API write. Always publish with a fresh `listInvalid()`, never `[]`, or an API save clears the warning about a still-broken file.
- API writes announce **before** the HTTP response, so an editor's live sync can see its own save or delete first. Never assume the response comes first.
- Watchers start only from `main.ts` (`createApp(dir, { watch: true })`), never from `createContext`. Tests of API-write events use an app without the watcher, which would announce each write twice.
- SSE routes that must not block `app.close()` end their streams in the `preClose` hook, not `onClose`.

## App settings
- One file, `data/app-settings.json`, written atomically under its own lock around read-merge-write. A missing file is the defaults, and nothing is written until the first `PATCH` (a partial body merged into the file; `GET` answers the whole settings).
- Reads are tolerant: a wrong-typed field reads as its default, unknown keys are kept and survive a PATCH.
- A file that is not a JSON object is **never overwritten**: `GET` answers the defaults and logs a warning, `PATCH` answers `500 APP_SETTINGS_UNREADABLE` naming the file.
- A successful `PATCH` publishes `appSettings.changed` (route level, before the response). Readers that cache a setting subscribe to it; others read it when they need it.

## Characters and personas
- Card parsing and writing (PNG `tEXt` chunks `ccv3`, which takes precedence, then `chara`; V1/V2/V3 JSON) runs on the server. Export writes both `chara` (V2) and `ccv3` (V3), like SillyTavern.
- Unknown card fields are kept in `extensions` so export round-trips.

## Seeds and example packs
- The seeded workflows ("Default Assistant", "Parallel demo") and every example pack's workflows must keep validating: `seed-examples.test.ts` validates every workflow of a freshly seeded store.
- Example packs have fixed ids and are created only when the id is absent AND not in the ledger `data/.seeded.json`: deleted examples stay deleted, edited ones are never overwritten. A pack is all or nothing, and each of its workflows is its own ledger item. The packs themselves are described in `docs/dev/reference/storage.md` and, for users, `docs/STATE-AND-LORE.md`.
- A definition name clash (or a same-id definition) is resolved by the pack's `uses` key-fit rule, or skips the pack. The warning appears only while the pack still has records to create.
- An unreadable ledger seeds nothing and is never rewritten. Ledger lines are `<pack>/<kind>:<id>` (bare older lines still read and are renamed); the ledger is written after every pack. A failing pack is logged and skipped: **seeding never stops startup**.
- A correctly wired example must run without warnings (Fresh texture routes Draw's `entry` through Pick Fields so State Write's "Left out fields" log stays meaningful).
- `examples/preset-parts.ts` holds the shared preset entries: the example narrators are the Default preset plus what each adds, so keep `narratorIntro`/`narratorOutro` in step with `defaultPreset` (a test checks it).
- Add a pack in `examples/` and list it in `examples/index.ts`. `createContext(dir, { examples })` stays off in tests unless a test is about the examples.

## Tests and live checks
- Integration tests that build a workflow by hand must include exactly one `chat-input` node, even when its outputs are not wired: `prepareWorkflow` rejects zero or several.
- Fake LLMs: `test-support/adapter.ts` (replace the `openai-compatible` adapter; answer with `chatResponse(text)`).
- A quick live check: start the server against a copy of the data (see the root AGENTS.md) and `curl.exe` the endpoints.
