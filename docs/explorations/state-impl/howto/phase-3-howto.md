# Phase 3: collections (lorebooks and decks), how to try it

A **collection** is a list of short texts you write: world facts, places, people, small details a scene could use. Workflows only read collections; nothing in a turn ever changes them. Two nodes read them:

- **Recall** (lorebook use): adds the entries whose keywords appear in the recent chat.
- **Draw** (deck use): picks entries at random among those that pass tag and level filters.

Full reference: `docs/COLLECTIONS.md`.

## 1. Write a collection

1. In the right column header, click the **Collections** icon (a row of books). The list opens in the right column.
2. Click **+ New**. A collection named "New collection" opens in its editor, in the same column.
3. Set the **name** and an optional **description**.
4. Click **+ Add entry** for each entry. Click an entry in the list to edit it:
   - **Text** (required, multi-line): what the nodes output.
   - **Title**: a label for you.
   - **Keywords** (comma-separated): for Recall.
   - **Tags** (comma-separated) and **Level** (none, 1 to 5): for Draw's filters.
   - **Weight** (default 1; 2 is twice as likely, 0 is never drawn) and **Enabled**.

   Use the arrows to reorder entries and the trash button to delete one.
5. Click **Save**. The header dot shows unsaved changes. **Discard** goes back to the saved version. **Delete** asks for confirmation first, and it is refused while a Recall or Draw node uses the collection.

Example entries:
- Title "Salt Inn", text "The Salt Inn sits by the frozen river.", keywords `salt inn, Borin`
- text "resin after rain", tags `forest, sensory`, level 1
- text "a boundary stone", tags `forest`, level 2, weight 2
- text "a lost bell", tags `forest`, level 4

The file is written to `data/collections/<name>.yaml`. You can also edit it by hand while the app runs. The list and editor update at once, and an editor with unsaved changes is never overwritten (it warns you instead). A broken file (for example `level: 9`) is skipped and left untouched, and the list shows a warning naming the file.

## 2. Wire the nodes (no LLM needed)

In a workflow, add nodes from the palette, category **Lore**:

- **Recall** → Chat Output: connect Recall's `text` to a Chat Output `value` (template e.g. `Lore: {{input.value}}`). In Recall's settings, click **Add a collection** and pick yours. Other settings: Scan messages (default 4), Case sensitive, Whole words only, Max entries, Max characters, Separator.
- **Draw** → two Chat Outputs: connect `text` to one and `reason` to another. In Draw's settings, pick the collection, then set Count 2, Require tags `forest` and Max level 2.

Start a chat on that workflow:
- "Let's go to the salt inn and ask borin" gives the Salt Inn entry: matching ignores case by default and only matches whole words, so "Borina" alone does not match. Recall also scans the last few messages, so the entry keeps matching for a few turns after the keyword was said.
- Draw replies with two forest entries of level 2 or less ("resin after rain", "a boundary stone", in a random order) and the reason `drew 2 of 2 eligible (tags: forest; level ≤ 2)`.
- Change Require tags to a tag no entry has. The Draw text output is then skipped, and the reason says `no eligible entry among N (…)`.
- A collection id with no record shows as "Unknown collection (id)" in the panel, and the turn fails with "Collection … not found. Pick another collection in the node's settings."

## 3. Use them for real

- **Lore in the prompt:** add a `text` input `lore` to your preset and an entry `{{#if input.lore}}World notes:\n{{input.lore}}{{/if}}`. Connect Recall `text` → the LLM node's `lore` port. On a turn with no match, the entry renders empty and is dropped.
- **An intensity dial:** declare an enum chat setting `maxLevel` (options 1 to 5), add a Chat Settings node with key `maxLevel`, and connect its `value` → Draw's `maxLevel` input. A connected `tags` input (a list or comma-separated text) replaces Require tags.
- Draws are reproducible: they come from the turn's seed, which the execution details record.

## Good to know

- Once any level filter is set (Min level, Max level, or the `maxLevel` input), entries **without a level** are left out.
- Entries have no stored id. The nodes report `entry-<n>` (the entry's position), so reordering changes it.
- Draw cannot yet "avoid recent draws". That needs story state (phase 4).
