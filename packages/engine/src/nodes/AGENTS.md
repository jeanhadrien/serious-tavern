# Node types — agent notes

The LLM node and its tool loop: read `../tools/AGENTS.md` and `../providers/AGENTS.md` first.

## Adding a node type
1. Create `nodes/<type>/index.ts` exporting a `NodeDefinition`: `type`, `label`, `category`, typed `inputs`/`outputs` with `dataType` and `description`, zod `configSchema`, `defaultConfig`, and `execute(ctx)`, which returns one key per output port.
   - Set `sink: true` only for nodes that must run even when no Chat Output depends on them (they write somewhere). A node whose writes depend on its config gives a function of the config.
2. Register it in `registry.ts`.
3. Add tests in `nodes.test.ts`.
4. The UI picks it up through `/api/node-types`. Add a custom panel in node-ui only if the generated form isn't enough.
   - With `resolvePorts`, the descriptor gets `dynamicPorts: true` and the editor resolves the ports. Never add per-type branches in the web app.
   - A node that is not set up yet (a required text setting still blank, read off the config schema's `minLength`) toasts nothing in the editor: its panel says what to pick.
   - Edges to ports that disappear are pruned once the ports resolve successfully without them; unknown types and failing resolvers keep their edges.
- `numberInput` (`number-input.ts`) is the one rule for a number given to a node input (a finite number or numeric text).
- The server builds `NodeResources` only through `nodeResources(context)`.

## Chat Output, Character, Chat Settings
- The speaker name comes from the connected `character` input, else the `name` config, else the message has none. Messages store a snapshot of `name` plus `characterId`.
- `character` is a port data type. The Character node outputs the session's character or a specific card.
- Chat Settings outputs all settings (`settings`) and one by `key` (`value`: optional, absent and logged when the key isn't declared).

## Recall and Draw (authored collections)
- Collections are **read-only for workflows**: Recall and Draw read them through `ctx.resources.collections`; no node writes them.
- An unknown collection id is a **node error at run time**, not a validation issue (the nodes have static ports).
- Tags compare trimmed and case-insensitively; a level filter excludes entries without a level; weight 0 is never drawn; Recall keywords are literal with Unicode-aware whole-word edges. Recall's extra `text` input is `neverSkips`, so Recall still scans the messages.
- Draw's selection is the pure `drawEntries`; its `isExcluded` option is how `avoidRecent` leaves out recent draws. Recent draws are node state under `draws`, **keyed by a fingerprint of the entry text, never the positional entry id**. Only the first 80 characters of the text are stored next to the key (`memoryText`).

## Trigger
- Gates an injection: score `clamp01((baseChance + growthPerTurn × turnsSinceLastFiring + Σ weight × signal) × (0.5 + volatility))`, one `ctx.random()` roll, and a second draw for the level only when it fires.
- Firings are node state under `fires` (one `{ text, level }` item per firing, nothing else; the key lives in the node folder, not in shared). Cooldowns and `turnsSinceLastFiring` come from the folded `itemTurns`, so deleting a reply undoes a firing.
- No Trigger code outside its folder, the registry, tests and its panel: the web shows firings through the generic node-write line.
- Per-level `cooldowns`/`levelWeights` default key by key. Signals are `{ name, weight }` rows that become optional `neverSkips` number ports (a signal from a branch not taken counts as 0). `signalNameProblem` validates names for both the schema and `resolvePorts`.

## State Read and State Write
- Both resolve their ports from `resources.stateDefinitions`. A node whose key or operation no longer fits its definition is a validation issue naming the node, not a run-time error.
- State Write is a sink whose operations come from `stateOpsFor`. Every operation has an optional `when` input (`requiredIfConnected`, value ignored), so a branch can gate any write.
- The optional config `value` is a typed JSON literal (`fixedValue`; `null` = none), used when the `value` input isn't connected: the input wins, and the literal is validated like an input value. Its presence makes the `value` input `requiredIfConnected` instead of `required`, so the ports depend on the config.
- `add` on a collection key has the `messages` input (`requiredIfConnected`): `messageLink` accepts a link, a message or a non-empty list of messages, anything else is a node error. Only `add` reads it; a value's own `messages` is ignored.
- On a thread key, `add` takes the `value` input as the LLM's `exchange` (a `messages` port) plus an optional `input`, and has no fixed value literal. `keepReasoning` is a thread-only option (default off).

## History nodes
- **Thread** is the only caller of `weaveThread`/`threadAlone`. It locates its key with `locateThread` (a run-time error when the key isn't a thread), reads whole items from the run snapshot, reverses the fold's newest-first order (same-turn items keep write order), keeps the last `lastN`, and places nothing itself. Its `history` input is optional and `neverSkips`.
- **Next Chunk** plans over a collection key's snapshot items with `ctx.history` (`planNextChunk`). Its `resolvePorts` only checks the target, so an unset key is the "not set up" state.
- **Unlinked Messages** drops the messages that intact items of the key link (static ports; a bad key is a run-time error).
- Both locate the key with `locateCollection`. Thread, Next Chunk and Unlinked Messages count as users of their definition (a delete is refused).
- **Memory** knows nothing about links; it only has `all` (the whole history, `lastN` ignored).
