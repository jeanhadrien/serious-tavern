# Step 3: the tool loop, state tools and read-your-own-writes

Design: [README.md](README.md). Files: `packages/engine/src/tools/` (new), `packages/engine/src/nodes/llm/`,
`packages/engine/src/state-writes.ts`, `state-access.ts`, `executor.ts`, `apps/server/src/services/` (what the run is
given), `packages/node-ui/src/panels/llm.tsx`.

## Tool runtime (engine)

- `EngineTool`: `{ definition: ToolDefinition, run(args: unknown, ctx: ToolContext): Promise<unknown> }`. `ToolContext`
  is the node's `ExecutionContext` plus `readState` (the fresh view, below). A tool returns a JSON value (sent as the
  `tool` message content, `JSON.stringify`) or throws; a throw becomes `{ "error": "<message>" }` in the `tool` message.
- `runToolLoop({ request, adapter, tools, maxSteps, ctx })`, a plain function the LLM node calls:
  1. call the model with `tools` (`toolChoice` from the node);
  2. append the assistant message to the exchange; no tool calls: done;
  3. for each call, in order: parse `arguments` as JSON, validate them against the tool's own schema check, run the
     tool, append the `tool` message. Unknown tool, bad JSON, invalid arguments and tool errors all become a `tool`
     message with `{ "error": ... }` that tells the model what was wrong; the loop goes on;
  4. loop. When `maxSteps` calls have been made and the model still calls tools, one last call is made with
     `tool_choice: 'none'` (tools stay declared: some backends refuse a history with tool calls and no tools) and the
     node logs that the limit was hit.
  Each call is one wire entry; each tool call is one short node log line (`step 2: write_scene_tension {"value":4} -> ok`,
  truncated like other log lines). Tools run one after another even when the model sent several calls at once, so
  their writes and rolls have a fixed order.
- Abort: the node's signal stops the loop between and during calls. The node's backstop timeout (10 min) covers the
  whole loop; a slow step is still bounded by the adapter's idle timeout.

## State tools

The LLM node config gains `tools: { read: StateTarget[], write: StateTarget[] }` (`StateTarget = { definitionId, key }`),
both default `[]`. Nothing is exposed unless listed.

- **`read_state`** (only when `read` is not empty): one tool, argument `{ keys: string[] }` whose items are an enum of
  the readable `"<definition>.<key>"` names. Returns `{ "<definition>.<key>": value }` from the fresh view. Collection
  values are items `{ id, text, ...fields }` (the item ids are what `remove` takes); thread keys are not readable here.
- **One write tool per writable key**, named `write_<definition>_<key>` (cut and suffixed with a counter when longer than
  64 or colliding). Its schema comes from the key type through `stateOpsFor`:
  - number: `{ op: 'set' | 'increment', value: number }` with the key's min/max in the description;
  - boolean, text: `{ value }`; enum: `{ value }` with the options as a JSON Schema `enum`;
  - object: `{ value: object }`;
  - collection: `{ op: 'add', text, ...declared fields } | { op: 'remove', id }` as one object with `op` and optional
    fields (backends handle flat schemas better than `oneOf`);
  - `delete` (reset to default) is offered as `op: 'reset'` on every type.
  Descriptions come from the definition's `description` and a new optional key `description` (additive in
  `stateKeyDefSchema`, edited in the definitions editor).
- A write tool goes through the **same rules as State Write**: it calls `planWrite` (`nodes/state-write/plan.ts`) and
  `collectionItem`, never a copy. A problem `planWrite` would throw becomes the tool's error message. Its request goes
  to `ctx.writeState`, so it is buffered, counts only if the node completes, and resolves in the run's fixed order.
- The tool result of a write is the key's value after the write, read from the fresh view.

## Read-your-own-writes (re-run the fold)

Today a node reads the turn-start snapshot (`ctx.state`). For an LLM node with tools:

- `executeWorkflow` gets, next to `state`, the fold's input for this run: `stateSource = { definitions, messages, state,
  workflowId, including, history }` (what `foldSession`/`foldRun` already compute on the server; the server passes it
  through). Callers without it (tests, preset preview) keep the snapshot-only behaviour: reads after writes then see the
  snapshot, and the node logs nothing special.
- `StateRun` exposes `pendingView(nodeId)`: resolves that node's buffered requests (`resolveWrites` over its requests
  only, against the snapshot), appends them to the stored state exactly as the settle would (the shared
  `withTurnEntry`/`withRunSettled` with the run's turn id, so a first run creates the entry and a later run appends
  after the earlier runs), and runs `foldStoryState` + `stateSnapshot` on the result. It is computed lazily, only when a
  tool reads after a write, and cached until the next write.
- Only the writing node sees its writes. Other nodes, templates and `ctx.state` keep the turn-start snapshot, so
  parallel nodes stay deterministic.
- Known difference: if another node of the same run writes the same key (an increment), the stored post-value may
  differ from what this node read, because the final resolve orders all nodes. The node log says nothing; the README
  documents it.

## The LLM node

- Config: `tools` (above), `maxSteps` (default 5, min 1), `toolChoice` (`auto` default, `required`),
  `parallelToolCalls` (unset by default), `replayReasoning` (`never` default, `sinceLastUser`, `always`).
- Without tools the node behaves exactly as today (one call, same outputs), plus the new output.
- New output **`exchange`** (`messages`): the exchange of this run (one message for a node without tools). `text` is
  the final content, `raw` the last response, as today.
- **Reasoning replay**, applied to the rendered prompt before the call: messages keep `reasoning` and `provider_data`
  only when the policy allows (`sinceLastUser`: assistant messages after the last `user` message) **and** their
  `provenance` matches the current provider id and model. Anything else is stripped from the request, never from
  storage. Messages of the running loop always keep theirs.
- After rendering, merging and replay, `repairToolSequence` runs on the prompt; a non-zero `dropped` is logged.
- The panel (`node-ui/panels/llm.tsx`) gains a Tools section: two `StateKeyPicker` lists (read, write; thread keys
  excluded), step limit, tool choice, reasoning replay. Unknown definitions or keys show as `Unknown …` like the State
  panels and are left out of the tools at run time with a log line.
- Validation: a listed key that no longer exists is a run-time log line, not a validation issue (the node still works).

## Tests

Engine: the loop with a scripted fake adapter (no tools, one call, parallel calls, unknown tool, bad JSON, invalid args,
tool throws, step limit reached), state tools schemas per key type, write tools through `planWrite` (clamp, enum
refusal, collection fields), read-after-write through the fold (first run and a later run of a turn), writes dropped
when the node fails, `exchange` output, reasoning replay and provenance rule. Server: a turn with a tool-using LLM
node stores the tool writes on the turn like State Write's.

## Docs

`README.md`: LLM node tools. `AGENTS.md`: tools are engine code generated from settings; write tools go through
`planWrite`; read-your-own-writes re-runs the shared fold through `pendingView`, only for the writing node; tool errors
are `tool` messages.
