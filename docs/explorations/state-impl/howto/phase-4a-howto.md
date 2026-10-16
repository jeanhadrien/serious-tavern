# Phase 4a: story state (backend), how to try it

**Story state** is what a chat remembers between turns: a tension number, a mood, a list of notes, what a deck just drew. Workflow nodes write it, later turns read it, and it lives exactly as long as the replies of the turns that wrote it: **delete a reply and what that turn stored is undone**.

This phase is backend only. There is no screen for definitions or for a chat's state yet (phase 4b adds the pickers, a typed value editor, the chat's state panel and the per-message chips). You can already use it two ways: wire the nodes in the workflow editor, and look at the result with `curl`.

Full reference: README, section "Story state". Template syntax: `docs/TEMPLATING.md`.

```bash
API=http://localhost:3001      # npm run dev
```

## 1. The example definition

A **state definition** names and types the keys. On a fresh data directory (no definitions yet) the server creates one example, `scene`, in `data/state/definitions/scene.yaml`: `tension` (number 0 to 10, default 3), `mood` (calm, uneasy, tense, release), `lastInjectionLevel` (number) and `injected` (a list, at most 30 items, each with `level` and `entryId`).

You need its **id** to configure nodes (until 4b's pickers, you paste it):

```bash
curl -s $API/api/state-definitions | jq '.[] | {id, name, keys: (.keys | keys)}'
SCENE=$(curl -s $API/api/state-definitions | jq -r '.[] | select(.name=="scene").id')
```

Make your own (names are letters, digits and `_`, usable as `{{state.<name>.<key>}}`):

```bash
curl -s -X POST $API/api/state-definitions -H 'content-type: application/json' -d '{
  "name": "mystory",
  "keys": {
    "danger": { "type": "number", "min": 0, "max": 5 },
    "weather": { "type": "enum", "options": ["clear", "rain", "storm"] },
    "met": { "type": "boolean" },
    "clues": { "type": "collection", "cap": 10, "fields": { "level": "number" } }
  }
}' | jq .
```

You can also write the YAML file by hand while the app runs; it is picked up at once. A broken file is skipped and left untouched. Key types: `number` (`min`, `max`, `default`), `boolean`, `enum` (`options`, `default`), `text`, `object`, `collection` (`cap`, `fields`).

## 2. Wire the nodes (no LLM needed)

In a workflow, palette category **State**: **State Write** and **State Read**. State Write is a *sink* like Chat Output: it runs every turn even though no reply depends on it. Its settings are the definition id (paste `$SCENE`), the key, the operation (the choices depend on the key's type) and an optional fixed **Value**.

Every recipe below also needs Chat Input → Chat Output (the output's template is where you see the result).

**A turn counter.** Chat Output template: `tension={{state.scene.tension}} turn={{trigger.turn}}`. Add a State Write (definition `scene`, key `tension`, op `increment`, leave Value empty: it adds 1 per turn, and nothing needs to be connected). Send several messages:

```
tension=3 turn=1
tension=4 turn=2
tension=5 turn=3
```

A turn shows the state **as it started**. What a turn writes is visible from the next one (never within the same turn). Numbers stop at the key's max (10) and keep reading 10.

**A write gated by a branch.** Add a Condition (left `{{trigger.message}}`, operator `contains`, right `storm`), connect Chat Input `message` → Condition `value`. Add a State Write (key `mood`, op `set`, Value `tense`) and connect Condition `true` → its **Run when** input. Add `mood={{state.scene.mood}}` to the output template. The mood stays `calm` until you send a message containing "storm", then it reads `tense` from the next turn on. A turn that doesn't take the branch writes nothing.

**A collection.** State Write on `injected` with op `add`, Value `a storm` (text becomes an item), also gated by the same Condition if you like. In the template: `{{#each state.scene.injected}}{{text}}; {{/each}}`. Newest first.

**State Read.** Add a State Read (key `tension`, read `value`) and connect its `value` to a second Chat Output (`read={{input.value}}`). Switch it to `meta` for `written`, `turnsSinceWrite`, `writtenAtTurn` (and `count` for lists).

**Draw without repeats.** Make a collection (the Collections list in the right column) with 3 entries, add a Draw on it with **Avoid recent draws** = 2, and send its `text` and `reason` to two Chat Outputs. The reply cycles through all three entries and the reason says `(2 recent excluded)` once it has to skip some. No definition is needed: Draw keeps its own memory in the chat's state. Delete the last reply and that draw is forgotten.

## 3. Look at a chat's state

```bash
SESSION=<chat id>     # from the URL ?session=… or GET /api/sessions
curl -s $API/api/sessions/$SESSION/state | jq '{turn, scene: .definitions[0] | {values, warnings}, nodes, turns: [.turns[] | {turnNumber, replies, completed}]}'
```

- `turn`: the number the next message will get.
- `definitions[]`: per definition `values`, `meta` (`written`, `turnsSinceWrite`, `writtenAtTurn`, `count`), `history` (the value after each turn that wrote it) and `warnings`.
- `nodes[]`: implicit state of nodes such as Draw (`draws`), with the node's name.
- `turns[]`: every settled turn with its writes. `turnNumber: null` means the turn no longer counts (its replies were deleted).

## 4. Rewind: delete a reply

In the chat, use the **Delete message** button on a reply.

- Delete the **last reply**: the state goes back to what it was before that turn, and the next message gets that turn's number again (it runs from the older values).
- A turn with **two replies** (two Chat Outputs) counts until the last of them is deleted.
- Delete a **middle reply**: later turns keep what they stored; the state just stops including the deleted turn's writes, and later turns renumber.
- Delete only your **message**: nothing changes.
- **Editing** a message only marks it `editedAt`; the state is never recomputed from an edit. Neither edit nor delete re-runs the workflow.

A turn that fails after a reply was saved still counts, and keeps the writes of the nodes that finished. A turn that failed before any reply doesn't count.

## 5. Renaming and deleting definitions

```bash
# 409 STATE_DEFINITION_IN_USE while a chat still holds writes under "scene"
curl -s -X PUT $API/api/state-definitions/$SCENE -H 'content-type: application/json' \
  -d "$(curl -s $API/api/state-definitions/$SCENE | jq '.name="scene2"')" | jq .error.message
curl -s -X DELETE $API/api/state-definitions/$SCENE | jq .error.message   # names the chats and workflows
```

The refusal names the chats (and, for a delete, the workflows) involved. Templates use the name, so it can't change under live data: duplicate the definition to use another name. A chat whose replies were all deleted holds no live data and doesn't block. A second definition named `SCENE` is refused (`STATE_DEFINITION_NAME_TAKEN`; names compare ignoring case).

**Changing keys is always allowed.** Lower `tension`'s max to 8 while a chat holds 10: that chat reads the default (3) and shows a warning (also in the turn's execution warnings). Nothing stored is rewritten, so putting the max back to 10 brings 10 back. Removing a key a State node points at makes that workflow invalid, with a plain message naming the node, until you pick another key.

## Good to know (limits of this phase)

- **No UI yet** for definitions, the chat's state or per-message chips: all that is 4b. Until then you paste the definition id and type the key and op by hand.
- **The fixed Value box in the editor is text only.** Fine for enum, text and list-of-text writes (`tense`, `a storm`), and `increment` with the box empty adds 1. A *number* (`increment` by 2, `set` to 7) or an object item (`{"text": "a storm", "level": 2}`) can't be typed there: the node fails with `scene.tension needs a number, got text`. Set those through the API (the JSON keeps its type), or connect a number from another node. Careful: typing in the box and clearing it again stores an empty text, which makes an `increment` fail the same way, so leave it untouched for "add 1". 4b's panel offers a typed editor.
- Each State Write logs a line in the turn's execution details (`scene.tension: 3 -> 4`).
- Old chats (from before this feature) keep working: their earlier turns simply don't count, and state starts from the first new turn.
