# Serious Tavern — Plan & Vision

## Vision

A web app whose main page is a **chatbot**. What the chatbot replies is not hardcoded: it is produced by a **workflow** the user builds visually, n8n-style.

- The user assembles **nodes** on a canvas and connects them.
- Each node maps to a functionality (call an LLM, call an API, branch, merge, read memory…).
- Clicking a node opens a **config editor that adapts to the node type**.
- When a chat message arrives, the workflow runs: nodes can trigger APIs **in parallel**, feed their results into each other, and the final node produces the chatbot response.

Guiding principles: **high modularity**, a **simple baseline** the user can configure later, and **getting the foundations right** before adding features.

## Core concepts

| Concept | Description |
|---|---|
| **Workflow** | A graph of nodes + edges. Saved, named, reusable. |
| **Node** | An instance of a node type with its own config and canvas position. |
| **Node type** | A self-contained module: input/output ports, config schema, `execute()` function, optional custom UI panel. |
| **Edge** | Connects an output port of one node to an input port of another. |
| **Session** | A chat conversation bound to a workflow. Many sessions can use the same workflow. |
| **Execution** | One run of a workflow for one chat message, with a per-node log (status, duration, output, error). |
| **Preset** | Defines the final message list sent to an LLM. It has two parts:<br>• **Inputs**: what the workflow provides, each with a key and a type (`messages`, e.g. `history`, or `text`, e.g. `message`). Each input becomes an **input port** on the LLM node that uses the preset.<br>• **Entries**: an ordered list, each **enabled** or disabled. A **fixed message** is system/user/assistant text that can reference inputs as `{{input.x}}`; it is placed in list order, or inserted *inside* a messages slot at a **depth** from the end. A **slot** places an input at that point: a `messages` input expands to its list, a `text` input becomes one message.<br>A preset contains only messages; model and samplers live on the LLM node. Edited in the **Presets** page with three columns (preset list, the preset's inputs and entries, entry editor) and a preview of the rendered messages. |
| **Character** | A SillyTavern-compatible character card: name, description, personality, scenario, first message, examples and so on, plus an avatar. Can be imported by dropping a PNG card (`ccv3`/`chara` metadata) or a JSON card, and exported as a PNG card. It is chosen per chat session and exposed to templates as `{{char}}` and `{{char.*}}`. |
| **Persona** | The user's identity: name, description and avatar. Dropping an image creates a persona; if the image contains card metadata, name and description are pre-filled. It is chosen per chat session and exposed as `{{user}}` and `{{user.*}}`. |
| **Provider** | An LLM backend behind a common interface (`chat(messages, model, params)`). The LLM node picks a provider, so it is provider-agnostic. OpenRouter is the first provider. |

## Key decisions

- **Stack:** TypeScript monorepo (npm workspaces).
  - `packages/shared`: types + zod schemas shared by front and back.
  - `packages/engine`: pure TS workflow executor + node registry (no HTTP/storage dependencies).
  - `packages/node-ui`: React config panels, auto-generated from each node's config schema, with optional custom panels.
  - `apps/server`: Fastify backend (API, storage, secrets, execution).
  - `apps/web`: React + Vite + React Flow frontend (Chat, Workflows, Presets, Settings).
- **Thin frontend, backend owns everything:** workflows, sessions, message history, executions and secrets are all stored and executed server-side. The frontend only holds transient UI state.
- **Storage:** JSON files on disk (`data/`) for the MVP, behind a repository interface so SQLite/Postgres can be swapped in later.
- **Secrets / API keys:** entered by the user in the frontend, stored **encrypted** on the backend, and **write-only** (the UI only ever sees a masked hint). Only the engine uses them when calling external APIs.
- **LLM providers:** behind a provider interface. OpenRouter comes first (OpenAI-compatible API, many models through a single key); others can be added without touching the LLM node.
- **Presets drive prompt assembly:**
  - The LLM node takes a preset. Its inputs are the preset's slots (dynamic ports).
  - Chat history reaches the LLM only through a preset slot; there is no "include history" toggle.
- **Users:** single user for now; auth comes later.

## Execution model

1. A user message is sent to a session → the backend loads the session's workflow.
2. The graph is validated (one Chat Input, one Chat Output, no cycles, valid configs).
3. Nodes run in **waves**: all nodes whose inputs are ready execute concurrently.
4. A **Condition** node routes to one branch; the other branch is marked *skipped*.
5. A **Merge** node waits for its incoming branches and ignores skipped ones.
6. The **Chat Output** node's value becomes the assistant reply; the session and execution log are saved.
7. The engine emits events (`node:start`, `node:complete`, …), which are collected into the execution log for now and ready to be streamed later.

## MVP node types

- **Chat Input**: trigger; provides the user message and history.
- **Chat Output**: produces the final reply.
- **LLM**: provider, model, preset and samplers. Its input ports come from the preset's slots.
- **HTTP Request**: call any API (method, URL, headers, body; templated).
- **Condition**: if/else branching on a templated value.
- **Merge**: joins parallel branches.
- **Memory**: formats the recent conversation history.

Adding a node type = add one folder in the engine + register it (and optionally a custom UI panel).

## MVP scope

- Chat page: multiple sessions, pick a workflow per session, view execution details per reply.
- Workflow editor: node palette, canvas, connect/delete, per-node config panel, save, validate.
- Settings page: manage API keys (masked).
- Seeded example workflows (default assistant, parallel demo).
- Tests for the engine and a server smoke test.

## Later (designed for, not built yet)

- **Streaming**: stream tokens to the chat and highlight nodes live on the canvas (via engine events + SSE).
- **Database**: SQLite/Postgres via a new repository implementation.
- **Auth / multi-user**: Fastify auth plugin + owner IDs on stored items.
- **More node types**: code/JS node, transforms, tools, RAG, etc.
- Test-run a workflow from the editor, workflow versioning, import/export.

## Learnings from SillyTavern

[SillyTavern](https://github.com/SillyTavern/SillyTavern) is the mature chatbot app this project builds on conceptually (personas, characters, presets), minus the workflow layer. Notes below come from exploring a local copy. Items marked *(unverified)* are from general knowledge of SillyTavern and haven't been checked against the code.

### OpenRouter integration
- Endpoints: `POST /chat/completions`, `GET /models` (context length + pricing), `/models/{id}/endpoints` (providers), `/credits`.
- Headers: `Authorization: Bearer`, plus attribution headers `HTTP-Referer` and `X-Title`.
- Useful body params beyond the basics: `min_p`, `top_a`, `repetition_penalty`, `provider: { order, allow_fallbacks, quantizations }`, `reasoning: { effort, exclude }`, `transforms: ['middle-out']`, `response_format` (JSON schema), `tools` / `tool_choice`, `seed`, `logit_bias`.
- Prompt caching (`cache_control`) for Claude and Gemini models, detected from `/models` pricing.
- The upstream request is aborted when the client disconnects. SillyTavern has **no retry on 429**.
- **For us:**
  - Extend the LLM node config with samplers, provider routing, reasoning, transforms and response format, plus an "exclude body keys" escape hatch.
  - Add a backend service that caches `/models` with a time limit (context length for trimming, pricing for cost estimates).
  - Retry with backoff on 429.

### Secrets
- SillyTavern stores keys in **plaintext** `secrets.json`. It supports **several keys per provider** (`{ id, value, label, active }`), and the UI sees only a masked tail.
- **For us:** we keep encryption at rest and write-only access, and adopt multiple labeled keys per provider. Nodes reference a secret **id**, never the value.

### Presets & prompt assembly *(unverified)*
- **Sampler presets** (temperature, top_p, top_k, min_p, penalties, context/max tokens) are separate from **prompt presets**.
- A prompt preset is an ordered list of prompt blocks `{ identifier, role, content, enabled, injection_position: relative | in-chat, injection_depth }`, with built-in markers (main, chat history, examples, world info, character/persona description, post-history instructions).
- Assembly:
  1. Reserve tokens for the reply.
  2. Add the fixed prompts.
  3. Add depth injections.
  4. Fill chat history from newest to oldest until the token budget runs out.
- **Verified** against `default/content/presets/openai/Default.json`:
  - `prompts[]` with `marker` flags (chatHistory, charDescription, worldInfoBefore/After, personaDescription, dialogueExamples…).
  - A separate `prompt_order[]` with `enabled` flags.
  - Sampler settings in the same file.
- **For us (decided):**
  - **Presets** merge prompts and order into a single ordered `entries` list.
  - SillyTavern's markers become typed **slots**, bound to LLM node input ports.
  - Samplers stay on the LLM node.
  - Depth injection is supported.
- **Later:**
  - Trim history to a token budget.
  - Import SillyTavern presets.
  - A single **macro engine** (`{{char}}`, `{{user}}`, `{{random::a::b}}`, `{{getvar::x}}`…) with a registry of handlers, applied to all templated fields.

### Characters, personas, lorebooks *(unverified)*
- Character cards (V2/V3 spec, embedded in PNG): name, description, personality, scenario, first message, example dialogue, system prompt, post-history instructions, alternate greetings, embedded lorebook.
- Persona: `{ name, description, position, depth }`.
- Lorebook / world info: keyword-triggered entries scanned over the last N messages, inserted at a set position or depth, with their own token budget.
- **For us:** import V2/V3 cards and expose their fields as workflow variables. Personas become a small entity. Add a **Lorebook node** (keyword scan → injections).

### Chat storage *(unverified)*
- One JSONL file per chat: a header line (metadata, chat variables), then one message per line with `swipes[]`, `swipe_id` and `extra` (reasoning, model, token count, tool invocations).
- **For us:** consider JSONL for sessions (cheap appends, easy to stream). Support **swipes** early, and store the execution id / trace on each message.

### Automation & extensibility *(unverified)*
- **STscript** slash commands are effectively a text workflow language: `|` works like an edge, `{{pipe}}` carries data, closures work like subgraphs, plus `/if`, `/while`, variables and `/gen`.
- **Quick Replies**: buttons that run scripts, and can auto-run on events (user message, AI message, chat open).
- Server plugins (`init(router)`) and UI extensions with manifests and event hooks.
- **For us:**
  - Use the STscript command set as inspiration for the node catalogue.
  - Add **event trigger nodes** (on user message, on AI reply, on chat open, manual button).
  - Keep typed config schemas per node.

### Other valuable ideas *(unverified)*
- **Regex scripts** that rewrite text for display or prompt, with a scope → **Regex / Transform node**.
- **Vector storage / RAG** (embeddings via OpenRouter, top-k retrieval inserted at a depth) → **Embed / Retrieve nodes**.
- **Summarization** every N messages, stored in chat metadata → a Memory node with a summarize strategy.
- **Tool calling** with recorded invocations → an LLM node with tool-call outputs routed to HTTP nodes.
- **Reasoning** kept separate from the reply (folded in the UI, removed from the prompt).
- **Per-chat variables & author's note** → per-session key/value state that nodes can read and write.
