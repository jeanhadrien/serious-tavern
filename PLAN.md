# Serious Tavern — Plan & Vision (remaining work)

The foundations and the MVP are built (see `README.md` for the architecture).
This file now tracks only what is left to do.

## Vision

A web app whose main page is a **chatbot**. What the chatbot replies is not hardcoded: it is produced by a **workflow** the user builds visually, n8n-style.

Guiding principles: **high modularity**, a **simple baseline** the user can configure later, and **getting the foundations right** before adding features.

## Later (designed for, not built yet)

- **Streaming**: stream tokens to the chat and highlight nodes live on the canvas (via engine events + SSE). The engine already emits the events; the transport is missing.
- **Database**: SQLite/Postgres via a new repository implementation (storage is JSON files only).
- **Auth / multi-user**: Fastify auth plugin + owner IDs on stored items. Single user for now.
- **More node types**: code/JS node, transforms, tools, RAG, etc.
- Test-run a workflow from the editor, workflow versioning, import/export (only character-card import/export exists).

## Backlog from SillyTavern learnings

[SillyTavern](https://github.com/SillyTavern/SillyTavern) is the mature chatbot app this project builds on conceptually (personas, characters, presets), minus the workflow layer. Items marked *(unverified)* are from general knowledge of SillyTavern and haven't been checked against the code.

### OpenRouter integration
- Endpoints: `POST /chat/completions`, `GET /models` (context length + pricing), `/models/{id}/endpoints` (providers), `/credits`.
- Headers: `Authorization: Bearer`, plus attribution headers `HTTP-Referer` and `X-Title`.
- Useful body params beyond the basics: `min_p`, `top_a`, `repetition_penalty`, `provider: { order, allow_fallbacks, quantizations }`, `reasoning: { effort, exclude }`, `transforms: ['middle-out']`, `response_format` (JSON schema), `tools` / `tool_choice`, `seed`, `logit_bias`.
- Prompt caching (`cache_control`) for Claude and Gemini models, detected from `/models` pricing.
- The upstream request is aborted when the client disconnects. SillyTavern has **no retry on 429**.
- **For us:**
  - Extend the LLM node config with reasoning, provider routing, seed, top_k, min_p, repetition_penalty, response format, streaming, transforms, plus an "exclude body keys" escape hatch. (Basic samplers — temperature, topP, penalties, stop, maxTokens — are done.)
  - Add a backend service that caches `/models` with a time limit (context length for trimming, pricing for cost estimates).
  - Retry with backoff on 429.

### Secrets
- SillyTavern stores keys in **plaintext** `secrets.json`. It supports **several keys per provider** (`{ id, value, label, active }`), and the UI sees only a masked tail.
- **For us:** we keep encryption at rest and write-only access (done), and adopt multiple labeled keys per provider (not done — single key per provider today). Nodes reference a secret **id**, never the value.

### Presets & prompt assembly *(unverified)*
- **Sampler presets** (temperature, top_p, top_k, min_p, penalties, context/max tokens) are separate from **prompt presets**.
- A prompt preset is an ordered list of prompt blocks `{ identifier, role, content, enabled, injection_position: relative | in-chat, injection_depth }`, with built-in markers (main, chat history, examples, world info, character/persona description, post-history instructions).
- Assembly:
  1. Reserve tokens for the reply.
  2. Add the fixed prompts.
  3. Add depth injections.
  4. Fill chat history from newest to oldest until the token budget runs out.
- **For us (backlog):**
  - Trim history to a token budget (memory is count-based `lastN` only).
  - Speaker names: an option on the history slot (messages already carry an optional `name`).
  - Assistant Name override: always use a given name on assistant messages (from the user's SillyTavern fork).
  - Per-entry custom fields in YAML, merged into the message sent to the provider (from the fork).
  - Additional parameters on the LLM node: extra request body and headers in YAML (from the fork).
  - Per-entry triggers (normal, continue, swipe, impersonate).
  - Import SillyTavern presets.

### Characters, personas, lorebooks *(unverified)*
- Character cards (V2/V3 spec, embedded in PNG): name, description, personality, scenario, first message, example dialogue, system prompt, post-history instructions, alternate greetings, embedded lorebook.
- Persona: `{ name, description, position, depth }`.
- Lorebook / world info: keyword-triggered entries scanned over the last N messages, inserted at a set position or depth, with their own token budget.
- **For us:** add a **Lorebook node** (keyword scan → injections). (V2/V3 card import and field exposure are done.)

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

## Decided deviations from the original plan

Kept here so they aren't re-litigated:

- **Macros are case-sensitive** (stock Handlebars resolution). The original plan said matching ignores case.
- **Unknown macros render as empty text** (stock Handlebars) plus a preset warning. The original plan said they are kept.
- **Nothing is automatic**: users build SillyTavern-like behaviour in their presets themselves (e.g. `{{character.system_prompt}}`). No automatic card-prompt overrides, `<START>` splitting, or legacy `<BOT>`/`<USER>` / `{{char.*}}` / `{{user.*}}` macros.
