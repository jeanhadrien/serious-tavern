# Getting started — user guide

Serious Tavern is a single-user chat app. Every reply in a chat comes from a **workflow**: a small graph of nodes
(take the message, build a prompt, call a model, post the answer) that you can open and change in a visual editor.
This guide covers installing it, your first chat, everyday chat use, and where your data lives.

- [Install and run](#install-and-run)
- [Your first chat](#your-first-chat)
- [Chatting](#chatting)
- [Regenerate and alternatives](#regenerate-and-alternatives)
- [Forking a chat](#forking-a-chat)
- [The chat panel](#the-chat-panel)
- [Characters and personas](#characters-and-personas)
- [Finding your way around](#finding-your-way-around)
- [Keyboard](#keyboard)
- [Your data, backups and secrets](#your-data-backups-and-secrets)

Other guides: [workflows and nodes](WORKFLOWS.md), [presets, characters and personas](PRESETS.md),
[templating](TEMPLATING.md), [LLM providers](PROVIDERS.md), [collections](COLLECTIONS.md),
[story state, lore and summaries](STATE-AND-LORE.md).

## Install and run

You need **Node.js 24** and npm.

1. In the project folder, run `npm install` once.
2. Run `npm run dev`. It starts the server and the web app together.
3. Open the address shown in the terminal, normally http://127.0.0.1:5173.

The app has no accounts: it is meant to run on your own machine. If you ever put it on a network, see
[Your data, backups and secrets](#your-data-backups-and-secrets).

## Your first chat

1. **Save an API key.** Open **Settings** (left column) and save your OpenRouter key under the secret name
   `openrouter`. Keys are encrypted and can never be read back, only replaced or deleted. To use another backend
   (OpenAI, DeepSeek, a local Ollama...), see [LLM providers](PROVIDERS.md).
2. **Start a chat.** In the chat list (right column), click **+ New**. A new chat runs the **Default Assistant** workflow (or,
   when a chat is open, the same workflows as that chat).
3. **Send a message.** The reply streams in as it is written.

Two workflows come with the app: **Default Assistant** (a plain assistant using the Default preset) and **Parallel
demo** (two web requests to httpbin.org, so it needs network access). More examples, with story state and summaries,
are described in [story state, lore and summaries](STATE-AND-LORE.md#try-the-examples).

To try the app without any key, make a workflow with just **Chat Input** `message` connected to **Chat Output**
`value`: it echoes what you send.

## Chatting

- **Enter** sends, **Shift+Enter** adds a new line. What you type is kept per chat in this browser, also across
  reloads, until you send it.
- Messages render Markdown (lists, tables, code blocks, quotes). Links open in a new tab. Raw HTML in a message is
  never rendered.
- Your messages show the chat's persona; replies show the speaker the workflow gave them (a character's name and
  avatar), or "Assistant".
- When the model reasons before answering, a collapsible **Reasoning** block appears above its reply.
- **Stop** (or Escape in the composer) stops a reply. What was written so far is kept, marked "Stopped".
- While a reply is being written, the chat is locked: you can't switch, create or delete chats, or edit messages.
  Workflows that run after the reply (see [story state](STATE-AND-LORE.md#workflows-after-the-reply)) don't lock it: a
  message you send meanwhile waits its turn, and the button reads **Cancel queued message**.
- Hover a message (or focus it with the keyboard; on a touch screen the buttons are always there) for **Copy**,
  **Edit** and **Delete**. Copy takes the message's text as written, without its reasoning. Editing is inline:
  **Ctrl/Cmd+Enter** saves, **Escape** cancels. Delete asks for a confirmation.
- Editing or deleting a message changes the chat's history for the next turns. It never re-runs a workflow, and it
  doesn't change the logs of past runs. Deleting the last reply of a turn that stored story state can undo what it
  stored: the app lists what would change and asks first (see [the rewind rule](STATE-AND-LORE.md#the-rewind-rule)).
- **Execution details** under a message show the run that wrote it: every node with its status, timing, outputs and
  errors, the chat settings and the random seed it used, and for an LLM node the exact request sent to the provider.
- If a turn fails, the replies already written are kept and the error is shown. Sending again starts a new turn.

## Regenerate and alternatives

The last reply of the chat has a **Regenerate reply** button. It runs the last turn again, with the same message and
the same starting state, and keeps every result: from two alternatives on, **Previous alternative**, `n/N` and **Next
alternative** switch between them. Only the alternative on screen counts: its replies are the chat's history, and its
story state is the one that applies. Switching runs nothing.

Only the last turn can be regenerated or switched. A regenerate waits behind a running reply or workflow, and Stop
stops it like any reply.

## Forking a chat

**Fork chat from here** (the branch icon on a reply) starts a new chat that copies this one up to the end of that
reply's turn: the messages, the story state, the workflows, the settings, the character and the persona. The new chat
is named `<title> (fork)` and continues exactly where the original stood after that reply. The original is not
changed.

You can fork from the last reply of any turn, not from your own messages. A chat can't be forked while a reply or a
workflow is running.

By default the fork keeps the alternatives of the reply it starts from, so you can still switch or regenerate there.
To turn that off: **Settings**, **Chats**, "Forks keep the alternatives of the reply they start from".

## The chat panel

The sliders icon in the chat header (**Chat panel**) opens a side panel for the open chat. It works while a reply is
being written. On a narrow screen it covers the messages.

- **On reply** lists the workflows the chat runs for every message you send, top to bottom. Switch one off to skip it
  without losing its place, reorder them (drag a row, use its arrows, or `Alt+↑/↓`), remove one, or **Add workflow**.
  The workflow's name opens it in the editor. Each workflow sees what the ones above it replied and stored, so put the
  one that writes the reply first and the ones that react to it after. Changes save at once and apply from your next
  message. A new chat starts with a copy of the open chat's list.
- **Settings** has one control per chat setting the chat's workflows declare. See
  [chat settings](STATE-AND-LORE.md#chat-settings).
- **Story state** shows what the chat remembers. See [seeing what happened](STATE-AND-LORE.md#seeing-what-happened).

When a message ran several workflows, a button under its last reply lists each run with its result and log.

## Characters and personas

A **character** is who the assistant plays; a **persona** is who you are. Pick both in the chat header; templates and
presets read them (see [presets, characters and personas](PRESETS.md#characters-and-personas)). A new chat picks your
first persona when you have one.

## Finding your way around

The window has three columns: lists and narrow editors on the left, the chat or a wide editor (workflows, presets) in
the middle, and the chat list, characters, personas and collections on the right. Opening a wide editor moves the chat
to the right column, so it stays visible. Below about 1000 px the layout uses two columns, and on a phone one column at
a time, with a menu button in the header.

- Every editor keeps its draft when you look elsewhere. A dot on an icon marks unsaved changes. Opening another item
  while a draft is unsaved asks **Save**, **Discard** or **Cancel**, and the browser warns you before closing the tab.
- The address bar holds the layout (open chat, editors, items), so a reload restores it, Back and Forward step through
  what you opened, and a copied address opens the same view.
- Columns and side panels can be resized by dragging their edge; double-click the edge to reset it.

## Keyboard

- **Escape** closes the innermost thing, one step per press: a field's own action (the message editor, a model list,
  stopping a reply from the composer), an open popover, leaving the focused field, then the panel or editor that has
  focus. It never throws away a draft and never stops a workflow running after the reply.
- **Ctrl/Cmd+S** saves the editor that has focus.
- In the workflow editor: **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** or **Ctrl/Cmd+Y** redo, **Ctrl/Cmd+C** and
  **Ctrl/Cmd+V** copy and paste nodes (see [workflows](WORKFLOWS.md#the-editor)).
- In reorderable lists, **Alt+↑/↓** moves the focused row.

## Your data, backups and secrets

Everything is stored as files in the `data/` folder next to the server: chats, workflows, run logs, characters,
personas and avatars as JSON, and presets, providers, collections and state definitions as YAML files you may edit by
hand while the app runs (a file that doesn't load is skipped, left untouched and reported in the app). Upgrades keep
your data: nothing is reset, and old files keep working.

**Backups.** Stop the server, then copy the whole `data/` folder (for example to a dated zip). At the very least keep
`secrets.enc.json` and `.master.key` together: the secrets are encrypted with that key, and one without the other is
useless.

**Secrets** are encrypted with a key that is generated into `data/.master.key` on first start, or taken from the
environment variable `SECRETS_KEY` (64 hex characters). The app only ever shows a secret's name and a masked hint.

**On a network.** The app has no login. If you run it anywhere but your own machine, set `SECRETS_KEY`, restrict
access to the server and its `data/` folder, and put authentication in front of it.
