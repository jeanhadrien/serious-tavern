# Tools and the tool loop — agent notes

The LLM node that runs the loop has its own notes in `../nodes/llm/AGENTS.md`. Plan: `docs/dev/plans/tools/03-tool-loop.md`; reference: `docs/dev/reference/engine.md` ("The LLM node").

## Tools
- Tools are engine code generated from the node's settings (`tools.read`/`tools.write` state targets), never user-written. A tool is `EngineTool { definition, run(args, ctx) }`; `run` checks its own arguments and throws plain messages.
- **Write tools go through State Write's `planWrite`**, never a copy of its rules (`reset` is `delete`, mapped before `checkOp`). They plan against `ctx.pendingState()`, buffer through `ctx.writeState`, and answer with the key's value from `ctx.pendingState()`.
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
