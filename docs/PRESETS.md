# Presets, characters and personas — user guide

A **preset** decides the exact list of messages an LLM node sends: fixed instructions, the chat history, the user's
message, character details, in the order you choose. **Characters** and **personas** are the cards those prompts
talk about.

- [Presets](#presets)
- [Preset files](#preset-files)
- [Importing presets from SillyTavern](#importing-presets-from-sillytavern)
- [Characters and personas](#characters-and-personas)

## Presets

Open the **Presets** list (left column). The editor opens in the middle column, with the entries on one side and the
selected entry on the other.

**Inputs** are what a workflow hands the preset. Each has a key, an optional label and description, and a type:
- **messages:** a list of messages, such as the chat history.
- **text:** one value, such as the user's message.

Every input becomes an input port of the LLM nodes that use the preset, named by its key.

**Entries** build the prompt, top to bottom. Each has a **Display name** (its label in the editor) and can be
switched off. There are two kinds:

- **Message:** a system, user or assistant message whose content is a template: `{{character.description}}`,
  `{{input.lore}}`, `{{#if ...}}` and so on (see [templating](TEMPLATING.md)). An optional **Name** (also a template)
  is sent as the message's name when it isn't empty. A message whose content renders empty is left out, so an entry
  holding only `{{character.scenario}}` disappears for a character without a scenario.
- **Slot:** puts an input at that place. A messages input expands to its messages; a text input becomes one message
  with the slot's role (user by default), left out when empty. The same input may be placed by several slots.

**Placement.** A message is placed where it sits in the list (**ordered**, the default), or at a **depth** inside a
history slot: depth 0 goes after the last message of that slot, depth 1 before the last message, and a depth beyond
the slot's length lands at its start. With history `[user: Hello, assistant: Hi]`, a system note at depth 1 gives
`[user: Hello, system: Note, assistant: Hi]`. A tool call and its results count as one message here, so a note never
lands between them.

**Checks.** Problems show in the editor as you type. Referring to an input the preset doesn't declare
(`{{input.x}}`) is an error, and so are two input keys that differ only in case (`mood` and `Mood`). An unknown variable, a template that doesn't parse, or an input that nothing uses is a
warning: the prompt still works (an unknown variable renders empty, a broken template is sent as written).

**Preview** renders the prompt as a model would get it, from a chat's history or a sample conversation, including
tool calls, tool results and reasoning when the history has them. Model and sampling settings belong to the LLM node,
not to the preset.

**The Default preset** has the inputs `history` (Chat history) and `message` (User message). Its entries are a short
main prompt with `{{character.system_prompt}}`, then the character's description, personality and scenario, your
persona's description, the example dialogue, the history slot, the post-history instructions and the user's message.
Each card field is its own entry, so an empty field adds no blank message. The character's first greeting is not
included.

**Renaming or removing an input** leaves the wires of LLM nodes that used it pointing nowhere: they are dropped when
the preset is saved.

## Preset files

Every preset is a YAML file, `data/presets/<name>.yaml`, which you can edit by hand while the app runs:

```yaml
name: My roleplay preset
description: Optional
inputs:
  - key: history
    dataType: messages
  - key: message
    dataType: text
entries:
  - displayName: Main prompt   # the editor label
    kind: message
    role: system
    enabled: true
    content: |
      Write a natural, in-character reply.
      {{character.system_prompt}}
  - displayName: Author note
    name: "{{char}}"           # optional message name sent to the model (a template)
    kind: message
    role: system
    enabled: true
    placement:                 # depth placement: points at a slot id
      mode: depth
      entryId: chat-history
      depth: 1
    content: "{{character.personality}}"
  - id: chat-history           # a slot that a depth placement targets carries a readable id
    displayName: Chat history
    kind: slot
    inputKey: history
id: 5d6c72c7-5185-4963-8227-527f12ef9eea   # bookkeeping, last
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
```

- **A preset is its `id`, not its file name.** You may rename or move files around; the app finds presets by the id
  inside. A new file without an `id` is fine: the app adds one (and the dates) the first time it reads it.
- **Optional keys:** `enabled` (true by default), `placement` (ordered by default), an entry's or input's `id` (taken
  from its position when missing, so it changes if you reorder by hand).
- **File names** follow the preset's name (lowercase, hyphens). Renaming a preset in the app renames its file. A file
  ending in `.yml` is read too.
- **A broken file** (bad YAML, a wrong field) is skipped, never changed or deleted, and the Presets list shows a
  warning with the file name and the reason until you fix it. If two files have the same `id`, the first by file name
  wins and the other is reported.
- **Text is kept exactly**, line breaks and odd characters included. Fields the app doesn't know are kept too.
- **Live editing.** The open editor follows changes on disk: a preset without unsaved changes reloads, keeping the
  selected entry. A preset with unsaved changes is never replaced; you get a warning instead, and saving overwrites
  the file. If the file was deleted meanwhile, saving fails: duplicate the preset to keep your edits.
- Older files that used `name` as the entry label still load: such a `name` is read as the label, and the file gets
  the new shape the next time it is saved.

## Importing presets from SillyTavern

**Settings**, **Import content**: save the folder of your SillyTavern install (the one that contains `data/`), then
click **Sync**. The chat-completion presets of every SillyTavern user are copied in (the user's name is added to the
preset's name unless it is `default-user`). Sync again whenever you like:

- a new SillyTavern preset is added, a changed one is updated in place (workflows using it stay connected), an
  unchanged one is left alone;
- a preset whose SillyTavern file is gone is kept and marked *source missing*;
- a file that can't be read is skipped and its copy kept. Nothing else in the SillyTavern folder is read.

Imported presets carry an *imported* badge and are **read-only**: SillyTavern stays their source. Use **Duplicate to
edit** to get an editable copy. Deleting an imported preset works, but the next Sync brings it back.

How the import reads a SillyTavern preset:
- It follows the preset's prompt order and imports only what that order lists, with its on/off switches.
- Normal prompts become message entries, their text unchanged, so SillyTavern macros the app doesn't know show up as
  warnings.
- The chat history becomes a `history` input with its slot, followed by a `message` input and a **Current message**
  slot.
- The character description, personality, scenario, example dialogue and persona description become messages with
  the matching `{{character.*}}` and `{{persona.description}}` variables.
- World info and other markers become empty entries, switched off, named after the marker.
- Prompts injected at a depth keep their place counted from the end of the chat (one injected at depth 0 lands
  right after the current message). Without a history entry they stay where the prompt order lists them.
- Sampler settings and the other top-level fields are ignored: those belong to the LLM node here.

## Characters and personas

Characters and personas have their own lists (right column).

- A **character** card holds a name, description, personality, scenario, first message, example dialogue, system and
  post-history prompts, alternate greetings, tags, creator notes and an optional avatar. The editor shows the common
  fields first and the rest under **Advanced fields**.
- A **persona** has a name, a description and an optional avatar.
- **Import** (the button, or drop files on the list or the editor): character cards as JSON (V1, V2 or V3) or PNG
  with the card embedded, the formats SillyTavern uses. An image without a card creates a persona named after the
  file. Uploads are limited to 20 MB per file. A file dropped on an editor with unsaved changes is imported as a new
  item; it doesn't replace your draft.
- **Export** a character as JSON or PNG; a PNG export works in SillyTavern and other apps that read V2 or V3 cards.
  Fields the app doesn't use are kept, so a card survives a round trip.

Pick the chat's character and persona in the chat header. Templates read them as `{{character.<field>}}`,
`{{persona.name}}` and `{{persona.description}}`, with the short forms `{{char}}`, `{{user}}` (your persona's name, or
"User") and `{{persona}}` (see [templating](TEMPLATING.md#variables)). Fields of a card may contain variables too;
they are filled in when the card is used. A reply keeps the speaker's name it had when it was written, so renaming a
character doesn't rename old replies.

Files live in `data/characters/`, `data/personas/` and `data/avatars/`.
