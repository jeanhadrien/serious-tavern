# LLM providers — user guide

An LLM node sends its prompt to a **provider**: one OpenAI-compatible backend such as OpenRouter, OpenAI, DeepSeek, or a local server (Ollama, LM Studio, llama.cpp, vLLM).

Backends that claim to be "OpenAI-compatible" still disagree on details, and sometimes the disagreement depends on the model:
- Some accept a `name` on each message, some ignore it, and some reject the request.
- Some stream the model's reasoning as `reasoning`, others as `reasoning_content`.

A provider record lets you describe how *your* backend spells these things. The app never guesses for you. When a model misbehaves, its documentation tells you which field it expects, and you set that field in the record.

- [Quick start](#quick-start)
- [Provider fields](#provider-fields)
- [Message names: from preset to wire](#message-names-from-preset-to-wire)
- [Reasoning fields](#reasoning-fields)
- [Per-model overrides](#per-model-overrides)
- [Extra headers and body fields](#extra-headers-and-body-fields)
- [Checking what was actually sent](#checking-what-was-actually-sent)
- [Editing provider files by hand](#editing-provider-files-by-hand)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Quick start

1. **Save your API key.** Open **Settings**, choose a secret name (for example `deepseek`), paste the key and save. Keys are encrypted on the server and can never be read back. Local servers usually need no key.
2. **Create a provider.** Click the **Providers** icon (left column), then click **+ New**, or open **OpenRouter** and click **Duplicate**. Fill in the name, base URL and secret name, then **Save**.
3. **Use it.** In a workflow, open an **LLM** node, pick your provider in the provider dropdown and set the model id the backend expects (for example `deepseek-chat`).

Two providers are built in, always there and can't be edited:

| Provider | Secret name | Example models |
| --- | --- | --- |
| **OpenRouter** | `openrouter` | `openai/gpt-4o-mini`, `deepseek/deepseek-r1`, … |
| **abliteration.ai** | `abliteration` | `abliterated-model`, `abliterated-model-large-v2`, `abliterated-model-large` |

To use one, save a key under its secret name in **Settings** and pick it in the LLM node. To change anything about it, **Duplicate** it and edit the copy.

## Provider fields

| Field | What it does |
| --- | --- |
| **Name** | The label in the LLM node's dropdown. The file on disk is named after it. |
| **Base URL** | Requests go to `<base URL>/chat/completions`. The editor shows the full address under the field. |
| **Secret** | The name of an API key saved in **Settings**, sent as `Authorization: Bearer <key>`. Leave it empty for servers that need no key. The editor warns you if no secret by that name exists yet. |
| **Message names** | **Send as a message field** writes each message's name into the field you choose (usually `name`). **Don't send names** never sends one. |
| **Reasoning fields** | An ordered list of fields to read the reasoning trace from. The first non-empty one wins. |
| **Headers, extra body and overrides (YAML)** | Advanced settings: extra request headers, raw fields added to every request, and per-model overrides. |

Sampling settings (temperature, max tokens, top-p, penalties, stop) always use their standard OpenAI names and are set on the LLM node, not on the provider.

## Message names: from preset to wire

Names are set in two places, at two levels:

1. **In the preset, you decide *what* the name is.** Every preset entry has a **Display name**, its label in the editor, which is never sent anywhere. A message entry can also have a **Name**: the speaker name the model sees. It's a template, so macros work:

   ```yaml
   entries:
     - displayName: Narrator rules
       name: Narrator
       kind: message
       role: system
       content: Describe the scene in the third person.
     - displayName: Character card
       name: "{{char}}"
       kind: message
       role: system
       content: "{{description}}"
   ```

   If the name renders empty (for example `{{char}}` with no character), the message is sent without one. Chat history brought in through a messages slot keeps the names it already has.

2. **In the provider, you decide *how* the name is sent.**
   - With `messageName: name` (the default), a message goes out as `{ "role": "system", "content": "…", "name": "Narrator" }`.
   - With **Don't send names** (`messageName: null`), the name is left out.
   - Any other field name works too, if a backend expects one.

If a model ignores names but you still want the speaker visible, that's a content decision, so make it in the preset: write it into the text (`content: "Narrator: …"`), possibly in a separate preset for that model. Providers never rewrite your message content.

## Reasoning fields

While a reasoning model streams, the app looks for the reasoning trace on each chunk, trying your **Reasoning fields** in order. The default `[reasoning, reasoning_content]` covers OpenRouter and most backends that follow DeepSeek's convention. If your backend uses another field, add it to the list. If you see reasoning in the raw response (see [Checking what was actually sent](#checking-what-was-actually-sent)) but not in the chat, this list is almost always the cause.

Reasoning appears in the chat above the reply, both for streamed calls and for calls with streaming turned off.

## Per-model overrides

One provider can serve models with different habits, which is especially common through OpenRouter. Overrides change the provider's settings for the models whose id matches a pattern:

```yaml
overrides:
  - match: "deepseek/*"
    reasoningFields: [reasoning_content]
  - match: "mistralai/*"
    messageName: null
  - match: "*-thinking"
    headers:
      X-Reasoning: enabled
```

- `match` is checked against the model id on the LLM node. `*` matches anything, including `/`. Matching is case-sensitive and covers the whole id: `deepseek/*` matches `deepseek/deepseek-r1` but not `openrouter/deepseek-r1`.
- The **first** override that matches is used, so put specific patterns before general ones.
- An override can set `messageName` (including `null`), `reasoningFields`, `headers` and `extraBody`. Its `headers` and `extraBody` are merged over the provider's; the other two replace the provider's values.

## Extra headers and body fields

Some backends want an extra header (an organization id, a version flag) or a non-standard request option:

```yaml
headers:
  OpenAI-Organization: org-123
extraBody:
  seed: 42
  provider:
    order: [deepinfra, together]
```

`extraBody` is added to every request **last**, so it wins over anything the app computed, including samplers.

Two limits to keep in mind:
- It can add or replace fields, but it **can't remove** one. Setting a field to `null` sends a JSON `null`.
- Don't set `stream` in it, because that breaks reading the reply.

Some backends reject any body field they don't know. abliteration.ai is one of them, so only add fields its API reference lists (for example `prompt_cache_key` or `include_reasoning`).

## Checking what was actually sent

Every assistant message produced by a workflow has **Execution details**. For each LLM node they show an **LLM call** entry with:
- the URL and HTTP status;
- **Headers (secrets redacted)**: what was sent, with keys shown as `Bearer [redacted]`;
- **Request body**: the exact JSON sent, after your provider's mapping, overrides and `extraBody`;
- **Response**: what came back. For a streamed reply, all chunks are folded into one object under the backend's own field names. This is where you can see whether reasoning arrived as `reasoning`, `reasoning_content` or something else.

Your API key never appears there, not even when a backend echoes it back in an error. If a call failed, the request is still shown, so you can compare it with the backend's documentation. Messages from before this feature show "LLM request (older log, before provider mapping)" instead.

## Editing provider files by hand

Providers are YAML files in `data/providers/`, one per provider, and you can edit them while the app runs. Open editors update live:
- If you have unsaved changes, they are kept and you get a warning instead; saving overwrites the file.
- A file that fails to load is skipped, never modified, and reported in a warning.

A minimal hand-written file:

```yaml
name: Local Ollama
baseUrl: http://localhost:11434/v1
```

Everything else gets its default. On first load the app adds an `id` and timestamps to the file. Built-in providers have no file.

## Examples

### DeepSeek, directly

Settings: a secret named `deepseek`.

```yaml
name: DeepSeek
baseUrl: https://api.deepseek.com/v1
secret: deepseek
reasoningFields: [reasoning_content]
```

LLM node model: `deepseek-chat` or `deepseek-reasoner`.

### A local server (Ollama, LM Studio)

No secret needed.

```yaml
name: Local Ollama
baseUrl: http://localhost:11434/v1
messageName: null
```

LLM node model: the local model name, for example `llama3.1`. LM Studio usually listens on `http://localhost:1234/v1`. `messageName: null` is a safe start for local models, which rarely make use of names; remove it if yours does.

### OpenAI, directly

Settings: a secret named `openai`.

```yaml
name: OpenAI
baseUrl: https://api.openai.com/v1
secret: openai
```

Some backends only accept a restricted set of characters in `name` (for example no spaces). If a call fails because of a name, the error and the **Request body** in Execution details show it. Then adjust the names in your preset (`Alice_Smith`), or switch the provider to **Don't send names**.

### OpenRouter, tuned per model

Duplicate the built-in provider, then edit the YAML box of the copy:

```yaml
headers:
  HTTP-Referer: https://github.com/serious-tavern
  X-Title: Serious Tavern
extraBody: {}
overrides:
  - match: "deepseek/*"
    reasoningFields: [reasoning_content, reasoning]
  - match: "mistralai/*"
    messageName: null
```

Then select the copy, not **OpenRouter**, in your LLM nodes. Your existing secret named `openrouter` keeps working, because the copy references the same secret.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `Missing <name> secret. Add it in Settings.` | The provider's **Secret** names a key that isn't saved. Add it in **Settings** under exactly that name. |
| `Unknown LLM provider: <id>` | The node points at a provider that was deleted. Pick another one in the node's dropdown, which shows "Unknown provider" for it. |
| `<provider> 400: …` mentioning `name` | The backend rejects message names. Use **Don't send names**, globally or in an override for that model. |
| A `400` mentioning `reasoning` | The app sends reasoning options as OpenRouter's `reasoning` object when **reasoning effort** (or a reasoning budget or exclude) is set on the node. Backends other than OpenRouter may refuse it: set reasoning effort to *off* on the node. |
| No reasoning in the chat | Check **Response** in Execution details for the field that holds it, and add that field to **Reasoning fields**. Reasoning is also only kept when the LLM's text goes straight into a Chat Output, not through a template. |
| `<provider> returned a response that is not JSON` | The base URL probably doesn't point at the API: a missing `/v1`, or a web page instead of an API. The response text is in Execution details. |
| Can't delete a provider | It's still used by LLM nodes. The message lists the workflows: switch those nodes to another provider first. |
| Can't edit **OpenRouter** or **abliteration.ai** | It's built in and read-only. **Duplicate** it and edit the copy. |
