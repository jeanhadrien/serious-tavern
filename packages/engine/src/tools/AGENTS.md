# Tools and the tool loop — agent notes

The LLM node that runs the loop has its own notes in `../nodes/llm/AGENTS.md`. Reference: `docs/dev/reference/engine.md` ("The LLM node").

## Tools
- Tools are engine code generated from the node's settings (`tools.read`/`tools.write` state targets), never user-written. A tool is `EngineTool { definition, run(args, ctx) }`; `run` checks its own arguments and throws plain messages.
- **A writable key is always readable:** `read_state` offers `tools.read` plus every `tools.write` key, so the model never writes a value it cannot see. Never offer a write tool without its key in `read_state`.
- **Write tools go through State Write's `planWrite`**, never a copy of its rules (`reset` is `delete`, mapped before `checkOp`). They plan against `ctx.pendingState()`, buffer through `ctx.writeState`, and answer with the key's value from `ctx.pendingState()`.
- **Tool-only ops** (`writeOps` adds them to State Write's; State Write's panel never offers them):
  - a text key's `replace` (`old` must match exactly once) and `append` (on a new line). The tool computes the whole new text and plans it as a `set`, so what is stored is an ordinary post-value.
  - a collection item's `update` (by handle: new `text` and/or values of DECLARED fields, each checked by `collectionItem`; an undeclared name, `messages` included, is refused, so the model can never change an item's shape or link). It is planned by `planUpdate`, next to `planWrite` in State Write's `plan.ts`, and stored as the fold's `update` write with only what changed.
- Tool schemas are hand-built and flat per key type (`state-schemas.ts`); the value rules belong to `planWrite`/`collectionItem` only.
- Item handles (`#1`, ...) are per loop: a new tool that shows collection items goes through the same `ItemHandles`.
- A listed key that no longer exists is left out with a node log line. Thread keys are never offered as tools (`ToolKey` excludes them; `locateAll` logs "Left out ...").

## The loop (`runToolLoop`)
- It calls `ctx.beginWire()` before every call and runs a step's tool calls one after another, in the order sent.
- Every failure (unknown tool, bad JSON, non-object arguments, a tool that throws) becomes a `tool` message `{ "error": ... }`.
- It sends `tools`/`tool_choice`/`parallel_tool_calls` only when tools are declared, so a node without tools makes one call as before.
- After `maxSteps` it makes one last call with `tool_choice: 'none'` (tools stay declared) and strips any calls the model still sends. `toolChoice: required` applies to the first call only.

## Tests
Fakes are in `test-tools.ts` (`scriptedModel`, `callsReply`, `toolContext`). Fake adapters must answer with `chatResponse(...)`: the loop reads `ChatResponse.message`.
