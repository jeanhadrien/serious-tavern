# Technical documentation

Docs for people and agents working on the code. User guides live one level up, in `docs/`.

- [`ARCHITECTURE.md`](ARCHITECTURE.md): the big picture, with diagrams. Start here.
- [`reference/`](reference/): what the code does, per topic: [api](reference/api.md), [engine](reference/engine.md),
  [providers](reference/providers.md), [turns](reference/turns.md), [story state](reference/story-state.md),
  [storage](reference/storage.md), [web](reference/web.md), [MCP server](reference/mcp.md).
- [`TOOLING.md`](TOOLING.md): commands, Biome, knip, live checks.
- `design/`: agreed design references for the web app. `FRONTEND-LAYOUT.md` covers where things are, and
  `FRONTEND-UX.md` covers how they behave: keyboard, Escape, unsaved work, confirmations, drag and drop, resizing.
- `plans/`: specs and step-by-step plans for work not built yet, one folder per feature. Once a plan is built, what
  it decided moves to `reference/` and the `AGENTS.md` files, and the plan is deleted.
- `explorations/`: research notes and design proposals. Later ones may amend or replace earlier ones.

Rules for working on the code are in the `AGENTS.md` files: the one at the repo root, and one in each area. The
reference explains how things work; the AGENTS.md files say what must stay true.
