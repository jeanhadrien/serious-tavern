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

## Done: user-defined LLM providers (design record)

**Problem.** OpenAI-compatible backends disagree on field names (message `name` support, `reasoning` vs `reasoning_content`, …), often per model, and OpenRouter does not reliably translate them. Users know things the app cannot, so they get control over the wire format.

**Principles**
- **Canonical vs wire.** The app keeps its own model of a call: messages with role, content and an optional `name`; samplers; reasoning settings. A **provider record** says how that model is spelled on the wire for one backend.
- **Content stays in presets.** Anything that changes message *text* (e.g. writing "Alice: …" into the content because a model ignores `name`) is the user's preset decision, never a provider transform.
- **Mapping is deliberately small.** Only the message-name field and the reasoning response fields are mappable, plus `extraBody` as a raw escape hatch. Samplers and max tokens keep fixed OpenAI names. No transform language, no request templates.
- **Only `openai-compatible` backends** for now (OpenRouter, OpenAI, DeepSeek, Ollama, LM Studio, llama.cpp, vLLM…). Anthropic-native and text-completion backends are out of scope.

Each step below is one commit (or a few), passes `npm run check`, and keeps existing user data working.

### Step 1 — preset entry `name` → `displayName`, plus a real message `name` ✅ done
- **Schema (`packages/shared/src/preset.ts`):** every entry gets a required `displayName` (the editor label, what `name` is today). `message` entries get an optional `name: string`, a **template** rendered like `content`. `slot` entries have no `name` (a messages slot already carries one name per message).
- **Legacy data:** an entry with `name` and no `displayName` is a legacy entry: its `name` becomes `displayName` and it has no message name. This is unambiguous because `displayName` is required. Apply it to **raw data before schema validation** where stored presets are read: the YAML loader (`presetCandidate` in `apps/server/src/storage/preset-yaml.ts`) and the JSON→YAML migration (`preset-migration.ts`). Export the helper from `shared`. Do **not** put it in the zod schema (`z.preprocess` erases the input type the web client relies on). Files are rewritten in the new shape on their next save (migrate-on-write); no eager rewrite and no version marker.
- **Rendering (`packages/engine/src/preset.ts`):** render `name` with the same template context as `content`, trim it, and set `PromptMessage.name` only when non-empty. An entry whose content renders empty is still dropped.
- **Validation:** the name template is checked like content: unknown `{{input.x}}` is a schema error; syntax problems and unknown macros are warnings (path `['entries', i, 'name']`). Inputs referenced only by a name count as used.
- **YAML:** key order `id, displayName, name, kind, …`; readable slot-label ids are derived from `displayName`.
- **SillyTavern import:** the mapper writes `displayName`; bump `mapperVersion` to 3 (extend the version comment) so Sync re-applies.
- **Seeds and fixtures:** seeded presets (`apps/server/src/seed.ts`) and all test fixtures use `displayName`.
- **Web:** the entry list and editor show and edit `displayName`. Message entries get a "Name" field (optional, with the existing template hints/warnings), described as the message name sent to the model. The preset preview shows a message's rendered name when it has one.
- **Tests:** legacy file read (label preserved, no message name, new shape on save), name rendering incl. empty-name omission and macros, validation of name templates, mapper output.
- **Docs:** README (preset format) and AGENTS.md Key contracts (`displayName` vs `name`, the legacy rule).

### Step 2 — provider records and resolution ✅ done
- **Record (`packages/shared`, zod, passthrough):**
  ```yaml
  id: <uuid>                 # user providers; the built-in one has id "openrouter"
  name: My DeepSeek
  kind: openai-compatible
  baseUrl: https://api.deepseek.com/v1     # requests go to <baseUrl>/chat/completions
  secret: deepseek           # name of a secret in the encrypted store; optional (local servers need none)
  headers: {}                # extra request headers
  messageName: name          # wire field for the message name; null = never send it
  reasoningFields: [reasoning, reasoning_content]   # read from the stream delta / response message, first non-empty wins
  extraBody: {}              # merged into the request body last
  overrides:                 # first match wins; its fields replace the provider's
    - match: "deepseek/*"    # glob on the model id
      messageName: null
      reasoningFields: [reasoning_content]
  ```
  An override may set `messageName`, `reasoningFields`, `headers` and `extraBody` (objects shallow-merged over the provider's).
- **Storage:** YAML files under `data/providers/<slug-of-name>.yaml`; identity is the `id` inside the file; same rules as presets (no cache, invalid files skipped with a warning, atomic writes, id lock). Reuse or generalize the preset YAML repository rather than copying it. Live reload (`providers.changed` through the directory watcher) shipped with step 5.
- **Built-in OpenRouter provider:** defined in code, **read-only**, id `openrouter`, `secret: openrouter`, base URL `https://openrouter.ai/api/v1`, the `HTTP-Referer`/`X-Title` headers, `messageName: name`, `reasoningFields: [reasoning, reasoning_content]`. Listed with user providers and flagged `builtIn: true`. Writes to it return 409 `PROVIDER_READ_ONLY`. Existing nodes (`provider: 'openrouter'`) and the existing `openrouter` secret keep working with no migration.
- **API (contract first, `packages/shared/src/api/`):** list, get, create, update, delete, and duplicate (so the built-in one can be copied). Today's `GET /api/providers` catalog (code-registered providers, used by node-ui) becomes the record list, keeping what node-ui needs (id and label).
- **Engine:** the LLM node resolves its provider through `ctx.resources` (snapshotted by `prepareWorkflow`, like presets), not the in-code `providers` map. An unknown provider id is a node error naming the id. A missing secret keeps today's message.

### Step 3 — the `openai-compatible` adapter ✅ done
- (Now `providers/openai-compatible.ts` + `wire-settings.ts`.) Turn the OpenRouter adapter into a generic adapter driven by the resolved record (override applied): URL from `baseUrl`, auth header only when a secret is set, `headers`, message name written to `messageName` (or dropped), reasoning read from `reasoningFields` on both the stream delta and the non-stream message, `extraBody` merged last.
- Keep today's behaviour otherwise: idle timeout, abort handling, error parsing, and the OpenRouter-style `reasoning` object for effort/max tokens/exclude (other backends can neutralize it via `extraBody`; revisit if it causes 400s).
- Error messages name the provider instead of hardcoding "OpenRouter".
- Known limits: `extraBody` is a shallow merge and cannot remove keys (e.g. the `reasoning` object); `extraBody.stream` would break stream parsing. Revisit if a backend needs key removal.

### Step 4 — wire log ✅ done
- The execution log records what was actually sent: URL, headers with secrets redacted, the final JSON body; and the raw response (accumulated for streams, as today's `raw`). Shown in the existing execution details (`apps/web/src/pages/chat/ExecutionDetails.tsx`) instead of the canonical request.
- Non-streamed reasoning (`ChatResponse.reasoning`, filled since step 3) reaches the chat like streamed reasoning does.
- Known limit: reasoning (streamed or not) is stored on chat messages only via the streaming endpoint and only for Chat Outputs fed directly by an LLM `text`; the plain `POST .../messages` endpoint and templated outputs drop it.

### Step 5 — provider UI ✅ done
- A providers list and narrow editor in the layout shell, following the characters/personas pattern (list view + editor view sharing an editor store, URL-encoded layout, dirty flags).
- A form for the common fields (name, base URL, secret name, message name field, reasoning fields) and a raw YAML view for `headers`, `extraBody` and `overrides`. The built-in provider opens read-only with a "Duplicate" action.
- The LLM node's provider dropdown lists the records (node-ui gets them through its `context`, as today).

## Done: provider model catalogs (design record)

Shipped in `6c82920`, `1d5888e` and `bdce48c`. Deviations from the spec below:
- The cache key is the whole record plus a secrets revision counter, not `updatedAt`.
- `listModels` is optional on `LlmAdapter`.
- Error codes: `400 PROVIDER_SECRET_MISSING`, `501 PROVIDER_MODELS_UNSUPPORTED`, `502 PROVIDER_MODELS_FAILED` (also for a payload without `data`).
- TTL expiry is untested.

Checked live against OpenRouter (462 models) and abliteration.ai (3 models). The picker UI still needs a manual check in a browser.

**Goal.** The app knows which models each provider serves, with what it can learn about them (readable name, context size, output limit, supported parameters, pricing), and the LLM node offers a searchable model picker instead of a bare text field. Later features (warnings like "this model ignores reasoning", cost estimates, context trimming) build on the same data; they are **not** part of this work.

**Facts this design rests on**
- There is no formal standard, but `GET <baseUrl>/models` answering `{ data: [{ id, … }] }` (OpenAI's shape: `id`, `object`, `created`, `owned_by`) is the de facto one. OpenRouter (`https://openrouter.ai/api/v1/models`, ~460 models, no key required), abliteration.ai (`/v1/models`, scoped to the key's project), OpenAI, DeepSeek, Ollama, LM Studio, vLLM all serve it.
- OpenRouter entries are a superset: `name`, `description`, `context_length`, `top_provider.max_completion_tokens`, `architecture.input_modalities`/`output_modalities`, `supported_parameters` (e.g. `reasoning`, `tools`, `top_p`), `pricing` (USD **per token** as decimal strings, e.g. `"0.0000025"`; other keys like `input_cache_read` may appear).
- So **one generic code path** reads every backend; richer fields are filled when present. No OpenRouter-specific branch (same rule as the adapter).

**Decisions**
- **Normalized model** (`packages/shared`, zod): `{ id, name?, description?, contextLength?, maxOutputTokens?, inputModalities?, outputModalities?, supportedParameters?, pricing?: { prompt?, completion? } }`. Pricing is numbers in USD per token; values that are missing, non-numeric or negative (OpenRouter uses `-1` for variable pricing) are dropped. Entries without a string `id` are skipped; unknown fields are ignored (these lists are not stored, so no passthrough needed).
- **Fetching is the adapter's job**, because only the adapter knows how its `kind` talks to a backend: `LlmAdapter` gets a `listModels({ provider, apiKey?, signal })`. The `openai-compatible` one does `GET <baseUrl>/models` with the same auth rule as chat (Bearer only when the record names a secret) and the record's top-level `headers` (not override headers: overrides are per model). Errors name the provider and never contain the key (`withoutSecret`). Bounded by a timeout (~30 s).
- **Through the server only:** the key never reaches the browser, and there is no CORS problem. Endpoint `GET /api/providers/:id/models` (`?refresh=true` bypasses the cache), contract first, response `{ models, fetchedAt }`. Same secret rules as running an LLM node (set-but-missing secret is a client error with the "Missing <secret> secret" message; no secret means no auth). An upstream failure is an API error (e.g. `502 PROVIDER_MODELS_FAILED`) carrying the adapter's redacted message.
- **Cache in server memory**, per provider id, ~1 h TTL; an entry is stale as soon as the record changes (compare `updatedAt`) or any secret is written/deleted. Concurrent requests for the same provider share one in-flight fetch. Nothing is persisted; a restart refetches on demand.
- **Picker (node-ui):** a searchable combobox replacing the LLM node's Model text input.
  - Free text always wins: the user can type any id, the node config stays a plain `model` string, and nothing changes for saved workflows. Lists are not exhaustive (OpenRouter suffixes like `:free`/`:online`, local servers without `/models`).
  - Filters by id and name as you type; each option shows name, id, context size, and price per 1M tokens when known. Keyboard (arrows, Enter, Escape) and combobox ARIA roles.
  - A refresh button (lucide icon, `aria-label` + `title`) forces `refresh=true`. Loading and fetch errors show inline in the panel, not as toasts (`{ silent: true }`); a failed list never blocks typing.
  - A model typed that isn't in a successfully loaded list gets a quiet, non-blocking hint.
  - Changing the provider reloads the list and keeps the current `model` value.
  - node-ui still never calls the API: the web app passes a loader through the panel `context` (like `providers`), e.g. `loadModels(providerId, { refresh })`.

**Out of scope:** using the metadata anywhere else (validation, warnings, cost display outside the picker, context trimming), persisting lists, a per-provider models URL override, OpenRouter's `/models/user` or `/endpoints`.

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
  - Use the cached `/models` metadata (see "Provider model catalogs") for context trimming and cost estimates.
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
