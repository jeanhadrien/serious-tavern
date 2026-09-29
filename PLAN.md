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

## Key decisions

- **Stack:** TypeScript monorepo (npm workspaces).
  - `packages/shared`: types + zod schemas shared by front and back.
  - `packages/engine`: pure TS workflow executor + node registry (no HTTP/storage dependencies).
  - `packages/node-ui`: React config panels, auto-generated from each node's config schema, with optional custom panels.
  - `apps/server`: Fastify backend (API, storage, secrets, execution).
  - `apps/web`: React + Vite + React Flow frontend (Chat, Workflows, Settings).
- **Thin frontend, backend owns everything:** workflows, sessions, message history, executions and secrets are all stored and executed server-side. The frontend only holds transient UI state.
- **Storage:** JSON files on disk (`data/`) for the MVP, behind a repository interface so SQLite/Postgres can be swapped in later.
- **Secrets / API keys:** entered by the user in the frontend, stored **encrypted** on the backend, and **write-only** (the UI only ever sees a masked hint). Only the engine uses them when calling external APIs.
- **LLM provider:** OpenRouter (OpenAI-compatible API), which gives access to many models through a single key.
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
- **LLM (OpenRouter)**: model, system prompt, prompt template, temperature, history toggle.
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
