# Engine reference

`packages/engine`: workflow preparation, the executor, templating, preset rendering, node types and LLM adapters
(adapters: [providers.md](providers.md)). The user-facing node reference is [docs/WORKFLOWS.md](../../WORKFLOWS.md).

## Preparing a workflow

`prepareWorkflow(workflow, resources?)` returns `{ errors, prepared? }`. On success the `PreparedWorkflow` holds a
cloned workflow with parsed and defaulted configs, the node definitions, resolved ports, incoming and upstream
dependencies, sink reachability, and execution-scoped resources.

- Every node is validated, disconnected ones included. Each dynamic port resolver runs once.
- Resource lookups (presets, characters, providers, collections, state definitions) cache their promises, missing
  results included, and clone what they fetch, so preparation and execution see the same snapshot. Loading a
  resource belongs in a node's port resolver, not in the executor.
- `validateWorkflow` is a thin wrapper returning the errors. It takes only what preparation reads (`nodes`, `edges`, `settings`), so a draft with no id or name can be validated; `prepareWorkflow` is generic over that, keeping the caller's type in `prepared.workflow`. Issues about the chat settings declarations carry `source: 'settings'`. `executeWorkflow(workflowOrPrepared, options)` prepares a
  raw workflow itself; callers that must validate before side effects prepare once and pass the result. A prepared
  workflow is valid for one turn only.
- Issues are `ValidationIssue { message, edgeId?, nodeIds? }`. Messages name nodes as `Label #k (type)`
  (`nodeDisplayName`); the web links a `WORKFLOW_INVALID` toast to `/?wide=workflow:<id>&edge=<id>`, which opens the
  workflow with the offending edge in red.
- `pruneInvalidEdges` drops edges into ports that no longer exist; the server runs it on preset update, state
  definition update and workflow save (which also reports the dropped edge ids, see `api.md`). It only trusts ports that resolved: unknown types and failing resolvers keep
  their edges.

## Executing

- **Reachability.** The nodes backward-reachable from any **sink** run; the others are logged `skipped` with `skip: { reason: 'not-needed' }`. A sink is a definition with `sink: true` (Chat Output, State Write) or whose `sink(config)` says
  so (an LLM with write tools), read through `isSink`.
- **Waves.** Ready nodes run concurrently. A Condition's untaken branch is skipped, and skipping propagates: a node
  whose connections are all inactive is skipped, a `required` input fed by a skipped node skips its node, and a
  `requiredIfConnected` input does the same once connected. `neverSkips` inputs never count toward skipping (Recall's
  extra `text`, the Trigger's signals, Thread's `history`). Merge only sees the inputs that ran.
- **The workflow version** a run used is stamped on the log as `workflowUpdatedAt` (the prepared workflow's `updatedAt`); the editor's last-run panel greys itself when it differs from the saved workflow's. Absent in older logs.
- **Why a node was skipped** is recorded in the execution log as `nodes[id].skip` (`nodeSkipSchema`: `reason` is `not-needed`, `inactive-inputs` or `source-skipped`, with `by` naming the skipped source node of the last). The `node:skipped` event carries the same object as `detail`. Logs written before it have none (and an unreadable value reads as none). The words are shared's `skipReasonText`, used by Execution details.
- **Outputs.** A connected output port a node doesn't return is an error unless the port is `optional`.
- **Replies.** Each Chat Output that completes appends one reply. Order: Y before X when Y's transitive upstream set is
  a strict subset of X's (this covers "Y feeds X" and outputs fed by a shared upstream node), then smaller `order`,
  then node id. Streamed rows use the same ranking. Finish times and canvas positions never matter. The speaker name
  is the connected character's, else the `name` config, else none; a reply stores a snapshot of `name` and
  `characterId`.
- **Result.** `{ replies: { nodeId, content, name?, characterId? }[], execution, writes }`. On failure the engine
  throws `ExecutionFailure` with `.execution`, the ordered `.replies` of the outputs that completed, `.writes` of the
  nodes that completed, and `.nodeId`/`.nodeType` for a node failure (undefined for an execution-wide abort). Callers
  use those fields, never the message.
- **Cancellation.** When a node fails, the other nodes of its wave are aborted and awaited only until their own
  deadline (`definition.timeoutMs`, else `nodeTimeoutMs`, else 30 s). One that ignores the abort is recorded
  `cancelled` (distinct from `skipped`) and left running detached: its results, wire reports and events are ignored.
  After that the log and the replies never change. Per-node setup errors are recorded as failures, not lost.
- **Timeouts.** Network nodes own their real timeout (the LLM's idle timeout between chunks, HTTP Request's
  `timeoutMs`) and declare a 10-minute backstop.
- **Events.** `onEvent` feeds the server's `TurnStream` and any other observer. It is synchronous best effort: an
  observer that throws never changes the outcome, `execution:complete` included.

### What a run receives

| Option | Reaches nodes as | Reaches templates as |
| --- | --- | --- |
| `message`, `sessionId`, `history` | `ctx.trigger.message`, `ctx.trigger.sessionId`, `ctx.history` | `{{trigger.message}}`, `{{trigger.sessionId}}`, `{{history}}` |
| `character`, `persona` | `ctx.character`, `ctx.persona` | `{{character.*}}`, `{{persona.*}}` |
| `replies` (default `[]`) | Chat Input's `replies` output: what the workflows above saved this turn | |
| `settings` (resolved by the caller) | frozen `ctx.settings` | `{{settings.*}}` |
| `state` (a `StateSnapshot`) | read-only `ctx.state` | `{{state.*}}` (only `ctx.state.values`), `{{trigger.turn}}` |
| `foldWith` | behind `ctx.pendingState()` (read-your-own-writes) | |
| `turnId` | `ctx.trigger.turnId`, stamped on thread items | |
| (the state snapshot's turn) | `ctx.trigger.turn` | `{{trigger.turn}}` |
| `seed` (else a random UUID) | `ctx.random()` | |

`ctx.writeState(request)` only buffers; see [story-state.md](story-state.md#what-a-run-sees-and-writes).

### Randomness

Every run has a seed, recorded as `execution.seed`. `ctx.random()` draws from an sfc32 stream seeded by the cyrb128
hash of `${seed}:${nodeId}`, so a run's rolls reproduce from its log. A golden test pins the algorithm.

### Execution logs

A log holds every node's status, timing, outputs, errors and `logs` (lines from `ctx.log`, absent when none), the
LLM wire exchanges, `warnings`, the `seed` and the resolved chat `settings`. A run of the after section adds
`part: 'post'` and `turnExecutionId` (the turn's id). Older logs lack `seed`, `settings` and `warnings` (read as
empty), and keep a single `wire` or a canonical `request` instead of `wires`; all of them still display.

## Node types

A node is a `NodeDefinition` in `src/nodes/<type>/index.ts`, registered in `registry.ts`: typed ports (`dataType`,
`description`, flags), a zod `configSchema`, `defaultConfig`, `execute(ctx)`, and optionally:

- `resolvePorts(config, resources)` for ports that depend on the config or on resources (presets, cards,
  definitions), read-only and without server code. The descriptor then gets `dynamicPorts: true`, and the editor asks
  `POST /api/node-types/:type/ports` on canvas load, config changes and resource changes.
- `templateFields`: config fields that accept `{{...}}`, so the editor shows variable hints.
- `sink`, `timeoutMs`.

The registry derives every descriptor (`dynamicPorts`, `sink`), so the editor needs no per-type list.

### Internals worth knowing

- **Parse JSON** looks, in order: the whole trimmed text; else the content of the first Markdown fence only (an
  unterminated fence runs to the end; an empty first fence, as in a reply to a prefilled ```` ```json ````, falls back
  to the text before it); then the first **top-level** `{…}` or `[…]` that parses and has the expected type (brackets
  inside strings are ignored, at most 100 starts are tried). Nested brackets are never tried alone, so a malformed or
  cut-off outer value fails instead of yielding a fragment. A bracket that never closes ends the search when the rest
  of the text is the start of a cut-off JSON value; otherwise it is prose and skipped. Numbers and booleans must be the
  whole candidate; `text` must be a JSON string. It logs the raw input, cut to 500 characters.
- **Random** draws exactly once (`roll`, stored in the log). Pick weights: a number in `weightField`; anything else
  weighs 1; non-positive or non-finite weights are never picked. Config errors (`min > max`, non-whole integer bounds,
  a probability outside 0..1) are reported before the run. Ports a mode lacks are pruned when the mode changes; `value`
  exists in every mode.
- **Pick Fields** keeps own fields only, logs the names it didn't find; a blank `fields` is a validation issue.
- **Recall** scans the last `scanMessages` history messages (default 4), the current message and its `text` input,
  each text on its own. Keywords are literal and trimmed. With `wholeWords`, an edge needs a word boundary only when
  the keyword's edge character is a letter, mark, digit or `_` of any script; letters of scripts written without
  spaces (Han, Hiragana, Katakana, Thai, Lao, Khmer, Myanmar) and Hangul never count as word characters. Matches keep
  collection order; `maxEntries` and `maxChars` cut at the first entry that doesn't fit. Rules: `nodes/recall/match.ts`.
- **Draw** draws `count` entries without replacement, one `ctx.random()` each, through the pure `drawEntries`. Its
  `reason` reads `drew 1 of 14 eligible (tags: forest; level ≤ 2)`, with `N recent excluded` when `avoidRecent`
  removed some. Recent draws are node state under `draws`, keyed by collection and a fingerprint of the trimmed text.
- **Trigger** state is node state under `fires`, one `{ text, level }` item per firing; cooldowns and growth come from
  the folded item turns. Its panel is custom (`panels/trigger.tsx`).
- Entries read from collections are `{ collectionId, entryId, text, keywords, tags, title?, level? }`; `entryId` is
  the position (`entry-<n>`).

## Templates

Templates are Handlebars with stock semantics and `noEscape`. The `handlebars` runtime lives in `@st/engine` and
renders presets and template fields; `@st/shared` only depends on `@handlebars/parser`, so validation walks the AST
and the web bundle carries no compiler. The macro registry in shared defines every known path, and the helpers
(`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `and`, `or`, `not`, `linked`) are listed in `templateHelperNames` and defined
in `template-helpers.ts`; Handlebars' `log` helper is removed. Character and persona fields are expanded recursively,
cycles rendering empty. A template that doesn't parse renders verbatim and never throws. In presets `{{history}}` and
messages inputs render as transcripts and objects as pretty JSON; in node templates they render compact JSON
(shared's `coerceValue` and `stringify` in `ports.ts` centralize both; the engine's `text.ts` adds the preset-only `toText`). User reference: [docs/TEMPLATING.md](../../TEMPLATING.md).

## Presets

A preset is the final, ordered message list sent to an LLM: declared **inputs** (each becomes an LLM input port named
by its key) and ordered **entries** (`message` or `slot`). User guide: [docs/PRESETS.md](../../PRESETS.md).

- Fixed messages that render to whitespace are dropped, as are empty text slots. A message entry's `name` template is
  rendered, trimmed and sent only when non-empty. An assistant entry's `reasoning` template is rendered and trimmed
  into the message's `reasoning`; an entry with reasoning is kept even with empty content (sent as `''`). On other
  roles `reasoning` is ignored and warned about. Unknown `{{input.x}}` is an error; syntax problems, unknown macros
  and unused inputs are warnings. An input referenced only by a name counts as used.
- **Messages slots** validate each message with the canonical schema (an invalid one is an error naming the input) and
  keep only the canonical keys, so tool messages and calls pass while stored bookkeeping (`id`, `executionId`,
  `status`, ...) never does. **Slots render from the raw inputs**; templates and text conversion see a copy without
  `reasoning`, `provider_data` and `provenance`.
- **Depth placement** targets an enabled slot backed by a messages input: depth 0 after its last message, depth 1
  before it, clamped to its start; depth counts blocks (a tool call and its results are one).
- The `character` input key is reserved for the LLM node's own Character port; a preset declaring it fails port
  resolution.
- Preview and execution use the same renderer. The preview shows tool calls and results and a collapsed reasoning
  view; it never flattens undeclared tool blocks (that happens at call time).

## The LLM node

Config: provider, model, preset, temperature (0.7), max tokens (1024), optional top-p, penalties and stop sequences,
reasoning options (sent as OpenRouter's `reasoning` object to every record), `mergeSystemMessages`, `streaming`
(default on) and the tool settings. History reaches the prompt only through a preset slot. Outputs: `text`, `raw`,
`exchange`.

**Prompt pipeline**, applied to the rendered prompt only (never to stored data): render the preset, merge consecutive
unnamed system messages when asked, apply the replay policy, flatten tool blocks of undeclared tools, repair the tool
sequence, then run the loop. The preset preview shows the unmerged, unflattened output.

- **Replay reasoning** (`never` by default, `sinceLastUser`, `always`): a plain filter on the rendered prompt. `never`
  strips `reasoning` and `provider_data` from every message, `sinceLastUser` keeps them only after the last user
  message, `always` keeps them all. Where a message comes from (a slot, a preset entry) and its `provenance` don't
  matter. The running loop's own messages always keep theirs. Both fields go on the wire as they are
  (`provider_data` spread, `reasoning` under `reasoningReplayField`); neither takes priority. Replaying another
  model's `provider_data` (signed or encrypted reasoning) may be refused by the backend; the fix is `never`.
- **Undeclared tool blocks** (a block with any call to a tool this node doesn't declare; every block for a node
  without tools) are sent as text: the assistant message keeps its content plus `assistant -> name(arguments)` lines,
  and its tool messages become one user message of `tool name: result` lines. The node logs the count.
- **Repair** drops tool messages and calls without a counterpart, and logs a non-zero count.

**Tools.** `tools.read` lists keys the model may read through one `read_state` tool (key names as an enum);
`tools.write` gets one `write_<definition>_<key>` tool per key (cut at 64 characters, repeats numbered). A writable key
is always readable too: `read_state` offers the union of both lists. Schemas are
generated from the definitions:

| Key type | Write tool arguments |
| --- | --- |
| number | `{ op: set \| increment \| reset, value }`, bounds in the description, clamped |
| boolean, object | `{ op?: set \| reset, value }` |
| enum | the same, options as a JSON Schema `enum` |
| text | `{ op?: set \| reset \| replace \| append, value, old }` |
| collection | `{ op: add \| remove \| reset \| update, text, handle, ...declared fields }` |

`reset` is State Write's `delete`. `update` changes the item at `handle`: a new `text`, new values of its declared
fields, or both (each value checked like an `add`'s; an undeclared field, `messages` included, is refused, and the link
stays). `planUpdate` plans it and it is stored as the fold's `update` write, holding only what changed. `replace` and `append`
exist only as tools too: `replace` changes `old` (it must appear
exactly once, else the call fails and says how often it matched) into `value`, and `append` adds `value` on a new line.
The tool computes the whole new text from the pending value and plans it as a `set`, so the stored write is an ordinary
post-value. A write tool goes through State Write's own rules, so a refused value comes back in
State Write's words; it is buffered like any write and answers with the key's value after it. Collection items are
shown as `{ handle, text, ...fields }` with handles `#1`, `#2`... per loop; `remove` takes a handle. Thread keys are
never offered.

**The loop.** Calls run one after another in the order sent; each answer goes back as a `tool` message, and every
failure becomes `{ "error": ... }` there while the loop goes on. After `maxSteps` (default 5) rounds that still used
tools, one last call is made with `tool_choice: 'none'` and the limit is logged. `toolChoice: required` applies to the
first call only; `parallelToolCalls` is sent only when set. Every call is one wire entry and every tool call one log
line. Every step streams, but only the last step's text is the answer (each later step starts with a `stepStart`
delta that resets the rows the LLM feeds); reasoning accumulates across steps. **Reading your own writes:** a read
after a write in the same loop sees it, through `ctx.pendingState()`; without `foldWith` (tests, the preview) reads see
the turn-start snapshot. Known difference: if another node of the same run writes the same key, the stored value may
differ from what this node read, because the final resolve orders every node. A `replace` or `append` is stored as
the whole new text, so it can also overwrite another node's write to that key in the same run.

**Open questions.**
- *Models without tool support:* the backend's error surfaces as a node error. A per-model `tools: false` override
  on the provider record (so the node refuses before calling) only if users hit it; no text-protocol fallback.
- *Reasoning on chat replies:* replies keep `reasoning` (every step's, joined) but no `provider_data`, so a replayed
  reply sends the readable text only, never the backend's signed or encrypted form.

**Reasoning in the chat.** Streamed reasoning arrives per chunk; a non-stream call emits the whole trace as one
`reasoningDelta` afterwards. It reaches the chat only through the streaming endpoint and only for passthrough Chat
Outputs (LLM `text` straight into `value`).

**Names.** Chat Input, Memory (messages format), slots and depth insertion keep each message's `name`; the adapter
sends it only when present, under the record's `messageName` field. No speaker prefix is ever added to content.

## Text stats

`src/text-stats/` computes uninterpreted statistics on assistant replies: nothing is stored, and the web never
computes them. `chatStats(messages, history)` returns a `TextStats` per assistant message id; `textStats(text, window)`
does one text against a list of window texts (what the Text Stats node uses).

- **Tokenizer.** Text is NFKC-normalized and lowercased, curly apostrophes become `'`. A word is a run of letters and
  digits with inner apostrophes. Everything else separates words: em-dashes, ellipses, hyphens (`well-known` is two
  words), underscores, Markdown syntax. The words inside `*actions*` and quotes are kept. Fenced code blocks, link
  targets (`[text](url)` keeps `text`) and bare URLs are dropped.
- **Per message.** `words`; `mtld` (McCarthy & Jarvis: threshold 0.72, mean of the forward and backward passes, each
  `tokens / factors`; `null` under 50 words, or when a pass completes no factor); `slopWords`, the number of tokens
  found in the vendored slop list (a count, not a rate).
- **Across messages**, against the window: `ngramOverlap`, the share of the reply's 4-gram instances (stopwords kept)
  that occur in any window reply (`null` with no window or no 4-gram); `recycledSentences`, how many of the reply's
  sentences (case and punctuation ignored, at least 4 words) equal a window sentence. Sentences end at `.`, `!`, `?`
  or a line break.
- **Window.** The 5 (`WINDOW_SIZE`) assistant replies of the chat history before the reply. `chatStats` walks the
  chat once in order: a reply's window is the history replies seen so far, and a stopped reply (not in the history)
  gets stats but never joins a window.
- **The Text Stats node** (`nodes/text-stats/`) calls `textStats` on its `text` input, whatever the `showMessageStats`
  setting says (the setting only gates the chat view). Its window is `replyWindow` over the assistant messages of the
  `history` input or, unconnected, of `ctx.history` minus the messages whose id is in `ctx.replies` (this turn's own
  replies, which an after-section run already sees in the history). One `number` output per metric plus a `stats`
  object; `mtld` and `ngramOverlap` are `optional` ports, left out of the result when `null` (and logged), so an absent
  signal counts as 0 in a Trigger. Nothing is cached.
- **Data.** `slop_list.json` is the word list of sam-paech/slop-score (MIT, see `NOTICE.md` beside it). Its bigram and
  trigram lists and the "not X, but Y" detector are not used. Background: `explorations/07-message-text-stats.md`.
