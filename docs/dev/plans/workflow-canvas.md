# Workflow canvas: plan

One improvement to the workflow editor (`apps/web/src/pages/workflows/`, React Flow 12.12) are left. Phases A (canvas
basics), B (validation), C (runs) and node summaries are built; they live in
`docs/dev/reference/web.md` and the `AGENTS.md` files. When an item lands, move what it decided there and strike it from
this plan. Delete the file once it is empty.

Out of scope: MiniMap, alignment guides, subflows, cmdk, performance work.

Read first: the root `AGENTS.md`, `apps/web/AGENTS.md`, `apps/web/src/pages/workflows/AGENTS.md`,
`packages/engine/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/node-ui/AGENTS.md`,
`apps/server/src/services/AGENTS.md`, `docs/dev/reference/web.md` (workflow editor) and `engine.md` (executing, logs).

## What the code says, against the brief

The brief came from an earlier review. These points differ from it and shape the plan:

- **Item 13 is the largest item.** See its section.

## Overlays

The rule is recorded in `pages/workflows/AGENTS.md` (overlays are never part of the draft). `CanvasOverlayContext`
exists and holds the issues by node id and the live run status by node id. Node summaries use `summaryContext` for the catalogs they name records from.

## Order

One feature per commit. `npm run check` before each one. Phases run in order; items inside a phase are mostly
independent.

| Phase | Commits |
| --- | --- |
| D. Larger additions | 13 sticky notes |

13 comes last because it touches every reader of the
canvas `nodes`. Tidy (14) must then learn about notes; see the open questions.

---

## Phase D: larger additions

### 13. Sticky notes

- **Goal:** free text notes on the canvas (movable, resizable, editable), saved with the workflow but outside `nodes`,
  so the engine never sees them.
- **Schema (`shared/src/models.ts`):**
  - `workflowSchema` gets `notes: z.array(noteSchema).optional()`, where `noteSchema` is
    `{ id, text, position, size? }`, passthrough;
  - a read helper `workflowNotes(workflow)` tolerates a missing field or a non-list, like `workflowSettings()`. Stored
    workflows are not parsed on read.
- **Contract:** add `notes` to the `updateWorkflow` and `createWorkflow` body picks, and to item 4's draft body. Check
  whether zod 4's `.pick` keeps passthrough on the picked object; don't rely on it either way.
- **Server:**
  - `createWorkflow` builds the record field by field, so copy `notes` there;
  - `updateWorkflow` merges the body;
  - like `settings`, an omitted `notes` keeps the stored ones.
- **Web: the hard part.** Every reader of the canvas `nodes` assumes `data.descriptor`: `canvasToWorkflow`,
  `checkConnection`, `withDisplayNames`, `connectCandidates`' Chat Input check, the clipboard, `useDynamicPorts`, the
  dirty snapshot and the history. Two shapes:
  - (a) Notes in their own state, merged into the `nodes` prop only at render. `onNodesChange` routes changes by id.
    The history snapshot gains a `notes` list.
  - (b) Notes as a second React Flow node type in the same array, with a type guard in every reader.

  (a) keeps the many readers untouched; (b) spreads a guard everywhere. **Proposal: (a).** See the open questions.
- **Engine:** nothing. `prepareWorkflow` reads only `nodes` and `edges`. Add a test that a workflow with notes
  validates and runs unchanged.
- **Required, not optional:**
  - Notes are part of the draft: `canvasToWorkflow` writes them and the dirty `snapshot()` includes them. Otherwise a
    note-only edit reads as clean, so the unsaved guard never asks, Ctrl/Cmd+S skips it, and Revert ignores it.
  - Editing a note records a history step, grouped like config edits (`note:<id>`).
  - The note's textarea needs React Flow's `nodrag` and `nowheel` classes.
  - Duplicate (`duplicateWorkflow`) copies the notes.
- Copy and paste of notes is out of this commit.
- **Docs:** `docs/WORKFLOWS.md`, `reference/storage.md` (the workflow record), `shared/AGENTS.md` (read through
  `workflowNotes`), `pages/workflows/AGENTS.md` (how notes sit beside the nodes), `reference/web.md`.

---

## Open questions

1. **Categories (palette, built in phase A).** The palette keeps the engine's categories and only changes how a lone category renders. Do
   you also want Random moved to Creativity in the engine? That is a real regrouping, and it changes node headers and
   the `docs/WORKFLOWS.md` headings.
2. **Notes (item 13):** separate state (a, proposed) or a second node type (b)? Should Tidy (14) move notes, and
   should copy and paste carry them? The proposal: Tidy leaves notes where they are, and copy and paste come later.
   Undo and the dirty check are required either way.
