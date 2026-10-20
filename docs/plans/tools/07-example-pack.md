# Step 7: example pack "Scenarist with tools"

Design: [README.md](README.md). Files: `apps/server/src/examples/` (new pack, listed in `examples/index.ts`), README
"Example seeds". Follows the existing pack rules (fixed ids, the ledger, all or nothing, never overwrites; see
`AGENTS.md` Example packs).

## What it seeds

- A definition `plot` with a few keys the scenarist steers (for example `tension` number 0..10, `beat` enum,
  `threads` collection of open plot threads) and a thread key `notes` (cap 20).
- **"Scenarist (example)"**, a workflow meant to be listed below the narrator (after the reply): Chat Input →
  Thread (`plot.notes`, woven with the history) → LLM with state tools (read: every `plot` key but `notes`; write:
  `tension`, `beat`, `threads`) → State Write `add` of its `exchange` into `plot.notes`. No Chat Output.
- **"Narrator with a scenarist (example)"**: the Default narrator plus a system entry that reads `{{state.plot.*}}`
  (the scenarist's decisions reach it through state, not through the thread). Its preset parts come from
  `examples/preset-parts.ts` like the other narrators.

Since step 3 an LLM with write tools is a sink on its own; the scenarist still ends in a State Write because its
exchange must reach the thread. Thread keys are never tool targets, so `notes` stays out of the tool lists.

## Checks

- `seed-examples.test.ts` validates every seeded workflow, so the pack is covered by the existing test.
- A server test plays two turns with a fake adapter that calls the tools: the scenarist's writes land on the turn, the
  thread holds one exchange per turn, deleting the reply undoes both, and the second turn's scenarist prompt holds the
  first exchange woven after the first reply.

## Docs

README "Example seeds": the pack, what each workflow does, and how to list the scenarist below the narrator.
