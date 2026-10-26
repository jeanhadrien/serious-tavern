# The LLM node — agent notes

The tool loop it runs is in `../../tools/AGENTS.md`; the adapter it calls in `../../providers/AGENTS.md`.

- **It is a sink exactly when `tools.write` is non-empty** (`writesState`).
- Prompt pipeline, on the rendered prompt only and never on stored data: render, `mergeSystemMessages` (consecutive unnamed system messages), `applyReplayPolicy`, `flattenUndeclaredToolBlocks` (a block calling a tool this node doesn't declare is sent as text, and the count is logged), `repairToolSequence` (count logged), then the loop.
- The node builds its tools ONCE, before flattening, and hands them to the loop: building twice doubles the log lines and makes two handle sets.
- `replayPolicies` lives in shared, so the panel offers the same values.
- **The replay policy is a plain filter on the rendered prompt** (position only: `never`, after the last user message, `always`). It never looks at `provenance` or at where a message came from: the user chose to drop that check, so preset reasoning and replies of other models replay alike. `reasoning` and `provider_data` are kept or stripped together, and both go on the wire when kept; neither takes priority.
- **A step's text does not survive the next step:** at the start of every step after the first, the loop emits `node:delta` with `{ stepStart: true }`. The server then clears the text of the rows that LLM feeds (stored rows, `partial` ones included, hold the last step's text), and the next `node.delta` frame carries `reset: true`.
- **Reasoning is never reset:** the first reasoning of a later step is prefixed with a blank line (`reasoningBreak`, applied lazily so a step without reasoning leaves no dangling separator).
