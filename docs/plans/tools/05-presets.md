# Step 5: tool messages in presets

Design: [README.md](README.md). Files: `packages/engine/src/preset.ts`, `packages/engine/src/template.ts`,
`packages/engine/src/nodes/llm/`, `packages/shared/src/provider.ts`, `packages/engine/src/providers/openai-compatible.ts`,
`apps/server/src/services/preset-preview.ts`, the preset preview in the web.

This step comes before the Thread node: until slots accept tool messages, a thread could not reach a prompt
(`renderMessagesSlot` accepts only `system | user | assistant` and rebuilds each message from `role`, `content`, `name`).

**Where things stand (after steps 1–4).** The LLM node (`nodes/llm/index.ts`) already renders the preset, merges
system messages, applies the reasoning replay policy (`replay.ts`) and runs `repairToolSequence` before the loop; only
the input is missing, because `renderPreset` still strips slot messages. The flattening below goes in that pipeline,
after replay and before `repairToolSequence`. `withoutReasoning` in `preset.ts` is today applied to the template
history and to `messages` inputs.

## Messages slots

- `renderMessagesSlot` validates with the canonical message schema: `tool` messages, `tool_calls`, `reasoning`,
  `provider_data` and `provenance` pass through to the rendered prompt (the LLM node decides what is sent, step 3).
- **Templates never see app-only fields.** `withoutReasoning` becomes `forTemplates`: it strips `reasoning`,
  `provider_data` and `provenance` from every message that reaches the template context (`{{history}}`, `inputs`,
  text coercion). `tool_calls` and `tool` messages stay visible to templates (they are conversation content); the
  `messages-to-text` rule of step 1 shows them readably.
- **Depth counts blocks.** A depth entry's position is computed over `messageBlocks(messages)`, so an entry at depth 2
  lands before the second-to-last block, never between a tool call and its result.
- Text slots are unchanged (a `messages` value given to a text input goes through `messages-to-text`, step 1).

## Tool blocks the node doesn't declare

A slot may carry tool calls of tools this LLM node does not declare (an old exchange of another node, a node without
tools). Some backends refuse a history whose tool calls name no declared tool.

- At call time, after rendering and before `repairToolSequence`, the LLM node turns every block whose calls name a tool
  it does not declare into plain text: the assistant message keeps its content followed by the `messages-to-text` lines
  of its calls, and its `tool` messages become one `user` message holding their `messages-to-text` lines. Blocks of
  declared tools are sent natively. This is a wire-validity fix like `repairToolSequence`, so it is automatic and
  logged (`2 tool calls of undeclared tools sent as text`).
- Never on stored data, never in the preset preview's stored form (the preview shows what is sent).

## Merging

- `mergeSystemMessages` (LLM node) is unchanged.
- The provider record gains `mergeAssistantMessages: boolean` (default `false`, per-model override): consecutive
  `assistant` messages without `tool_calls` are joined with a blank line just before the call. Never across a block with
  tool calls, and never messages with different `name`s. This is a wire difference, so it lives on the record (decided
  with the user).

## Preview

The preset preview (server and web) shows `tool` messages and tool calls (name and arguments), and the reasoning flag,
so a user can see what a woven thread looks like.

## Tests

Engine: a slot with tool messages and a depth entry (never splits a block), validation errors for malformed tool
messages, app-only fields absent from `{{history}}` and `inputs`, undeclared tool blocks flattened (declared ones
native), `mergeAssistantMessages` (with and without tool calls in between). Server: preview of a preset whose slot
receives tool messages.

## Docs

`docs/TEMPLATING.md` / README preset section: tool messages in slots, depth by block, what templates see.
`docs/PROVIDERS.md`: `mergeAssistantMessages`. `AGENTS.md`: `forTemplates` strips app-only fields; undeclared tool
blocks are flattened at call time only.
