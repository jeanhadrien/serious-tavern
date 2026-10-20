# Step 6: tool messages in presets

Design: [README.md](README.md). Files: `packages/engine/src/preset.ts`, `packages/shared/src/provider.ts`,
`packages/engine/src/providers/openai-compatible.ts`, `apps/server/src/services/preset-preview.ts`, the preset preview
in the web.

## Messages slots

- `renderMessagesSlot` validates with the canonical message schema: `tool` messages, `tool_calls`, `reasoning`,
  `provider_data` and `provenance` pass through. Templates still never see reasoning (`withoutReasoning` stays for the
  template context and `{{history}}`).
- **Depth counts blocks.** A depth entry's position is computed over `messageBlocks(messages)`, so an entry at depth 2
  lands before the second-to-last block, never between a tool call and its result.
- Text slots are unchanged (a `messages` value given to a text input goes through `messages-to-text`, step 1).

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

Engine: a slot with a woven thread and a depth entry (never splits a block), validation errors for malformed tool
messages, `mergeAssistantMessages` (with and without tool calls in between). Server: preview of a preset whose slot
receives tool messages.

## Docs

`docs/TEMPLATING.md` / README preset section: tool messages in slots, depth by block. `docs/PROVIDERS.md`:
`mergeAssistantMessages`.
