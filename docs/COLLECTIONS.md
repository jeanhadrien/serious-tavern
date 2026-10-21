# Collections — user guide

A **collection** is a list of short texts you write yourself: facts about your world, places, people, or small
details a scene could use. Workflows read collections; they never change them. One kind of record serves two
uses:

| | Lorebook use | Deck use |
| --- | --- | --- |
| Node | **Recall** | **Draw** |
| How an entry is chosen | Its keywords appear in the recent chat | A weighted random pick among entries that pass filters |
| What it is for | Consistency: what the model must know | Freshness: what the model wouldn't think of |

A collection can be both: entries with keywords are lore, entries with tags and levels are deck material.

- [Quick start](#quick-start)
- [The file format](#the-file-format)
- [Editing files by hand](#editing-files-by-hand)
- [Recall](#recall)
- [Draw](#draw)
- [Wiring examples](#wiring-examples)
- [Limits](#limits)

## Quick start

1. Click the **Collections** icon (a row of books), then **+ New**.
2. Rename it, click **+ Add entry**, write the entry's text, and add keywords (for Recall) or tags and a level
   (for Draw). **Save**.
3. In a workflow, add a **Recall** or **Draw** node (category **Lore**), pick the collection in its settings, and
   connect its `text` output to a preset input or a Chat Output.

## The file format

Collections are YAML files in `data/collections/`, one per collection, named after it:

```yaml
name: Northern Wastes
description: World lore and textures for the campaign
entries:
  - title: The Salt Inn
    text: |-
      The Salt Inn sits where the old road meets the frozen river.
      Borin, its keeper, trades news for salt.
    keywords: [salt inn, innkeeper, Borin]
  - text: the smell of resin after rain
    tags: [sensory, forest]
    level: 1
  - text: a boundary stone with a worn inscription
    tags: [object, history, forest]
    level: 2
    weight: 2
  - text: a bell on a lost animal, somewhere off the path
    tags: [sound, mystery]
    level: 2
    enabled: false
```

| Entry field | Required | What it does |
| --- | --- | --- |
| `text` | yes | What the nodes output. May span several lines. An entry whose text is blank is never used. |
| `title` | no | A label for you; shown in the editor and in the nodes' `entries` output. |
| `keywords` | no | Recall adds the entry when one of them appears in the recent chat. Entries without keywords are never recalled. |
| `tags` | no | Draw's filters. Compared without regard to case or surrounding spaces (`Forest` = `forest`). |
| `level` | no | Intensity, a whole number from 1 (gentle) to 5. Draw's level filters use it. |
| `weight` | no | Draw's relative chance, default `1`. `2` is twice as likely; `0` is never drawn. |
| `enabled` | no | Default `true`. A disabled entry is ignored by both nodes. |

Any other field (on the collection or on an entry) is kept as it is, so data imported from elsewhere survives
a save from the editor.

## Editing files by hand

- The file name follows the collection's name; renaming the collection renames the file. The collection's
  identity is the `id` inside the file, so you may rename files freely.
- A new file without `id`, `createdAt` and `updatedAt` gets them added once, at the end of the file.
- A file that can't be read (bad YAML, a `level` of 7, a negative `weight`, an entry without `text`) is skipped
  and never modified. The app shows a warning naming the file and the problem until you fix it.
- Empty values are errors: write no `title:` line at all rather than `title:` with nothing after it.
- Quote keywords or tags that YAML would read as numbers or booleans: `keywords: ["1984", "yes"]`.
- The editor saves default values (`weight: 1`, `enabled: true`) by leaving them out, and writes multi-line
  text as a `|` block.
- Changes on disk show up in the app immediately. An editor with unsaved changes is never overwritten; it
  warns you instead (saving then overwrites the file).
- Entries have no stored id. The nodes report `entry-<n>` (their position), which changes when you reorder
  entries.
- A collection that a Recall or Draw node uses can't be deleted from the app: remove it from those nodes first.

## Recall

Recall adds the entries whose keywords appear in the recent chat.

- **What it reads:** the last *Scan messages* messages of the history (default 4), the message just sent, and
  its optional `text` input (for example a scene summary). Each message is searched on its own, so a keyword
  never matches across two messages. When what feeds `text` was skipped or produced nothing, Recall still
  scans the messages.
- **Keywords** are plain text: `a.b` or `(x)` match those exact characters. Matching ignores case unless *Case
  sensitive* is on.
- **Whole words only** (on by default): `inn` does not match `innkeeper`, and `Борин` does not match `Борина`
  (any alphabet). A keyword that starts or ends with a symbol, like `C++` or `#quest`, still matches.
  Languages written without spaces (Chinese, Japanese, Thai…) have no word edges to check: `東京` matches in
  `私は東京に行く`. Korean is treated the same way, because particles attach to nouns: `서울` matches in
  `서울에 가요`. Other languages that attach endings to words (Turkish, Finnish, Hungarian…) do get word
  edges, so the Turkish `kale` (castle) misses `kaleye`: turn *Whole words only* off for them.
- **Order:** collections in the order you picked them, then entries in file order.
- **Limits:** *Max entries* (default 5) and *Max characters* (default 0, no limit; the separators count). The
  list stops at the first entry that doesn't fit: a shorter entry further down is not taken instead. When
  entries were dropped, the node's log in the execution details says how many.
- **Outputs:** `text` (the entries' texts joined by the *Separator*, a blank line by default, empty when
  nothing matched), `entries` (a list of `{ collectionId, entryId, title, text, keywords, tags, level }`) and
  `count`.

## Draw

Draw picks entries at random among those that pass its filters.

- **Count** entries are drawn (default 1), never the same one twice.
- **Require tags** (all of them), **Any of tags** (at least one), **Exclude tags** (none of them).
- **Min level** and **Max level**. When either is set, **entries without a level are left out**.
- **Use weights** (on by default): an entry's chance follows its `weight`. Off, every entry has the same
  chance. Weight `0` is never drawn either way.
- **Inputs:** a connected `maxLevel` replaces *Max level* (a number, or text holding one, so an enum chat
  setting such as `"2"` works); a connected `tags` replaces *Require tags* (a list, or comma-separated text).
  If what feeds an input was skipped (a branch not taken), Draw is skipped too.
- **Outputs:** `entry` (the first drawn entry), `text` (its text, or every drawn text one per line when Count
  is more than 1), `level` (the first drawn entry's level, absent when it has none), `entries` (all drawn) and
  `reason`. When nothing is eligible, `entry`, `text` and `level` are absent and `entries` is empty: a node
  that requires them (a Chat Output) is skipped, others (an LLM through a preset input) run without them.
- **Reason** explains the result, for example `drew 1 of 14 eligible (tags: forest; level ≤ 2)`,
  `drew 2 of 2 eligible (asked for 3; tags: forest)` or `no eligible entry among 20 (tags: forest; level ≤ 2)`.
- **Reproducible:** draws come from the turn's random seed, recorded in the execution details, so the same
  seed draws the same entries.
- **Avoid recent draws** (a number of turns, default `0` = off): with `N` above 0, Draw leaves out the entries
  it drew in the last `N` turns of this chat. With `1` it never repeats what it drew in the previous turn; with
  `3` an entry has to wait three turns. It is remembered per chat and per Draw node (two Draw nodes on one deck
  don't share a memory), and it is part of the chat's story state: **deleting a reply forgets what that turn
  drew**, so regenerating a reply can draw the same entry again. Turns whose replies were deleted don't count
  towards the `N`. If every eligible entry was drawn recently, nothing is drawn: `entry`, `text` and `level` are
  absent, and the reason says `no eligible entry among 3 (2 recent excluded)`. An entry is recognised by its
  text, not its position, so moving an entry within the collection changes nothing, while **editing its text
  makes it a new entry** that is eligible again. Entries left out because they were recent are counted in the
  reason: `drew 1 of 2 eligible (1 recent excluded)`. See [story state](STATE-AND-LORE.md#story-state).

## Wiring examples

**Lore in the prompt.** Add a `text` input `lore` to your preset and a message entry where lore belongs (for
example at depth 4 of the history), with this content:

```handlebars
{{#if input.lore}}
World notes:
{{input.lore}}
{{/if}}
```

Connect Recall's `text` output to the LLM node's `lore` port. On a turn where nothing matches, the entry renders
empty and is dropped.

**An intensity dial.** Declare an enum chat setting `maxLevel` with options `1`–`5` in the workflow's chat
settings. Add a **Chat Settings** node with key `maxLevel` and connect its `value` to Draw's `maxLevel` input.
The user turns the dial in the chat panel.

**A texture, offered not imposed.** Connect Draw's `text` to a preset text input `seed`, used by an entry such
as `{{#if input.seed}}If it fits naturally, let this colour the scene: {{input.seed}}{{/if}}`. When nothing is
eligible, the input is absent and the entry disappears.

**Different wording by level.** Connect Draw's `level` output to a second preset input, `seedLevel`, and branch
on it in the entry (inputs arrive as text, so compare with a quoted number):

```handlebars
{{#if input.seed}}
{{#if (eq input.seedLevel "1")}}A small detail you may use: {{input.seed}}{{else}}Let this shape the scene: {{input.seed}}{{/if}}
{{/if}}
```

One draw, worded by its own level. (Two Draw nodes with different level ranges would draw twice per turn.)

## Limits

- Template macros inside entries (`{{char}}`) are not expanded: entries reach the prompt as written.
- Draw's memory of recent draws is per chat and per Draw node; it is not shared between chats or nodes.
- SillyTavern World Info and a card's embedded lorebook can't be imported yet.

For how collections fit with story state, the Trigger and the ready-made examples (Fresh texture draws from a deck of
forest textures), see [STATE-AND-LORE.md](STATE-AND-LORE.md).
