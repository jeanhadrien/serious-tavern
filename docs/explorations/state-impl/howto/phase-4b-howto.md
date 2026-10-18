# Phase 4b: story state in the app, how to try it

**Story state** is what a chat remembers between turns: a tension number, a mood, a list of notes, what a deck just drew. Workflow nodes write it, later turns read it, and it lives exactly as long as the replies of the turns that wrote it: **delete a reply and what that turn stored is undone**. Phase 4a built the engine side; this phase adds the screens:

- an editor for **state definitions** (the named, typed keys),
- pickers on the **State Read** and **State Write** nodes (no more pasting ids) and a typed editor for State Write's fixed value,
- `{{state.…}}` suggestions in every template field,
- a **Story state** section in the chat panel,
- a small **"What this turn stored"** button on replies,
- a confirmation that lists what deleting a reply would undo.

Full reference: README, section "Story state". Template syntax: `docs/TEMPLATING.md`.

## 1. Where things are

- **State definitions:** the 4th icon in the left column's header (a brain-like icon, tooltip "State definitions", between Providers and Settings). On a phone: **Open menu**, then **Setup**, then **State definitions**.
- **A chat's story state:** in the chat header, the sliders icon **Chat panel** opens a side panel with two sections, **Settings** and **Story state**.
- **Per reply:** a small database icon, **What this turn stored**, under a reply (only when its turn stored something).

## 2. Make or edit a definition

On a fresh data directory you already have the example definition `scene` (`tension`, `mood`, `lastInjectionLevel`, `injected`). Open it to see how the editor looks, then make your own.

1. Open the State definitions list. Each row shows the name, the number of keys and the description. Click **+ New**: a definition called `new_state` (or `new_state2`… if that is taken) is created at once and opens in the editor, which replaces the list in the left column. The arrow button, **Back to state definitions**, returns to the list.
2. **Name:** letters, digits and `_`, not starting with a digit. Below it the editor shows how templates read it, `{{state.<name>.<key>}}`. **Description** is for you.
3. **Keys:** click **+ Add key**. Each key has a name, a **type** and the fields of that type:

   | Type | Fields |
   |---|---|
   | number | Default, Min, Max |
   | boolean | Default (Not set (false), true, false) |
   | enum | Options (one per line), Default (First option, or one of the options) |
   | text | Default |
   | object | Default (JSON object) |
   | collection | Cap (only this many of the newest items are kept when read), Item fields (one `name:type` per line, type is text, number or boolean; `id` and `text` always exist) |

   The **X** button removes a key.
4. Problems show right under the key or the name as you type, for example `max 5 must be at least min 9`, or `A state definition named "SCENE" already exists` (names compare ignoring case). **Save** stays disabled until something changed and nothing is wrong (its tooltip says which). The header shows **Unsaved** while the form differs from the saved definition.
5. Example to build: name `mystory`, keys `danger` (number, Min 0, Max 5), `clues` (collection, Cap 10, Item fields `level:number`), `weather` (enum, options `clear`, `rain`, `storm`). Click **Save**: "State definition saved".

Other buttons: **Duplicate…** asks "Name of the copy" and saves a copy of the saved definition (disabled while you have unsaved changes). **Delete** asks first, and is refused while a chat holds state under the definition or a State node uses it; the message names the chats and workflows.

### The rename rule

Templates and stored state use the definition's **name**, so it cannot change under live data. Try it: send a few messages in a chat that writes `scene` (section 3), open `scene`, change the name to `scene2` and click **Save**. Instead of saving, a banner appears:

> "scene" can't be renamed: story state under that name is stored in these chats: … Templates use the name; duplicate the definition to use another one.

It lists the chats (each is a link) and offers two buttons:

- **Duplicate as "scene2"**: the whole form, keys included, becomes a new definition named `scene2`. The old one is untouched.
- **Keep the current name**: the name goes back to `scene`.

The name field stays read-only ("This name is locked: chats store state under it.") until you open the definition again. The editor only learns about the lock by trying to save, so there is no warning up front. A chat whose replies were all deleted holds no live data and does not block a rename.

### Changing keys is always allowed

- **Renaming a key** does not move what chats stored under the old name: it is ignored, with a warning in the chat panel. Point State nodes at the new name. The editor says so above the key list.
- **Changing a limit** (say Max 10 to 8 while a chat holds 10): that chat reads the default and shows a warning. Nothing stored is rewritten, so putting the limit back brings the value back.
- **A State node whose key vanished** makes its workflow invalid, with a plain message naming the node.

The files are `data/state/definitions/<name>.yaml`. You can still edit them by hand while the app runs: the list and the editor update at once, and an editor with unsaved changes is never overwritten.

## 3. Wire the nodes, no LLM needed

A minimal workflow to see everything: **Chat Input → Chat Output**, plus a **State Write** that adds 2 to `scene.tension` every turn.

1. Workflows list (first icon), **+ New**, name it `Tension demo`. The editor opens with an empty canvas.
2. In the **Nodes** palette next to the canvas, click **Chat Input +**, **Chat Output +** and **State Write +** (category State). Each node lands in the middle of the canvas: drag them apart.
3. Connect Chat Input's **Message** dot to Chat Output's **Value** dot.
4. Click **Chat Output** and set its **Template** to

   ```
   tension={{state.scene.tension}} turn={{trigger.turn}}
   ```

   Under the field, **Variables (click to insert)** now lists `{{state}}`, `{{state.scene.tension}}` (number), `{{state.scene.mood}}` (text) and so on, built from your definitions, next to `{{trigger.turn}}`.
5. Click **State Write**. Its panel has:
   - **State definition**: pick `scene`. A link **Edit definition ↗** appears and opens it in the left column.
   - **Key**: `tension (number)` (the list shows each key with its type).
   - **Operation**: only what the key's type allows. For a number: Set to a value, **Add to the number**, Reset to the default. Pick **Add to the number**.
   - **Amount**: type `2`. (Blank adds 1; negative numbers subtract; the hint under it says the key stays between 0 and 10.)
   
   Until the definition and key are chosen the panel says what to pick next ("Select a state definition.", "Select a key."). Nothing needs to be connected to the node.
6. **Save**, then start a **New chat** (right column), and choose `Tension demo` in the workflow dropdown in the chat header (a new chat starts on "Default Assistant").
7. Send `go` four times. The replies are

   ```
   tension=3 turn=1
   tension=5 turn=2
   tension=7 turn=3
   tension=9 turn=4
   ```

   A turn shows the state **as it started**: what a turn writes is visible from the next turn on. The number stops at the key's max, so the chat now holds 10.

### The typed fixed value of State Write

State Write's panel shows one control that fits the key and the operation. Whatever you type is stored with its real type (a number stays a number):

| Key / operation | What you get |
|---|---|
| number, Set to a value | **Fixed value** (number) |
| number, Add to the number | **Amount** |
| boolean | **Fixed value**: No fixed value, true, false |
| enum | **Fixed value**: a list of the options |
| text | **Fixed value** (multi-line) |
| object | **Fixed value (JSON object)**; "Not a JSON object" when it does not parse |
| collection, Add an item | **Item text** plus one field per declared item field, such as `level (number)` |
| collection, Remove an item by id | **Item id** |
| Reset to the default / Empty the list | "This operation needs no value." |

Clearing a control removes the fixed value (it never stores an empty text). Changing the key or the operation drops it, because it was typed for something else. A problem, for example a value that is not an option, shows in red under the control. A value connected to the node's input (**Value**, **Amount**, **Item**, **Item id**) always wins over the fixed value.

### The Run when gate

Every State Write has an optional **Run when** input. Connect a Condition branch or a Random chance output to it and the node writes only on that branch. Not connected, it writes every turn. Try it on top of the recipe:

- Add a **Condition**: Left `{{trigger.message}}`, Operator `contains`, Right `storm`. Connect Chat Input **Message** to its **Value**.
- Add a **State Write** on `mood`: Operation Set to a value, Fixed value `tense`; connect Condition **True** to its **Run when**.
- Add another on `injected`: Operation **Add an item**, Item text `a storm`; same gate.
- Change the Chat Output template to `tension={{state.scene.tension}} mood={{state.scene.mood}} turn={{trigger.turn}}`.

Messages without "storm" leave the mood at `calm`. After one with "storm", the mood reads `tense` from the next turn on, and `injected` has one more `a storm`.

### State Read

Add a **State Read**: pick the definition and key, then **Read**: **Its value** (output **Value**: what the chat held when the turn started, or the key's default when never written) or **When it was written** (outputs **Written**, **Turns since write**, **Written at turn**, and **Count** for a list). Connect an output to another node, for example a second Chat Output with `{{input.value}}`.

A definition or key that no longer exists stays visible in the pickers as "Unknown definition (id)" or "Unknown key (name)", so nothing is silently replaced.

### Draw without repeats (optional)

Make a collection (Collections, right column header) with 3 entries, add a **Draw** on it with **Avoid recent draws** = 2, and send its **Text** to a second Chat Output (`Omen: {{input.value}}`). Draw keeps its own memory in the chat's state, which shows up in the panel under "Node memory".

## 4. See the state in the chat

Open the **Chat panel** (sliders icon in the chat header) and look at **Story state**. After the four `go` messages:

```
scene                                 [pencil: Edit state definition scene]
tension 10   ~~~ (sparkline)
written at turn 4
mood calm
never written
lastInjectionLevel 0
never written
injected  0 items
never written
```

- **One block per state definition** this chat has stored something under (or that has a warning), with every key of it. The pencil opens that definition in the left column. The other definitions are listed as "Not used in this chat yet: …".
- **Current value.** A key nobody wrote shows its default and "never written".
- **Sparkline** for number keys, drawn from the value after each turn that wrote it (it needs two points; a screen reader reads it as "tension over turns: 5, 7, 9, 10").
- **"written at turn k"** is a link: it scrolls the chat to that turn's last reply. (On a narrow chat, where the panel covers the messages, the panel closes after the jump.) A turn that ran no Chat Output has no reply, so it shows plain text.
- **Lists** (collections) show "N items", newest first, collapsed when there are more than five, and "N older items dropped by the cap" when the key's Cap cut some.
- **Warnings**, marked with a warning icon: a stored value that no longer fits the definition (the default is used instead), for example after you lowered a max.
- **Node memory (n)**, collapsed at the bottom: what nodes remember under their own keys, today Draw's recent draws (`Draw #1 (draw)`, `draws`, the entries newest first).
- **Empty chat:** "Nothing has been stored in this chat yet…" with an **Open state definitions** button.

It reloads once when a turn settles, after you delete or edit a message, and when the definitions change. It never reloads per streamed token. If a reload fails you see "Could not refresh; this is the last state that loaded."

## 5. The chip on replies

Under each reply whose turn stored something there is a small database button, **What this turn stored**. Click it: a card opens under the button, for example

```
Turn 4 stored:
• scene.tension → 10
```

and with the bigger workflow (gate and Draw), after "another storm":

```
Turn 4 stored:
• scene.tension → 10
• Draw #1 (draw): drew 'resin after rain'
• scene.injected + 'a storm'
• scene.mood → 'tense'
```

Escape or a second click closes the card. Wording: `scene.tension → 6` (the value the key ended on, not the amount added), `scene.injected + 'text' (level 2)`, `scene.injected: removed 'text'`, `scene.tension reset to its default`, `Draw #1 (draw): drew 'text'`. Long text is cut.

- A turn with **several replies** shows the chip on its **last** reply only.
- No chip for a turn that stored nothing, whose replies were deleted, or while the reply is still streaming.
- If you **edit** the reply afterwards, the card adds "Edited after it was stored: the values above came from the original text." Editing never changes the state.

## 6. Delete a reply and watch it rewind

In the recipe chat, hover the last reply (`tension=9 turn=4`) and click **Delete message**. Because this is the last surviving reply of a turn that stored something, you get a dialog instead of the small inline "Delete message?" step:

```
Deleting this reply also undoes what its turn stored:

- scene.tension (back to 9)

Delete the reply?
```

OK: the panel now reads `tension 9`, the sparkline is one point shorter, and the next message you send is turn 4 again (`tension=9 turn=4`).

With the bigger workflow, turn 4 has two replies, so:

1. Delete the second reply: the usual inline confirmation (another reply of the turn survives, so nothing is undone).
2. Delete the remaining reply: the dialog lists

   ```
   - scene.tension (back to 9)
   - Draw #1 (draw) forgets 'resin after rain'
   - scene.injected (forgets 'a storm')
   ```

   `scene.mood` is not listed: it would still read `tense` (turn 2 set it), and values that won't change are left out.

Deleting a middle reply keeps later turns' writes (they still count and renumber); deleting only your own message changes nothing. Neither deleting nor editing re-runs the workflow.

## Good to know

- **No YAML view** in the definitions editor; the files can be edited by hand (see section 2).
- **The name lock shows up when you save**, not before (section 2).
- Very long text or an object written to a key is cut in the chip and the dialog; for an object key the dialog says the key is "restored to its earlier value" or "may change" rather than printing it.
- A turn that failed before any reply doesn't count and has no chip. A turn that failed after a reply was saved still counts and keeps the writes of the nodes that finished.
- Old chats (from before story state) keep working: state starts from their first new turn.
- The sparkline needs at least two writes and only exists for number keys.
- A State node that is not set up yet (no definition or key chosen) does not toast an error; its panel says what to pick next. Browser dev tools may still show a `422` from the port lookup for it, which is expected.
- On a phone everything is one column at a time: the definitions editor is under **Open menu**, **Setup**, and the chat panel covers the messages.

