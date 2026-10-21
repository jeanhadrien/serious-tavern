# Architecture

The big picture: what the parts are, how a message becomes a reply, and where data lives. Details per topic are in
[`reference/`](reference/); the rules to follow when changing code are in the `AGENTS.md` files.

## The parts

A single-user chat app. Each reply comes from a user-built **workflow** of nodes, run on the server. The web app is a
**thin client**: it never executes workflows, holds no secrets, and keeps no data except drafts and a few browser
preferences.

```mermaid
flowchart LR
  subgraph browser[Browser]
    web["apps/web<br/>React 19 + Vite"]
    nodeui["packages/node-ui<br/>node config panels"]
  end
  subgraph server[Node.js]
    srv["apps/server<br/>Fastify 5, port 3001"]
    engine["packages/engine<br/>executor, nodes, templates, LLM adapters"]
  end
  shared["packages/shared<br/>schemas, API contract, shared rules"]
  data[("data/<br/>JSON and YAML files")]
  llm(["LLM backends<br/>OpenAI-compatible"])

  web --> nodeui
  web -- "HTTP /api + SSE" --> srv
  srv --> engine
  engine -- HTTPS --> llm
  srv --> data
  web -.-> shared
  nodeui -.-> shared
  srv -.-> shared
  engine -.-> shared
```

| Package | Role |
| --- | --- |
| `packages/shared` | Zod schemas and types for every record, the **API contract** (`src/api/`: request and response of every endpoint), and the pure rules both sides must agree on: port compatibility (`canConnect`), the story state fold, message links, alternatives, the fork cut, chat settings resolution, the macro registry. |
| `packages/engine` | Workflow preparation and validation, the wave-based parallel executor, Handlebars templating, preset rendering, the node types (`src/nodes/<type>/`), the LLM adapter and the tool loop. No I/O of its own besides the LLM and HTTP calls nodes make. |
| `packages/node-ui` | Node configuration forms generated from each node's JSON Schema, and custom panels for the nodes that need more. Knows nothing of the web app's routing or API clients. |
| `apps/server` | Fastify routes (thin) over services (logic): chat turns, story state, storage, secrets, imports, change events. Owns all data and secrets. |
| `apps/web` | The three-column UI: chat, workflow editor (React Flow), editors for presets, providers, state definitions, characters, personas and collections, and settings. |

The packages are consumed as TypeScript source (npm workspaces, ESM, strict). Nothing is compiled except the web
bundle.

## How a message becomes a reply

A chat holds an ordered **reply list** of workflows. Sending a message starts a **turn**: the server runs the enabled
workflows one after another, each one a **run** with its own execution log. The workflows down to the last one that
has a Chat Output form the **reply section** and are streamed; the ones below it form the **after section**, which
runs after the reply is sent.

```mermaid
sequenceDiagram
  participant W as Web (useChat)
  participant R as Route (SSE)
  participant Q as TurnRegistry (per-chat queue)
  participant T as Turn services
  participant E as Engine
  participant P as LLM provider
  participant S as Session file

  W->>R: POST /api/sessions/:id/messages/stream
  R->>Q: queue the job (one job per chat at a time)
  Q->>T: startTurn: fold story state, resolve settings, prepare every enabled workflow
  loop each workflow of the reply section
    T->>E: executeWorkflow(prepared, state snapshot, settings, history)
    E->>P: LLM call (streamed)
    P-->>E: tokens
    E-->>R: node events
    R-->>W: SSE run.start, node.delta, ...
    T->>S: settle the run (replies, turn entry, story state writes)
  end
  R-->>W: turn.complete (stream ends)
  T-->>W: sessions.changed (via /api/events)
  loop each workflow of the after section (same queue slot)
    T->>E: executeWorkflow
    T->>S: settle the run into the same turn entry
  end
  Q->>Q: release the slot: the next queued job starts
```

- **One job per chat at a time.** Messages, regenerates and the after section share the chat's queue slot; different
  chats run concurrently. Stop ends whichever job holds the slot.
- **Validation before side effects.** Every enabled workflow is prepared (configs parsed, ports resolved, resources
  snapshotted) before anything is stored; an invalid workflow answers `WORKFLOW_INVALID` and stores nothing.
- **Inside a run** the engine executes the graph in waves: the nodes whose inputs are ready run in parallel. Only the
  **sinks** (Chat Output, State Write, an LLM with write tools) and what they depend on run. Each Chat Output that
  runs becomes one reply, in a deterministic order.
- **Failure keeps what was done:** replies already written are saved, and the next workflows of the list still run.
  A stop ends the list.

Details: [reference/turns.md](reference/turns.md), [reference/engine.md](reference/engine.md).

## Story state

Story state is what a chat remembers between turns. It is not stored as values but as **writes attached to the turn
that made them**; the current values are computed on every read by the **fold**, a pure function in shared.

```mermaid
flowchart LR
  run["A run's nodes<br/>ctx.writeState(...)"] -->|buffered, resolved in a fixed order| writes["writes of the run"]
  writes -->|settle| entry["TurnEntry in session.state.turns<br/>executionId, runs, writes"]
  messages["session.messages<br/>(active ones)"] --> fold
  entry --> fold["foldStoryState (shared)"]
  defs["state definitions<br/>data/state/definitions/*.yaml"] --> fold
  fold --> snapshot["next run's snapshot<br/>ctx.state, {{state.*}}"]
  fold --> view["state view<br/>GET /api/sessions/:id/state"]
```

A turn **counts** while one of its replies still exists. That single rule makes deleting a reply undo what its turn
stored, makes regenerate and swipes work (only the shown alternative's replies are active), and lets a fork copy
exactly the turns it keeps. Collection items may **link to chat messages** (summaries are such items); whether a link
still holds is computed on read too. Details: [reference/story-state.md](reference/story-state.md).

## Where data lives

Everything is files under `data/` (gitignored). User data is preserved across upgrades: schemas only grow, unknown
fields are kept, nothing is rewritten on read.

| What | Where | Format |
| --- | --- | --- |
| Chats (messages, settings, reply list, story state) | `data/sessions/` | JSON, one file per chat |
| Workflows, characters, personas | `data/workflows/`, `data/characters/`, `data/personas/` | JSON |
| Avatars | `data/avatars/` | images |
| Execution logs | `data/executions/` | JSON, one per run |
| Presets, providers, collections, state definitions | `data/presets/`, `data/providers/`, `data/collections/`, `data/state/definitions/` | YAML, editable by hand while the server runs |
| Secrets | `data/secrets.enc.json`, key in `data/.master.key` or `SECRETS_KEY` | AES-256-GCM |
| App settings, seed ledger | `data/app-settings.json`, `data/.seeded.json` | JSON |

Writes are atomic (temp file, then rename) and go through per-record locks. Every change is announced on one
server-sent event stream, `GET /api/events`, which the web's list stores listen to. Details:
[reference/storage.md](reference/storage.md).

## The web app

```mermaid
flowchart TB
  url["URL<br/>?session=…&left=…&wide=…&right=…"] <--> reducer
  subgraph shell[Shell]
    reducer["layout/state.ts<br/>pure reducer"] --> derive["derive.ts<br/>view → column"]
    derive --> views["every view mounted once,<br/>moved by grid-area, hidden when unused"]
  end
  stores["list stores<br/>(one per resource)"] -- "refetch on change event" --- events(["/api/events"])
  views --> stores
  views --> editors["editor stores<br/>open id, dirty flag, save"]
```

- Three columns: **L** (lists and narrow editors: workflows, presets, providers, state definitions, settings),
  **M** (the chat, or a wide editor: workflow or preset) and **R** (chats, characters, personas, collections, or the
  chat while a wide editor owns M). Two columns below 1000 px, one at a time on a phone.
- Views are never remounted when they move or hide, so a streaming reply, a draft or the canvas survives any layout
  change. The layout lives in the URL, so Back/Forward and reloads restore it.
- Lists come from shared stores fed by the change events; drafts stay inside their always-mounted editor.

Details: [reference/web.md](reference/web.md).

## Reference

| File | Covers |
| --- | --- |
| [reference/api.md](reference/api.md) | Every endpoint, with its status codes |
| [reference/engine.md](reference/engine.md) | Preparation, execution semantics, templates, presets rendering, the LLM node and tools, node internals, logs |
| [reference/providers.md](reference/providers.md) | Provider records, the OpenAI-compatible adapter, the wire log, model lists |
| [reference/turns.md](reference/turns.md) | The chat queue, streaming, the reply list, the after section, failures, regenerate, swipes, fork |
| [reference/story-state.md](reference/story-state.md) | Definitions, turn entries, the fold, State nodes, message links, threads, the state view |
| [reference/storage.md](reference/storage.md) | Files, YAML repositories, change events, locks, secrets, app settings, seeds, imports |
| [reference/web.md](reference/web.md) | The shell and URL, stores and editors, the workflow editor, the chat, story state in the chat |
| [TOOLING.md](TOOLING.md) | Commands, Biome, knip |
