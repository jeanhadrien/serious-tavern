# Serious Tavern

A single-user chat app where every reply comes from a workflow you can see and change: a small graph of nodes that
picks the history, builds the prompt, calls a model and posts the answer. Workflows can remember things between turns,
draw on lore you write, summarize long chats, and let a model steer the story with tools.

## Run

You need Node.js 24 and npm.

```bash
npm install
```

```bash
npm run dev
```

Open the address shown in the terminal (normally http://127.0.0.1:5173). Save an OpenRouter key under **Settings**
(secret name `openrouter`), then click **+ New** in the chat list and send a message. The full walkthrough is in
[Getting started](docs/GETTING-STARTED.md).

## Guides

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/GETTING-STARTED.md) | Installing, your first chat, everyday chat use, regenerate and fork, the chat panel, keyboard, data and backups |
| [Workflows and nodes](docs/WORKFLOWS.md) | The workflow editor, how a workflow runs, port types, every node |
| [Presets, characters and personas](docs/PRESETS.md) | Building prompts, preset files, importing from SillyTavern, character cards |
| [Templating](docs/TEMPLATING.md) | Variables, syntax and examples for prompts and node fields |
| [LLM providers](docs/PROVIDERS.md) | Connecting OpenRouter, OpenAI, DeepSeek, local servers; models and wire settings |
| [Collections](docs/COLLECTIONS.md) | Lorebooks and decks: the file format, Recall and Draw |
| [Story state, lore and summaries](docs/STATE-AND-LORE.md) | Chat settings, story state, workflows after the reply, summaries, the Trigger, the examples |

## Working on the code

[PLAN.md](PLAN.md) is the vision. The technical documentation is in [docs/dev](docs/dev/README.md): the
[architecture](docs/dev/ARCHITECTURE.md), a reference per topic, design notes and plans, and the
[tooling](docs/dev/TOOLING.md). Run `npm run check` before every commit. Rules for contributors and coding agents are
in the `AGENTS.md` files.
