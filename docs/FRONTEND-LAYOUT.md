# Frontend layout

Design reference for the web app's chat-centred layout. It replaces the old "top nav bar plus one full-width page per tab" layout. The goal: the user can edit workflows, presets, characters, etc. while the chat stays visible.

Status: agreed design, not yet implemented. Narrow (mobile) widths are out of scope for now.

## Layout

```
┌──────────────────────── top bar (contextual, skeleton) ───────────────────────┐
├──────────────┬───────────────────────────────────────────┬────────────────────┤
│ L            │ M                                         │ R                  │
│ [icons]      │                                           │ [icons]            │
│ technical    │ chat (default)                            │ content            │
│ lists        │ or a wide editor                          │ lists              │
└──────────────┴───────────────────────────────────────────┴────────────────────┘
```

- **Top bar:** thin. Reserved for contextual UI later; it is an empty skeleton for now. All navigation lives in the column headers.
- **Three columns, L | M | R**, all resizable. Widths are remembered locally (per browser).
- **Column headers** hold icons that switch what the column shows. An icon shows a **dirty dot** when its editor has unsaved changes.

## What lives where

| Column | Content | Notes |
|---|---|---|
| **L** | Technical lists: workflows, presets. Settings. | Settings is a narrow editor shown in L. |
| **M** | The chat, by default. | Wide editors take M over. |
| **R** | Content lists: chats (session history), characters, personas. | Browsing and editing only (see below). |

## Editors

Every editor is either **narrow** or **wide**.

- **Narrow editors** (character, persona, settings) open **inside their own column** and replace its list. A back arrow returns to the list. They are mostly text; the user resizes the column if they need room.
- **Wide editors** (workflow, preset) open in **M**, and the **chat moves to R**. A close button on the editor returns the chat to M.

Example: `preset list | chat | character list` becomes `preset list | preset editor | chat`.

Rule of thumb: R only ever holds things that can be edited at R's width.

### State and switching

- Editors stay mounted when hidden, so a hidden editor keeps its draft exactly as left. The dirty dot on its header icon shows where to go back.
- Opening a wide editor while a narrow editor is open in R hides the narrow one (the chat takes R). Its state is kept and marked with a dirty dot.
- While the chat sits in R, R's header still lists the content icons plus the chat. Switching to a content list hides the chat from view. It does not close the wide editor.
- Only one wide editor is shown at a time. Others keep their drafts and show dirty dots in L.

## Two-column mode

Below a width breakpoint the layout collapses to **L | M**:

- L holds every list (technical and content, all switched by its header icons) and the narrow editors.
- M holds the chat.
- A wide editor takes M, and the chat becomes a **toggle in the M header**. Hiding the chat is acceptable in this mode.

## Unchanged behaviour

- The session's character and persona are still picked with the `ChatHeader` dropdowns. The R character and persona lists only browse and edit; clicking one does **not** assign it to the chat. To be revisited later.
- Cross-page links (e.g. "Edit preset ↗" in the LLM node panel, via node-ui's `renderLink`) keep working, but open the target editor in its slot instead of navigating to a page.

## Implementation notes

Gaps between this design and the code as it was when the design was agreed:

- **Per-page state must be lifted.** Each page owns its list and its editor together (e.g. `Presets.tsx` holds list, draft, dirty flag and selection). `useChat` and `useWorkflowEditor` each fetch their own copies of workflows, characters and presets. Lists and editors split across columns need **shared per-resource stores** (workflows, presets, characters, personas, sessions) as the single source.
- **Refresh on tab activation goes away.** `useRefreshOnTabActive` assumes only one page is visible at a time. With everything visible together, freshness comes from the stores and from **server change events for every resource** (today `/api/events` only emits `presets.changed`), which also covers other browser tabs.
- **Routing:** today one pathname is one tab. The layout (what each slot shows, open editor ids) is encoded in the URL so a reload restores it, e.g. `/?session=…&wide=preset:<id>&right=characters`.
- **Editors must fit their slot.** The workflow editor (list, palette, canvas, config panel) and the preset editor (list, editor, entry editor, preview) were built for full width. Their own list sidebars move to L. The rest should adapt to M's width (CSS container queries rather than viewport media queries).

Suggested build order, one commit (or more) per step:

1. Shared per-resource stores and server change events for every resource; drop `useRefreshOnTabActive`.
2. The shell: slot state and rules, resizable columns, the two-column breakpoint, the top-bar skeleton.
3. Split each page into a list and an editor, registered as slot content, one resource at a time.
4. URL encoding of the layout, and cross-links that open editors instead of navigating.
