# MCP server — user guide

The app includes an [MCP](https://modelcontextprotocol.io) server, so an AI agent (Claude Desktop, Claude Code, Cursor
and others) can build things in the app for you: write a preset, assemble a workflow, create or edit a character or a
persona. You describe what you want in the agent; the agent makes the records, and they show up in the app like any
other.

- [What an agent can do](#what-an-agent-can-do)
- [Before you start](#before-you-start)
- [Setting it up](#setting-it-up)
- [Working with an agent](#working-with-an-agent)
- [Troubleshooting](#troubleshooting)

## What an agent can do

| Area | Allowed |
| --- | --- |
| Presets | List, read, create, update, and preview what a preset renders |
| Snippets | List, read, create, update |
| Workflows | List, read, create, update, and check that a workflow can run |
| Node types | List them, read one type's ports and settings, work out the ports of a node |
| Characters, personas | List, read, create, update (fields left out keep their value) |
| Providers, models, state definitions, collections | Read only |
| The guides | Read the user guides in `docs/` (the same ones you are reading) |

An agent **cannot** delete anything, see or set your API keys, edit providers or settings, or start and run chats.
Presets that came from an import are read-only, as in the app.

## Before you start

1. **The app has to be running.** The MCP server does not hold any data: it passes every request to the app, so start it
   first (`npm run dev` in the repository, or just the server) and leave it running. If it is not running, the agent
   gets an error saying so.
2. Node.js 24 and `npm install` done in the repository, as for the app itself.
3. Find your repository folder, written `<repo>` below (for example `C:/Users/you/serious-tavern`; forward slashes
   work on Windows too). The command every client runs is:

   ```
   node <repo>/node_modules/tsx/dist/cli.mjs <repo>/apps/mcp/src/main.ts
   ```

   Use exactly this form rather than `npm run` or `npx`: they print a banner that breaks the connection.

The server looks for the app at `http://127.0.0.1:3001`. If you changed the app's port, set the environment variable
`SERIOUS_TAVERN_URL` (for example `http://127.0.0.1:3010`) for the MCP server, in the client's configuration.

## Setting it up

### Claude Desktop

Open **Settings, Developer, Edit Config**. This opens `claude_desktop_config.json` (on Windows in
`%APPDATA%\Claude\`, on macOS in `~/Library/Application Support/Claude/`). Add the server, with your own path, then
restart Claude Desktop:

```json
{
  "mcpServers": {
    "serious-tavern": {
      "command": "node",
      "args": [
        "<repo>/node_modules/tsx/dist/cli.mjs",
        "<repo>/apps/mcp/src/main.ts"
      ]
    }
  }
}
```

### Claude Code

```bash
claude mcp add serious-tavern -- node <repo>/node_modules/tsx/dist/cli.mjs <repo>/apps/mcp/src/main.ts
```

Add `--scope user` to have it in every project instead of the current one, and `--env SERIOUS_TAVERN_URL=http://127.0.0.1:3010`
before the name if the app is on another port. `claude mcp list` shows whether it connected.

### Cursor

Create `.cursor/mcp.json` in a project (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "serious-tavern": {
      "command": "node",
      "args": [
        "<repo>/node_modules/tsx/dist/cli.mjs",
        "<repo>/apps/mcp/src/main.ts"
      ]
    }
  }
}
```

### Other clients

Any client that can launch a stdio MCP server works: give it the command `node` with the two arguments above, and
optionally the environment variable `SERIOUS_TAVERN_URL`.

## Working with an agent

Ask in plain words: "Make a preset for a noir detective narrator with a system prompt and a place for the chat
history", or "Create a workflow that answers with the character's voice and then summarizes every 20 messages". The agent
reads the guides it needs, then creates the record. Open the app to see the result; what an agent saves appears in the
lists right away.

Things worth knowing:

- **Lists are short on purpose.** An agent sees each item's name and description, then asks for the full record when
  it needs it.
- **Workflows are saved even when they are incomplete.** The agent gets a report with the connections the app could
  not keep (they pointed at ports that do not exist) and what still stops the workflow from running, fixes it, and saves
  again. You can also use **Validate** in the workflow editor to see the same problems.
- **An agent writes a whole record at a time** (except characters and personas, where the fields it leaves out keep their
  value). If you have the same workflow or preset open with unsaved edits, saving it from the app afterwards replaces the
  agent's version: finish one side before starting the other.
- Records an agent made are yours: edit, rename or delete them in the app.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The agent says the app could not be reached | Start the app (`npm run dev`), then try again. If it listens on another port, set `SERIOUS_TAVERN_URL`. |
| The client says the server failed to start or disconnected | Check the paths in the configuration, that `npm install` was run in the repository, and that you used the `node ... cli.mjs ...` command rather than `npm run` or `npx`. |
| A tool call fails with `Error 400 VALIDATION_ERROR` | The agent sent something the app does not accept; the error lists what, and agents normally correct it and retry. |
| `Error 409 PRESET_READ_ONLY` | The preset was imported from SillyTavern and cannot be edited; use **Duplicate to edit** in the app first. |
| Other `Error ...` messages | They are the app's own errors, with the same codes as the app shows. |
