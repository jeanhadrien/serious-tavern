# Tool calling and threads: design and plan

An LLM node can call **tools** in a loop. The first tools are generated from story state: the user picks which keys the
model may read and write, and never writes a tool definition. Each call's full exchange (assistant tool calls, tool
results, final answer, reasoning) is an output the workflow can store in a **thread**: a story state key that holds one
exchange per turn and can be replayed into a later prompt.

Stored data rules of `AGENTS.md` apply in full: additive, backward compatible, stored records never rewritten on read.

## The problem

Each workflow run starts from the chat messages and the story state. An LLM that never writes to the chat (a
"scenarist") can only remember through state, and state stores flat text items. Once that LLM calls tools, there is
nowhere to keep its tool calls and their results, nothing that can put them back into a prompt, and no message model
that can express them (`PromptMessage` is `system | user | assistant` with string content).

There is no "main" LLM. A node that replies in the chat and a node that never does follow the same rules.

## Decisions (agreed with the user)

1. **The open standard is the canonical format.** The app's message is the OpenAI Chat Completions message:
   `role`, `content`, `name`, `tool_calls`, `tool_call_id`, plus app-only fields the adapter never sends as is.
   Tool definitions are OpenAI function tools. No other message model is introduced.
2. **Own code, no LLM library.** The `openai-compatible` adapter gains tools itself. A library (Vercel AI SDK, `openai`)
   would bring its own message format or loop, and fight what the adapter is built on: record-driven wire settings,
   `extraBody` last, redaction inside the adapter, no per-backend branches. SillyTavern is hand-written too and
   normalizes every backend to `{ id, function: { name, arguments } }`.
3. **The tool loop runs inside the LLM node.** The executor runs a DAG; a loop cannot be expressed as edges. Inside the
   node, every step keeps `ctx.writeState`, `ctx.random()`, the abort signal and the wire log.
4. **Users don't define tools.** The LLM node's settings list the state keys the model may read and write; the tools
   and their JSON Schemas are generated from the definitions. Other built-in tools may come later through the same
   registry. No chat-posting tool for now.
5. **A tool reads its own writes.** Inside one LLM node, a read after a write sees the write. This is done by
   re-running the shared fold over the stored turns plus the node's pending writes, never by a second interpreter.
   Other nodes keep the turn-start snapshot.
6. **Tool errors go back to the model** as a `tool` message; the run goes on. A step limit on the node bounds the loop.
7. **Reasoning is kept.** Every assistant message records its reasoning, the provider data some backends need back
   (OpenRouter `reasoning_details`, Gemini thought signatures) and its provenance (provider id, model). Inside the loop
   it is always sent back. Across turns, a node option decides whether to replay it. Dropping what a different model
   cannot use happens at call time, in the LLM node; storage always keeps everything.
8. **Threads live in story state.** A new key type `thread` holds one exchange per item. It inherits the turn rules:
   deleting a reply, regenerate, swipes, fork and runs after the reply all behave like for any item. No separate
   per-chat store.
9. **Read and write are separate nodes** (no cycle in the graph): State Write `add` stores the LLM's `exchange` output
   in a thread key; a new **Thread** node reads the thread back as messages for a preset slot, and can weave it into
   the chat history.
10. **Streaming polish is out of scope.** A step that writes text before a tool call may briefly show that text in the
    chat while the turn streams; the stored reply holds only the final text.

## Architecture at a glance

```
                       ┌──────────── preset slot ◄── Thread node ◄── thread key (state, turn start)
                       │                                 ▲
 Chat Input ─► LLM node (tool loop) ──exchange──► State Write add ──► thread key (stored with the turn)
                  │  ▲        │
                  │  └ tools ─┘   read_state / write_<definition>_<key>   (generated from the node's settings)
                  └─text──► Chat Output (optional)
```

- `packages/shared/src/conversation/`: canonical messages, tool definitions, exchange blocks, sequence repair, weave.
- `packages/engine/src/providers/openai-compatible.ts`: tools on the wire, streamed tool-call deltas, replay fields.
- `packages/engine/src/tools/`: the tool runtime (registry, state tools) and the loop helper the LLM node calls.
- `packages/engine/src/nodes/llm/`: the loop, the new `exchange` output, the reasoning replay option.
- `packages/engine/src/nodes/thread/`: the Thread node.
- `packages/shared/src/state/`: the `thread` key type, its item, its fold and its view.

## Steps

Each step is its own commit (or a few), passes `npm run check` and keeps every existing chat, workflow, preset and log
readable. Steps 1 to 3 are useful alone: an LLM can call state tools before threads exist.

| Step | Plan | What it delivers |
|---|---|---|
| 1. Canonical conversation | [01-conversation.md](01-conversation.md) | Message and tool schemas in `shared`, blocks, sequence repair |
| 2. Adapter | [02-adapter.md](02-adapter.md) | Tools over the wire, streamed tool calls, reasoning replay, wire log as a list |
| 3. Tool loop and state tools | [03-tool-loop.md](03-tool-loop.md) | The loop in the LLM node, generated state tools, read-your-own-writes, `exchange` output |
| 4. Thread keys | [04-thread-keys.md](04-thread-keys.md) | The `thread` key type, State Write into it, fold, view, editors |
| 5. Thread node | [05-thread-node.md](05-thread-node.md) | Reading a thread back, alone or woven into the chat history |
| 6. Presets | [06-presets.md](06-presets.md) | Tool messages in slots, depth counted by block, preview |

Docs updated along the way: `README.md` (node types, tools, threads), `docs/PROVIDERS.md` (tool support, replay
fields), `docs/STATE-AND-LORE.md` (thread keys), `AGENTS.md` (contracts listed in each step).

## Glossary

- **Step**: one HTTP call of the loop: the model answers with text, tool calls, or both.
- **Exchange**: the messages one LLM node run produced, in order: for each step its assistant message, then one `tool`
  message per tool call of that step. The last message is the final assistant answer (no tool calls).
- **Block**: the unit that must never be split in a prompt: a single message, or an assistant message with
  `tool_calls` together with the `tool` messages that answer it.
- **Thread**: a story state key of type `thread`; its items are exchanges, newest first like every collection.
- **Provenance**: which provider record and model produced an assistant message.

## Open questions (for review)

- **Models without tool support.** v1 surfaces the backend's error as a node error. Should the provider record get a
  per-model `tools: false` override so the node refuses before calling, or should the node fall back to a text
  protocol? (The user's position: the provider and the LLM node handle it, nothing in presets.)
- **Reasoning on chat messages.** Chat replies keep `reasoning` but no provenance, so the replay rule treats them as
  "from another model" and never replays them. Recording provenance on replies needs Chat Output to know which LLM
  produced its text; left for later.
- **Weave dedupe.** When a run saved a chat reply, the Thread node drops the exchange's final text if it equals that
  reply. An edited reply no longer matches, so both texts appear. Acceptable, or should an edited reply also win?
- **Thread size.** A thread item can be large, and every turn stays stored. `cap` bounds what is read, not what is
  stored. Is a per-chat compaction needed later?
