# Tool loop and the LLM node — agent notes

Covers `tools/` and `nodes/llm/`. Plan: `docs/dev/plans/tools/03-tool-loop.md`; README "Tools".

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

## The LLM node
- **It is a sink exactly when `tools.write` is non-empty** (`writesState`).
- Prompt pipeline, on the rendered prompt only and never on stored data: render, `mergeSystemMessages` (consecutive unnamed system messages), `applyReplayPolicy`, `flattenUndeclaredToolBlocks` (a block calling a tool this node doesn't declare is sent as text, and the count is logged), `repairToolSequence` (count logged), then the loop.
- The node builds its tools ONCE, before flattening, and hands them to the loop: building twice doubles the log lines and makes two handle sets.
- `replayPolicies` lives in shared, so the panel offers the same values.
- **A step's text does not survive the next step:** at the start of every step after the first, the loop emits `node:delta` with `{ stepStart: true }`. The server then clears the text of the rows that LLM feeds (stored rows, `partial` ones included, hold the last step's text), and the next `node.delta` frame carries `reset: true`.
- **Reasoning is never reset:** the first reasoning of a later step is prefixed with a blank line (`reasoningBreak`, applied lazily so a step without reasoning leaves no dangling separator).

## Tests
Fakes are in `test-tools.ts` (`scriptedModel`, `callsReply`, `toolContext`). Fake adapters must answer with `chatResponse(...)`: the loop reads `ChatResponse.message`.
