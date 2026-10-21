# Storage reference

How the server keeps data under `data/`: JSON and YAML repositories, change events, locks, secrets, app settings,
seeds and imports. The layout of `data/` is in [ARCHITECTURE.md](../ARCHITECTURE.md#where-data-lives).

## Compatibility

`data/` is user data and must survive upgrades. Schema changes are additive: unknown fields are kept (`passthrough`),
new fields are optional or defaulted, writes migrate on write (normalize, keep unknown fields, never rewrite
destructively). A breaking change ships an explicit migration script with a backup step. Corrupt files are never
deleted: `list()` skips them with a warning, `get()` throws with the file path. Persistence sits behind a
`Repository<T>` interface, ready for a database later.

## JSON repositories

Sessions, workflows, characters, personas and execution logs are one JSON file per record. Records are **not parsed
on read**, so readers go through tolerant helpers and new fields are `.optional()`.

- **The workflow record** holds `nodes`, `edges`, the chat `settings` declarations and the canvas's sticky `notes` (`{ id, text, position, size? }`, passthrough). Notes sit outside `nodes`, so the engine never sees them; read them through `workflowNotes()`, which tolerates a missing field, a non-list and items that aren't notes. A write that omits `settings` or `notes` keeps the stored ones; `notes: []` clears them.
- Writes are atomic: a temp file, then a rename, retried on transient Windows `EPERM`/`EACCES`/`EBUSY`.
- **Locks** (`storage/lock.ts`) are keyed, in-process and not re-entrant. Every mutation of an existing record goes
  through `repository.update` (or the entity lock) under its key; plain `save` only creates. PUT on workflows and
  presets uses `update`, shares the lock with DELETE, keeps the stored id and creation time, and answers `404` if the
  record is gone, even when a DELETE won the race; it never resurrects a record. `delete` accepts a `beforeDelete`
  callback that runs under the same lock (avatar cleanup).
- Character and persona edits, avatar uploads and deletion share the entity lock (`services/entity-mutations.ts`), so
  an upload can't overwrite a concurrent edit or bring back a deleted entity; avatar file work stays inside the lock.
- Locks don't coordinate several server processes writing the same directory.

## YAML repositories

Presets, providers, collections and state definitions are YAML files, handled by the generic `YamlRepository<T>`
(`storage/yaml-repository.ts`, parameterized by a `YamlCodec`: parse, serialize, label). Users may edit or rename the
files while the server runs, so:

- **Identity is the `id` inside the file**, never the file name. Nothing is cached: every operation rescans the
  directory (a turn reads it once per resource it uses, then the run's snapshot holds it).
- **File names** are the slugified name (letters and digits of any script, lowercase, hyphens, at most 80 characters;
  reserved Windows names such as `con` get a suffix; an empty slug gets a default name, `preset` for presets;
  `yaml-filenames.ts`). Collisions, compared
  case-insensitively, add `-2`, `-3`... A rename writes the new file, then removes the old one; a record whose name
  didn't change keeps its file name. `.yml` is read too; files are always written as `.yaml`.
- **Stamping.** A valid file without `id`/`createdAt`/`updatedAt` gets them appended once. Only those blank keys count
  as missing (`parseYamlRecord`): any other blank value (`title:` with nothing after it) keeps the file invalid and
  untouched.
- **Invalid files** (bad YAML, a schema failure, a duplicated `id`: the first by file name wins) are skipped with a
  warning and never modified or deleted; their names and reasons travel in the change events.
- Text is lossless: multi-line strings are literal block scalars, and content they can't carry (whitespace-only lines,
  CR characters) is double-quoted. Unknown fields survive at every level.
- **Presets.** UUID entry and input ids are not written: they are derived from positions (`entry-<n>`, `input-<n>`) on
  read, and a slot targeted by a depth placement gets a readable id from its label. Entry keys are written as `id,
  displayName, name, kind, …`. Deleting a preset an LLM node uses is refused (`PRESET_IN_USE`), but a file removed
  or broken on disk can't be: the workflow then fails with `WORKFLOW_INVALID`, the issue naming the node and the
  missing preset id. Legacy entries (`name` without `displayName`) are upgraded in memory on read
  (`upgradeLegacyPreset`) and get the new shape on their next save. Format details: `preset-yaml.ts`.
- **Preset migration.** At startup, before seeding, each `data/presets/<id>.json` that parses is written as YAML, read
  back and compared (only machine ids may differ), then renamed to `<id>.json.migrated`. A failed check removes the
  YAML and keeps the JSON with a warning; an existing YAML with that id just gets the JSON renamed. JSON content is
  never changed or deleted. Rolling back: delete the YAML and rename `.json.migrated` back.
- **Collections.** Keys are written as `name, description, entries, …`, entry keys as `title, text, keywords, tags,
  level, weight, enabled, …`; `weight: 1` and `enabled: true` are left out.

## Change events

`GET /api/events` is one server-sent event stream for every client (event name = type).

- **File-backed resources** (`presets`, `providers`, `collections`, `stateDefinitions`): the server watches
  `data/presets/`, `data/providers/`, `data/collections/` and `data/state/definitions/` (`watchResourceFiles`;
  `fs.watch`, non-recursive). Our own temp files, editor swap and lock files and non-YAML files are ignored; bursts
  (editors that save through a temp file and a rename) are debounced into one notification and a rescan. The watcher
  is started only by the server entry point, re-arms after errors, closes with the app, and watches the directory by
  its resolved long path (libuv aborts the process on Windows for a directory given by its 8.3 short name). Provider,
  collection and definition API writes also publish their event (`publishFileChange`), always with a fresh list of
  invalid files.
- **Records** (`workflows`, `characters`, `personas`, `sessions`): the repositories in the app context are
  `NotifyingRepository` wrappers that publish `<resource>.changed` with the record id after every successful save,
  update and delete, so a new write path can't forget it. A chat turn writes through the wrapper's `silent`
  repository (streamed rows would otherwise fire per token) and publishes one `sessions.changed` when it settles.
- On connect the server sends every event type once (id-less for records), so a reconnecting client resyncs, plus a
  keepalive comment every 15 s. Events say only that something changed; clients re-fetch. An API write may be
  announced twice (by the watcher too), which is harmless, and is announced before its HTTP response.

## Secrets

AES-256-GCM in `data/secrets.enc.json`. The 32-byte key comes from `SECRETS_KEY` (64 hex characters) or is generated
into `data/.master.key` on first start. The API returns only names and masked hints. Set and delete serialize their
whole read-modify-write through one store-wide lock. `SecretStore.revision` changes on every write, for caches that
depend on secrets.

## App settings

App-wide preferences (not per chat), in `data/app-settings.json`. Two settings: `forkKeepsAlternatives`
(default `true`) and `showMessageStats` (default `false`: whether the chat shows text statistics, see the engine reference). A missing file is the defaults and nothing is written until the first `PATCH` (a partial body merged
under the file's own lock). Unknown keys survive a `PATCH`; a wrong-typed value reads as its default. A file that
isn't a JSON object is never overwritten: `GET` answers the defaults and logs a warning, `PATCH` answers
`500 APP_SETTINGS_UNREADABLE`. A successful `PATCH` publishes `appSettings.changed` (no id) before it answers.

## Seeds and example packs

The first-run seeds ("Default Assistant", "Parallel demo", the Default preset, the `scene` definition) use stable ids
and only fill empty stores. **Example packs** (`apps/server/src/seed-examples.ts`, packs in `src/examples/`, listed
in `examples/index.ts`) reach users who already have data:

- A pack is workflows plus the presets, collections and state definitions they use, every record with a fixed id.
  At startup (`examples: true` in `main.ts`; tests leave it off) each record is created only when no record has its id
  **and** the ledger `data/.seeded.json` doesn't list it (`<pack>/<kind>:<id>`; older bare `<kind>:<id>` lines still
  count and are renamed). A record found by id is added to the ledger too. So a deleted example stays deleted, an
  edited one is never overwritten, and a restart changes nothing.
- A pack is all or nothing: when one of its records was seeded and later deleted, the pack is skipped with a log line.
- **Name clashes:** if another definition already has a pack definition's name, the pack uses it when it has the keys
  the pack declares in `uses` with the same types (and, for a collection, the item fields); otherwise the pack is
  skipped and logged, and nothing is recorded, so fixing the definition lets the next start add it. The same check
  applies to a definition found under the pack's own id. A stand-in collection key with a cap is accepted with an info
  line.
- The ledger is written after every pack. A pack that throws, or a failed ledger write, is logged and skipped: seeding
  never stops startup. An unreadable ledger stops all example seeding and is left as it is.
- Packs: **Fresh texture** (Trigger → Draw → a leveled preset, `scene`), **Rolling summaries** (`memory`; a narrator
  and "Summarize history (example)"), **Scenarist with tools** (`plot` with a `notes` thread key; a narrator and
  "Scenarist (example)"). Their walkthroughs are in [docs/STATE-AND-LORE.md](../../STATE-AND-LORE.md#try-the-examples).
  The narrators' presets are the Default preset plus what each adds (`examples/preset-parts.ts`). Chat-level tests:
  `seed-fresh-texture.test.ts`, `seed-rolling-summaries.test.ts`, `scenarist-example.test.ts`.

## Imports

Connectors copy content from another app's install folder into local records. Each connector has one config record
keyed by its app id (`sillytavern` is the only one); adapters live in `apps/server/src/services/import/`
(`connector.ts`: detect, scan, name, map), and sync, routes and config are generic over that shape.

- **SillyTavern** presets are read from `<install>/data/<user>/OpenAI Settings/*.json` for every user folder not
  starting with `_`. Nothing else is read: no symlinks, no nested folders, nothing over 5 MB. A file's identity is
  (install path, user, file name); its preset name is the file name plus ` (<user>)` unless the user is
  `default-user`. The mapping is the pure `sillytavern-mapper.ts` (prompt order `character_id` 100001, then 100000,
  then the first; markers become disabled empty entries; absolute injection at depth N becomes depth N-1 in the first
  enabled history slot, depth 0 is placed after the current-message slot).
- **Sync** (serialized per connector by `context.importLock`): a new file creates a preset; a changed hash overwrites
  its preset in place (same id, workflow edges into vanished inputs pruned); an unchanged file is left alone, its
  `updatedAt` included; a preset whose file is gone is kept with `source.missing: true` (cleared if it returns); an
  unreadable or invalid file is skipped with a warning and not counted. Presets of another install are never touched.
- **The hash** is the sha256 of `mapper <version>\n` plus the file bytes. Bumping a connector's `mapperVersion`
  (SillyTavern: 2) re-imports every file on the next Sync, so mapping fixes reach existing presets.
- Imported presets carry a server-owned `source` (`{ app, installPath, user, file, hash, importedAt, missing? }`):
  client writes strip it, `PUT` on such a preset is `409 PRESET_READ_ONLY`, `DELETE` works and the next Sync recreates
  it.

## Characters and personas

JSON records plus avatar files under `data/avatars/characters/` and `data/avatars/personas/`, uploads limited to 20 MB.
Cards (`card.ts`) are parsed and written on the server: flat V1, V2 (`chara_card_v2`) or V3 (`chara_card_v3`) JSON,
or PNG with `chara` and `ccv3` text chunks (V3 preferred). A PNG character import needs embedded card data; a plain
image creates a persona named after the file. Exports write both V2 and V3 and use the avatar or a generated
placeholder. Unknown card fields are kept in `extensions`, so a card round-trips.
