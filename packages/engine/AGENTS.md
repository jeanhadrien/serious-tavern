# packages/engine — agent notes

Graph validation, the wave-based parallel executor, templating and node types. Node rules are in `src/nodes/AGENTS.md` (the LLM node in `src/nodes/llm/AGENTS.md`), the LLM adapter in `src/providers/AGENTS.md`, the tool loop in `src/tools/AGENTS.md`. Template and macro rules: `packages/shared/AGENTS.md`.

## Preparing and validating
- `prepareWorkflow` parses configs, resolves ports and snapshots resources **once**. `validateWorkflow` wraps it, and `executeWorkflow` accepts its result. Prepare again for each turn, and load node resources through the resolvers.
- Validation returns structured `ValidationIssue`s (`{ message, edgeId?, nodeIds? }`). Messages are plain language and name nodes with `nodeDisplayName` (`Label #k (type)`); ids travel only in `edgeId`/`nodeIds`. `WORKFLOW_INVALID` details are `{ workflowId, workflowName, issues }`.
- Execution failures carry `nodeId`/`nodeType` as data.
- `pruneInvalidEdges` drops edges to ports that no longer exist, on preset update and workflow save. Prune the handle, never the node.

## Execution semantics
- A workflow has exactly one Chat Input and **at least one sink**. Read sinkness only through `isSink(definition, config)`: `sink` may be a function of the config (the LLM node with write tools); the descriptor's static `sink` uses the default config. Only sinks and the nodes they depend on run; the rest are logged as `skipped` ('not needed by any output').
- Replies come only from Chat Outputs. A workflow without one is valid (it runs in the after section when listed below the last replying workflow). Chat Input outputs `message`, `history`, `replies` (what the runs above it saved this turn) and `turn`.
- Each Chat Output that runs appends one assistant message, in a deterministic order: dependency first (output Y precedes X when Y's transitive upstream set is a strict subset of X's), then the `order` config as a priority among outputs with no remaining predecessor, then node id. It never depends on which output finishes first.
- If no output runs, the turn has no reply and the execution records a warning. On failure, the replies already completed are kept and returned in the error details.
- A connected output port that a node doesn't return is an error, unless the port is `optional` (Condition branches).
- Inputs: a `required` input must be connected, and a skipped source skips the node. `requiredIfConnected` is only the second half: an optional input that, once connected, skips the node when its source was skipped or didn't produce the port (so a gate on a branch not taken stays closed). A node can't otherwise tell an unconnected input from a skipped one: both are absent from `ctx.inputs`. A node whose connections are all inactive is skipped, but `neverSkips` inputs never count towards that rule.
- On failure, the sibling nodes of the same wave are aborted and settled (`cancelled`) before the error is thrown, waiting at most until their original deadline; work that ignores the abort is left detached and ignored. **After that, the execution log never changes.**
- `onEvent` observers can never change the outcome: their exceptions are swallowed.
- **Timeouts:** a wall-clock deadline per node (`definition.timeoutMs`, default 30s). Nodes whose work is a network call own their real timeout (LLM idle timeout between stream chunks, http-request's `timeoutMs`) and declare 10 min as a backstop only.
- **Logs:** `ctx.log(message)` appends to `nodes[id].logs` (ignored once the node settled). Log what a user needs to debug a failure, truncated (Parse JSON's raw input, 500 characters). Logs are stored and shown: never log secrets, headers or unredacted request data.
- **Randomness:** every run has a seed (`seed` option or a generated `randomUUID()`), recorded as `execution.seed`. Nodes draw only through `ctx.random()` (sfc32 seeded by cyrb128 of `${seed}:${nodeId}`), **never `Math.random`**, so a run's rolls reproduce from its log. A golden test pins the algorithm: changing it breaks reproducing old runs. Each run of a turn has its own seed.

## What a run receives
- **Chat settings:** the `settings` option holds values already resolved by the caller. Nodes see the frozen `ctx.settings`, templates `{{settings.<key>}}` (`{{settings}}` is compact JSON), the log `execution.settings` (`{}` when none). Nodes never read a session's stored values themselves.
- **Story state:** the `state` option (a `StateSnapshot`) is the read-only `ctx.state`, and `{{state.*}}`/`{{trigger.turn}}` in templates. Templates read only `ctx.state.values`.
- **Writes are buffered:** `ctx.writeState` only buffers (`StateWriteBuffer`, wired by `StateRun`). A node's requests count only when it completes, and resolve in a fixed order (wave, node id, call order) into `writes` on the result and on `ExecutionFailure.writes`. Item ids are `<executionId>:<nodeId>:<n>`.
- `StateWriteBuffer.writer` stamps `turnId` and `runId` on an `add` to a thread key, from the `turnId` option (`ctx.trigger.turnId`; without it the run id stands in) and the run's execution id.
- **Read-your-own-writes** (only for the writing node): `ctx.pendingState()` also shows THIS node's buffered writes; `ctx.state`, templates and other nodes keep the turn-start snapshot. The engine never rebuilds fold inputs: `StateRun.pendingView(nodeId)` resolves that node's requests against the run snapshot and hands them to the caller's `foldWith(pending)`, cached until the node's next write. Without `foldWith`, or without writes, it is the snapshot.

## Presets (rendering)
- Fixed entries that render to empty text are dropped, so an entry holding only one empty variable disappears.
- A message entry's `name` is rendered, trimmed and sent as the message name only when non-empty. Messages slots carry the history's names.
- `renderMessagesSlot` validates each message and emits only the canonical keys (`MESSAGE_KEYS`; tool calls verbatim): tool messages, `reasoning`, `provider_data` and `provenance` reach the prompt, the stored bookkeeping (`id`, `executionId`, `status`, ...) never does.
- **Slots render from the RAW `options.inputs`.** Templates and text coercion read the `forTemplates` copy, which strips `reasoning`, `provider_data` and `provenance`. A slot rendered from the stripped copy would leave the replay policy nothing to act on.
- **Depth counts blocks** (`depthPosition` over `messageBlocks`): an entry never lands between a tool call and its result.
- A `character` connected to an LLM node replaces the session character for that node's macros and aliases. The preset input key `character` is reserved.

## Tests
- `vi.restoreAllMocks()` does not undo a `mockReturnValue` on a module mocked with `vi.mock(..., { spy: true })` (`renderPreset` in `llm-prompt.test.ts`). A test that needs the real behaviour sets a call-through implementation explicitly.
- Fake LLMs replace the `openai-compatible` adapter (`useAdapter`/`restoreAdapter` in `test-providers.ts`) and answer with `chatResponse(text)`; never register fake provider ids.

## Text stats (`src/text-stats/`)
Raw per-reply metrics (words, MTLD, slop words, 4-gram overlap, recycled sentences), computed on demand and never stored. English only; the web never computes them, so nothing from here goes through `packages/shared`.
- **One tokenizer** (`tokenize.ts`) feeds every metric. A new metric reads its tokens, never re-splits the text. Fenced code, link targets and URLs are not prose and are dropped before anything is counted.
- **The minimum lengths are part of a metric's definition**, not a display choice: MTLD is `null` under `MIN_MTLD_TOKENS`, a sentence counts only from `MIN_SENTENCE_WORDS` words, overlap is `null` with no window or no 4-gram. An undefined metric is `null`, never `0`.
- **The window rule has one home, `replyWindow`:** the last `WINDOW_SIZE` assistant replies of the chat history before the reply, the reply excluded. A stopped (`partial`) reply gets stats of its own but is never in a window; `chatStats` takes the history from the caller (the server's `historyMessages`) and does not re-derive it. The Text Stats node must use `replyWindow` too.
- Each text is analyzed once per request (`chatStats`); no cache across requests.
- `slop_list.json` is vendored from sam-paech/slop-score (MIT, notice in `NOTICE.md`), byte for byte: Biome skips it. Only the word list is used, no rates.
