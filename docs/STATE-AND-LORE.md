# Story state, lore and summaries — user guide

A plain chat model forgets, repeats itself and answers in the same register all the time. This guide covers the
parts of the app that help with that, and how they fit together:

- **Chat settings:** knobs you turn per chat (how restless the story is, how strong an injection may be).
- **Collections:** lists of short texts you write: lore a character must know, or a deck of small details a scene could use.
- **Story state:** what a chat remembers between turns (a tension number, a mood, a list of notes, what a deck just drew).
  It lives exactly as long as the replies that stored it.
- **Workflows after the reply:** workflows listed below the one that replies, which run once the reply is on screen, such as writing a summary.
- **Message links and summaries:** a summary is a remembered text that knows which messages it stands for.
- **The Trigger:** decides *whether* to inject something this turn and *how strongly*.
- **Three ready-made examples** that put all of it together: "Fresh texture (example)", "Rolling summaries (example)"
  and "Scenarist (example)".

You don't need to read it in order. If you want to see it work first, start with [Try the examples](#try-the-examples).

- [Try the examples](#try-the-examples)
- [Chat settings](#chat-settings)
- [Collections: Recall and Draw](#collections-recall-and-draw)
- [Story state](#story-state) (including [thread keys](#thread-keys))
- [Workflows after the reply](#workflows-after-the-reply)
- [Message links and summaries](#message-links-and-summaries)
- [The Trigger](#the-trigger)
- [Example 1: Fresh texture](#example-1-fresh-texture)
- [Example 2: Rolling summaries](#example-2-rolling-summaries)
- [Example 3: A scenarist with tools](#example-3-a-scenarist-with-tools)
- [Seeing what happened](#seeing-what-happened)
- [Known limitations](#known-limitations)

Related guides: [docs/COLLECTIONS.md](COLLECTIONS.md) (the file format, Recall and Draw in detail),
[docs/TEMPLATING.md](TEMPLATING.md) (template syntax, `{{state.*}}`, `{{settings.*}}`, the `linked` helper) and
[docs/PROVIDERS.md](PROVIDERS.md) (the LLM behind the examples).

## Try the examples

Three examples are added to your data the first time the server starts after an upgrade, whether or not you
already have workflows of your own:

- **Fresh texture (example):** now and then a small detail from a deck of forest textures is put into the prompt,
  worded as an offer. The story gets variety without you writing it.
- **Rolling summaries (example):** older messages are condensed into summaries, so a long chat keeps its memory
  without sending every message every time.
- **Scenarist (example):** after each reply, a second model steers the plot (tension, story beat, open threads)
  through tools, and the narrator reads its decisions from story state.

Each example comes with the records it needs: a collection, state definitions and presets. They are named
"... (example)" and each record is created once:

- **A deleted example stays deleted.** The server remembers what it has seeded in the file `data/.seeded.json`, so a
  restart does not bring a deleted record back. **To get deleted examples back**, stop the server, delete
  `data/.seeded.json` and start it again: every record that is missing is created again, and nothing that exists is
  touched (an example you edited is never overwritten). That also brings back every other example you deleted. To
  bring back just one, edit the file instead: its lines look like `fresh-texture/workflow:<id>` or
  `rolling-summaries/preset:<id>`, so remove every line that starts with that example's name (the whole example, not
  just the line of one record). An example with some of its records still deleted and still listed in the file is left
  out, and the server log says "a record it uses was deleted after it was first seeded".
- **An edited example is never overwritten.** Duplicate an example before changing it if you want to keep a clean copy.
- **Your own `scene` or `memory` definition wins.** State definition names are unique. If you already have a definition
  with the same name, it is used when it has the keys the example needs, with the same types and, for a list key, the
  same item fields; otherwise the example is left out and the server log says why. Nothing of an example is created in
  that case. Fresh texture needs `scene` with `lastInjectionLevel` (a number) and `injected` (a list with the item
  fields `level:number` and `entryId:text`); Rolling summaries needs `memory` with `summaries` (a list). A list that
  has a **Cap** is accepted but the oldest summaries are dropped by it (the server log hints at this).

**Before sending a message** the examples need an LLM. Their LLM nodes use the built-in OpenRouter provider and the
model `openai/gpt-4o-mini`. Either save an OpenRouter key under **Settings** (secret name `openrouter`), or open the
example in the workflow editor, click each **LLM** node, pick your own provider and model, and **Save** (see
[docs/PROVIDERS.md](PROVIDERS.md)). Rolling summaries has two LLM nodes: the one that answers and the one that
summarizes.

Then start a new chat (**+ New** in the chat list), open the chat panel (sliders icon in the chat header) and, under
**On reply**, add the example's workflows and remove the others. The walkthroughs below say which:
[Fresh texture](#example-1-fresh-texture), [Rolling summaries](#example-2-rolling-summaries),
[Scenarist](#example-3-a-scenarist-with-tools).

## Chat settings

Chat settings are knobs a workflow declares and each chat sets: a dial, a toggle, a choice, a note. They belong to
you. A turn only reads them, and editing, deleting or regenerating messages never changes them. A new value applies
from the next turn, and changing one is not a turn: it adds no message and does not move the chat up the list.

**Declare them on a workflow.** Open it in the editor and click **Chat settings** (sliders icon) in the toolbar. Add
one row per knob:

- **Key:** the name templates and nodes use, letters, digits and `_`, not starting with a digit (`volatility`).
- **Type:** number (with Min, Max and Step), boolean, enum (options one per line) or text.
- **Label, Default and Description.** Problems show inline (a duplicate key, min above max, an enum default that is
  not an option) and the toolbar button counts them.

**Use them.** In any template: `{{settings.mood}}`, `{{#if settings.flag}}...{{/if}}`. As wires: the **Chat
Settings** node (category Chat) has a `Settings` output with every value, and a `Value` output for the one named by
its **Key**. The value is absent when the key is empty or not declared, so whatever it feeds is skipped.

**Set them per chat.** In the chat header, click the sliders icon (**Chat panel**). The **Settings** section has a
control per setting: a slider plus a number box, a checkbox, a dropdown, or a text box. Checkboxes and dropdowns save
at once, typed values after a short pause. The reset arrow (only shown when you stored a value) goes back to the
default.

A setting you never changed follows the workflow's default, so changing the default in the workflow reaches every chat
that hasn't set its own value. If a stored value stops fitting (you lowered the workflow's max below it), the chat uses
the default and the panel says why ("Stored value 0.8 is above max 0.5; using default 0.3"). The stored value is
kept, never rewritten, and so are the values of settings a workflow no longer declares: switch the chat back to it and
they return.

## Collections: Recall and Draw

A **collection** is a list of short texts you write. Workflows only read collections; nothing in a turn changes one.
Two nodes (category **Lore**) read them:

| | Recall (lorebook) | Draw (deck) |
| --- | --- | --- |
| Chooses an entry when | its **keywords** appear in the recent chat | a weighted random pick among entries that pass the filters |
| Good for | consistency: what the model must know | freshness: what the model would not think of |

**Write one.** Click the **Collections** icon (a row of books) in the right column header, then **+ New**. Give it a
name, then **+ Add entry** for each entry: **Text**, an optional **Title**, **Keywords** (for Recall), **Tags** and a
**Level** from 1 to 5 (for Draw), **Weight** (2 is twice as likely, 0 is never drawn) and **Enabled**. **Save**. The
file is `data/collections/<name>.yaml` and you can edit it by hand while the app runs; a broken file is skipped and
left untouched, with a warning in the list. Full format: [docs/COLLECTIONS.md](COLLECTIONS.md).

**Recall** adds the entries whose keywords appear in the last few messages (default 4), the message just sent, and an
optional `text` input. Matching ignores case and, by default, only matches whole words. Its `text` output goes to a
preset input such as `lore`, used by an entry like `{{#if input.lore}}World notes:\n{{input.lore}}{{/if}}`. On a turn
with no match the entry renders empty and is dropped.

**Draw** picks `Count` entries (default 1) at random. Filters: Require tags, Any of tags, Exclude tags, Min level and
Max level (once a level filter is set, entries without a level are left out). A connected `maxLevel` input replaces
the Max level setting. It outputs `entry`, `text`, `level`, `entries` and `reason` (`drew 1 of 14 eligible (tags:
forest; level ≤ 2)`). When nothing is eligible, `entry`, `text` and `level` are absent: a node that needs them is
skipped, an LLM node still runs without them.

**Avoid recent draws** (a number of turns, 0 = off) makes Draw remember what it drew, per chat and per Draw node, and
leave those entries out for that many turns. The memory is story state: deleting a reply makes the chat forget what
that turn drew. An entry is recognized by its text, so moving it changes nothing while editing its text makes it a
new entry.

## Story state

**Story state** is what a chat remembers between turns. Workflow nodes write it, later turns read it, and it lives
exactly as long as the replies of the turns that wrote it. **Delete a reply and what its turn stored is undone.**

### Definitions

A **state definition** gives the keys a name and a type. Open the **State definitions** list (the icon between
Providers and Settings in the left column header; on a phone **Open menu**, **Setup**) and click **+ New**.

- **Name:** letters, digits and `_`, not starting with a digit. Templates read it as `{{state.<name>.<key>}}`.
- **Keys:** **+ Add key**, then a name and a type: **number** (Default, Min, Max), **boolean**, **enum** (options one
  per line), **text**, **object** (a JSON object) or **collection** (a list; an optional **Cap** keeps only the newest
  items, and **Item fields** declares extra fields per item as `name:type`; `id` and `text` always exist) or
  **thread** (a list of whole LLM exchanges; an optional **Cap**, see [Thread keys](#thread-keys)).
- Problems show as you type and **Save** stays disabled until the form is valid.

On a fresh data directory (or through the examples) you get `scene`: `tension` (0 to 10, default 3), `mood` (calm,
uneasy, tense, release), `lastInjectionLevel` (a number) and `injected` (a list, at most 30 items). The Rolling
summaries example adds `memory` with one list key, `summaries`, with no cap.

**The name is locked while chats hold data under it.** Templates and stored state use the name, so a rename or delete
is refused while a chat whose replies still exist stored something under it (the banner names the chats and offers
**Duplicate as...** or **Keep the current name**). Changing keys is always allowed: a stored value that no longer fits
the definition (you lowered a max) reads as the default with a warning in the chat panel, and nothing stored is
rewritten, so putting the limit back brings the value back. Renaming a key does not move what chats stored under the
old name.

### Writing and reading

Category **State** has two nodes.

**State Write** stores something. Pick the definition and key (the pickers show each key with its type), then an
operation the key allows:

| Key | Operations |
| --- | --- |
| number | set to a value, add to the number (the **Amount**, blank adds 1; the result stays between min and max), reset to the default |
| boolean, enum, text, object | set to a value, reset |
| collection | add an item (text, or an object with a `text` field and the declared item fields), remove an item by id, empty the list |
| thread | add an exchange (from an LLM node's **Exchange** output), remove one by id, empty the thread |

An LLM node's write tools can do a little more: edit a text in place (replace a passage, append a line) and update an
item's text or field values. See **Tools** under [the LLM node](WORKFLOWS.md#llm).

The panel shows one control that fits the key and operation, and what you type keeps its real type. A value connected
to the node's input always wins over the typed one. State Write runs every turn, even when no reply depends on it,
unless you gate it: connect a Condition branch (or a Random chance output) to its **Run when** input and it writes only
on that branch.

**State Read** reads a key into a wire: its value, or when it was written (`written`, `turnsSinceWrite`,
`writtenAtTurn`, `count` for lists). Lists can also be read as linked items in chat order (see below).

Templates read state without any node: `{{state.scene.tension}}`, `{{#each state.scene.injected}}{{text}}{{/each}}`,
and the turn number `{{trigger.turn}}`. The editor lists the available names under **Variables (click to insert)**.
See [docs/TEMPLATING.md](TEMPLATING.md).

**A turn reads the state as it started.** What a turn writes is visible from the next turn on, never inside the same
turn. To use a value in the same turn, connect the State Write node's output where you need it.

### Thread keys

A **thread** key remembers what an LLM node did, tool calls included. Its items are **exchanges**: everything one LLM
node run produced (each step's assistant message, the results of its tool calls, and the final answer). Connect the
LLM node's **Exchange** output to the **Exchange** input of a State Write on a thread key and pick **Add**. Optional:

- **Input** (State Write): what the exchange answers, stored with it. Text is kept as a user message; a message is
  kept with its role, content and name.
- **Keep reasoning** (State Write setting, off by default): by default the stored exchange leaves out the model's
  reasoning and the provider data a backend needs to continue a reasoning chain. Prior-turn reasoning is rarely needed
  and can be large. The run's execution log keeps everything either way. The tool calls and results always stay.

An item has `text` (the exchange's final answer), the `exchange`, the optional `input`, and the `turnId` and `runId` of
the turn and run that wrote it (the app stamps them). `{{#each state.<definition>.<key>}}{{text}}{{/each}}` lists the
answers, newest first, like any list; State Read reads the items and their count.

**Reading a thread back.** Use a **Thread** node (category History) to hand the stored exchanges to a model: pick the
definition and the thread key, and connect its **Messages** output to a messages input of an LLM node's preset (a
history slot). Without a history connected it gives the thread on its own, oldest first, each exchange after its
question (**With inputs**, on by default). Connect the chat's **History** (Chat Input's) to weave the exchanges into the
chat instead: each exchange's tool calls and results land right before the reply they led to, and the final answer is
not repeated, since the chat already shows it (an edited reply stays as edited). Exchanges whose answer is not in the
chat (a templated reply, a run that did not reply) come after the last message of their turn. **Last N** keeps only the
newest N exchanges. The model should have the same tools declared in the LLM node, or the preset turns tool calls it
cannot call into plain text.

A thread follows the same rules as all story state: delete the reply of the turn that wrote an exchange and it goes;
regenerate and swipes, forks and workflows after the reply behave like for any item. **Cap** keeps the newest
exchanges when read.

Not everything fits a thread, on purpose: the LLM node's state tools never offer thread keys (a model does not write
exchanges by hand), and the Story state section and the state view show an exchange only as its answer with a count of
steps and tool calls. The whole exchange is in the run's execution log.

Exchanges are stored inline in the chat for now, so a long chat with many tool calls makes a large chat file. Keeping
only a reference is planned.

### The rewind rule

A turn counts for the story state while at least one of its replies exists. So:

- **Delete the last reply** and the state goes back to what it was before that turn. The next message gets that turn's
  number again and runs from the older values.
- **Delete a middle reply** and later turns keep what they stored; the state stops including the deleted turn's
  writes, and later turns renumber.
- A turn with **two replies** (two Chat Outputs) counts until the last of them is deleted.
- **Deleting only your own message, or editing any message, changes nothing.** Neither re-runs the workflow, and an
  edit never recomputes state.
- A turn that failed after a reply was saved still counts and keeps the writes of the nodes that finished. A turn that
  failed before any reply does not count.

When deleting a reply would change the state, the app asks first and lists what goes back ("`scene.tension` (back to
9)", "`scene.injected` (forgets 'a bell...')"). Values that would not change are left out of the list.

Chats from before this feature keep working: state starts from their first new turn.

## Workflows after the reply

Some work should not delay the answer or put it at risk: writing a summary, noting what just happened. Make it its own
workflow, with **no Chat Output** (a **State Write** is enough: a workflow needs at least one node that writes
something), and list it **below** the workflow that replies in the chat panel's **On reply** section. It then runs as
soon as the reply is saved:

- the reply reaches the screen first, complete, exactly as before;
- the workflow then does its work and stores its results in the same turn's story state, so deleting the reply
  undoes them too;
- if it fails, the reply and the turn are untouched. You get a message that the workflow failed after the reply;
- you can switch it off for a chat without touching the others.

The list is split at the **last workflow that has a Chat Output**: it and everything above it run while the reply is
written, in order; the enabled workflows below it run after the reply. A workflow without a Chat Output that sits
*above* the replying one just runs first, and the reply sees what it wrote. If no workflow in the list has a Chat
Output, the message completes at once with no reply and every workflow runs afterwards.

**Chat Input** has two outputs for this: `Replies` (the replies the workflows above saved in this turn, in chat order;
empty for the first workflow) and `Turn` (the turn's number). Its `History` is the chat as it stands, so for a workflow
that runs after the reply it ends with the turn's own user message and replies.

What you see: a quiet row above the composer, **Running Memory after the reply... (turn N)** (the workflow's name),
with a stop button (the composer stays usable); a failure toast once; and on the turn's chip each run's own log.
Sending a message while a workflow runs is allowed, the message waits behind it ("Waiting for the workflows after the
reply to finish") and the composer's button becomes **Cancel queued message**. Stopping keeps what finished nodes
wrote, and the workflows below the stopped one do not run.

Every workflow, in the reply or after it, sees what the ones above it wrote in this turn (`{{state.*}}`), and
`{{trigger.turn}}` is the turn's number in all of them.

## Message links and summaries

Any item of a collection key can **link to chat messages**. A summary is just an item whose link names the messages it
covers; there is no separate summary feature. Four pieces make it work:

- **Memory** (Chat) has a checkbox **All**: send the whole history (**Last N** is ignored).
- **Next Chunk** (category History): pick a definition and a list key. It finds the next stretch of messages that no
  intact item of the key covers and outputs them (`Messages`, `Text`) plus a `Link` for State Write. Config:
  **Chunk Size** (default 20, counted from the start of the chat) and **Raw Window** (default 16: the newest messages
  are never planned, so they stay raw). When there is nothing to do, every output is empty and everything wired after
  it is skipped.
- **State Write** `add` on a list key has an optional **Link to messages** input: connect Next Chunk's `Link`. The
  item is stored with the link when the run settles.
- **Unlinked Messages** (History): the input messages without the ones intact items of the key stand for. The `linked`
  template helper, `{{#each (linked state.memory.summaries)}}{{text}}{{/each}}`, lists the intact items in chat order.

An item is **intact** while every message it links is still in the chat and unchanged. Edit or delete one of them and
the item is no longer used until it is redone (Next Chunk plans it again over the surviving messages on the next
turn, and the new item replaces the old). The status is computed when read and never stored.

A linked item lives and dies with the turn that wrote it, like all state: delete or regenerate that turn and the item
goes, and the next turn summarizes the chunk again (one extra LLM call).

**In the chat.** In the **Story state** section of the chat panel, each linked item shows as a card: `messages 1–20
(20)`, a badge (**intact**, **covers an edited message**, **some messages deleted**, **all messages deleted**) and the
text collapsed to one line. Click the range and the thread scrolls to the first linked message. Broken items an intact
one replaced, and repeats, fold under **Replaced or repeated**. In the thread, a link icon next to the speaker name
marks every message that state items link to; click it for the list, each with **Show in Story state**. Editing or
deleting such a message first shows a note ("1 item of memory.summaries links to this message ... Changing this
message stops it being used until it is made again.").

## The Trigger

The **Trigger** node (category Creativity) decides **whether** to inject something this turn and **how strongly**.
Draw or Recall decide *what*, and the preset decides the *wording*. Keeping the three apart is the point: you can
swap the deck, change the wording, or gate something else with the same Trigger.

**The score.** Every turn it computes a chance:

```
score = clamp01( (baseChance + growthPerTurn × turnsSinceLastFiring + sum of weight × signal) × (0.5 + volatility) )
```

`clamp01` just keeps the result between 0 and 1, and `sum of weight × signal` adds up every signal you connected
(more below). The chance grows the longer it has been quiet (`turnsSinceLastFiring` counts any firing; before the first one it is
the turn number), and `volatility` scales it between half (0) and one and a half times (1). It then rolls once from
the turn's seed. It **fires** when the roll is below the score and at least one level is available. A second draw
picks the level, only when it fires. With the defaults (and Max level 2) a firing comes about every four or five turns
on average at volatility 0.3 and about every three at volatility 1.

**Levels.** There are five, 1 (a passing detail) to 5 (something big). A level is **available** when it is at most
`maxLevel`, off **cooldown**, and has a weight above 0. Its cooldown is the minimum number of turns between two
firings *at that level*. The level is a weighted pick among the available ones. If every level is on cooldown it does
not fire, whatever the roll.

| Setting | Default | Meaning |
| --- | --- | --- |
| Base chance | 0.1 | The starting chance each turn, before growth and signals (0 to 1). |
| Growth per turn | 0.05 | Added for each turn since the last firing. |
| Volatility | 0.3 | Scales the score by 0.5 + volatility. A connected **Volatility** input overrides it. |
| Max level | 2 | Highest level that can fire. A connected **Max level** input overrides it. |
| Levels table | cooldowns 0, 2, 4, 8, 15; weights 5, 3, 2, 1, 0.5 | Per level: cooldown in turns and relative weight (0 = never picked). |
| Signals | none | Named extra inputs, below. |

**Signals** are extra inputs for things you can measure, for example a classifier's "the scene is stuck" score from 0
to 1. In the node's panel, **+ Add signal**, give it a name (a letter, then letters, digits or `_`; not `volatility`,
`maxLevel` or `value`; unique) and a weight. The name becomes an input of the node, and `weight × signal` is added
to the score. A negative weight lowers it. A signal that is not connected, or whose source was skipped (a branch that was
not taken), counts as 0 and never stops the Trigger from running. Renaming a signal renames its
port, which drops the connections to the old name.

**Outputs:** `Fire` (true or false), `Level` (only when it fired), `True` and `False` (branch outputs that pass the
optional `value` input through, like a Condition), `Score`, `Roll` and `Reason`, a sentence you can read in the
execution details:

```
score 0.3 = (0.1 + 0.05×2) × 1.5; roll 0.009 < 0.3; level 1 chosen (levels above max level 2 left out)
score 0.225 = (0.1 + 0.05×1) × 1.5; roll 0.872 ≥ 0.225: no firing
```

**Memory.** A firing is remembered as the Trigger's own node state (`fires`, one entry "fired at level 2" per firing),
which is how cooldowns and growth are computed. As with every story state, **deleting a reply undoes its firing**,
and with it the cooldown and the reset of the growth. The same seed gives the same outcome, so a run can be
reproduced from its log. The chat panel lists the firings under **Node memory**.

## Example 1: Fresh texture

**What it does.** On a turn where the Trigger fires, Draw picks a detail from "Forest textures (example)" (20 short
self-written entries at levels 1 to 3, such as a thread of woodsmoke, a carved spiral, a bell where no village should
be) and the preset puts it into the prompt as an offer:

- level 1: "Optional color, only if it fits the moment: ..."
- level 2: "If the story has room, let this touch the scene in a sentence or two: ..."
- level 3: "If it serves the story, you may bring this in as something the characters notice and react to: ..."

The wording follows the level of the entry that was drawn. On the other turns the prompt is exactly what the plain
assistant would send.

**The pieces.**

- Chat settings: `volatility` (0 to 1, default 0.3) and `maxLevel` (1 to 5, default 2). Turn them in the chat panel.
- The workflow, left to right: **Chat Input**; two **Chat Settings** nodes (one per key) feeding the **Trigger**'s
  `Volatility` and `Max level`; the Trigger's `Level` feeds **Draw**'s `maxLevel` input (Draw uses the collection,
  with **Avoid recent draws** = 10); Draw's `Text` and `Level` feed the **LLM**'s `seed` and `level` preset inputs;
  the LLM goes to **Chat Output**.
- Remembering: Draw's `Entry` goes through a **Pick Fields** node (it keeps `text, level, entryId`, the fields
  `scene.injected` declares) into a **State Write** that adds it to `scene.injected`, and Draw's `Level` goes into a
  second State Write that sets `scene.lastInjectionLevel`. Pick Fields (category Logic) keeps the listed fields of an object; you can
  use it anywhere an object has more fields than the place it goes to. A new one has no names yet, and **Validate**
  says so until you list some.
- The preset "Fresh texture narrator (example)" is the Default preset plus a depth entry that renders the wording
  above by level. Its inputs `seed` and `level` are plain optional text inputs.

**Why there is no Condition.** When the Trigger does not fire it outputs no `Level`. Draw's `maxLevel` input is
connected, so Draw is **skipped** (it is not run with a default). The two State Writes need Draw's outputs, so they
are skipped too. The LLM's `seed` and `level` inputs are optional, so the LLM still runs and answers, and the
preset's entry renders empty and disappears. A `level` reaches the preset as text, which is why the entry compares
`(eq input.level "1")`.

**Try it.**

1. Open the chat panel. Under **Settings** set **Volatility** to 1 to fire sooner.
2. Send a handful of messages. After a firing the reply has a small database icon, **What this turn stored**; open it:

   ```
   Turn 7 stored:
   - Trigger #1 (trigger): remembered 'fired at level 1' (fires)
   - Draw #1 (draw): drew 'A beetle with a green shell crosses the path...'
   - scene.lastInjectionLevel → 1
   - scene.injected + 'A beetle with a green shell crosses the path...' (level 1)
   ```

3. Under **Story state** in the panel: `scene` shows `lastInjectionLevel` and the `injected` items, and **Node memory**
   shows Draw's `draws` and the Trigger's `fires`.
4. Open **Execution details** on a reply: the Trigger's `Reason` tells why it did or did not fire, and the LLM's
   request shows the offer in the prompt on firing turns only.
5. **Delete the reply of a firing turn.** The dialog lists what goes back ("Trigger #1 (trigger) forgets 'fired at
   level 1'", "Draw #1 (draw) forgets ...", "scene.injected (forgets ...)"). Confirm and the injection, the firing, the
   cooldown and the draw memory are gone; the same entry can come up again.

**Make it yours.** Edit the collection (add entries with levels 1 to 3, tags and weights), change the wording in the
preset, raise `maxLevel` to allow bigger injections (Draw then draws among the entries up to the level the Trigger chose, so
add entries at levels 4 and 5 if you want the strongest ones to be special), add a signal to the Trigger, or
copy the whole thing and replace Draw with Recall.

## Example 2: Rolling summaries

**What it does.** Every 20 messages that are older than the newest 16 are condensed after the reply into a summary
linked to those messages. From then on the prompt carries the summaries plus only the messages no summary stands for,
so a long chat keeps its memory with a short prompt.

**The pieces.**

- The `memory` definition with one list key, `summaries`, **no cap**. A cap would drop the oldest summaries, and their
  messages would reach the prompt raw again.
- Presets: "Narrator with summaries (example)" (two inputs: `recent`, the messages no summary covers, and `message`, the user's message; an entry
  `{{#each (linked state.memory.summaries)}}...{{/each}}` that renders nothing until a summary exists, then a slot for
  `recent`) and "Summarize (example)" (one text input; an instruction to condense the excerpt into notes under 150
  words, keeping names, events, decisions, promises and open threads).
- The narrator workflow: **Memory** (format messages, **All** checked) goes to **Unlinked Messages** (`memory`, `summaries`),
  which goes to the LLM's `recent` input. So `recent` is the whole history minus the messages intact summaries stand
  for, and the summaries themselves come from the preset.
- The second workflow, **Summarize history (example)**, with no Chat Output, listed below the narrator: **Next Chunk**
  (`memory.summaries`, chunk 20, raw window 16) -> an **LLM** with "Summarize" -> **State Write** (`memory.summaries`,
  add). Next Chunk's `Text` is the LLM's input and its `Link` goes to the State Write's **Link to messages** input, so
  the stored summary knows its messages. Add both workflows to the chat's **On reply** list, narrator first.

**When the first summary appears.** A workflow running after the reply sees the chat as it stands, the turn's own
messages included. A chunk needs 20 messages older than the newest 16, so 36 messages must exist: the first summary is
written after the reply of **turn 18** (messages 1 to 20), and it is in the prompt from turn 19. After that, a new one follows each time 20 more messages have moved out of the raw window. Before the first
summary the example behaves like a plain assistant.

**Try it quickly.** Open **Next Chunk** in the editor and set **Chunk Size** `4` and **Raw Window** `2` (a short
chat then summarizes messages 1 to 4 after turn 3 and the next four after turn 5, and so on). Save. Use real values
(20 and 16) for real chats, and keep the raw window at least as large as what you want sent raw.

1. Chat for a few turns. After the first summary the chat panel's **Story state** shows `memory.summaries` with a card
   `messages 1–4 (4)`, badge **intact**, and the summary text. The messages carry the link icon.
2. **Edit** one of the linked messages. The card turns **covers an edited message**: it is no longer used, and the next
   prompt carries those messages raw again.
3. Send a message. After its reply the chunk is redone: a new summary replaces the old one (the old moves under
   **Replaced or repeated**).
4. **Delete the reply of the turn that wrote** a summary. The dialog lists it ("forgets 'Scene so far...' (linked to 4
   messages)"); the summary is gone, and the next turn summarizes the chunk again.

One caveat: summaries and raw messages are separate prompt inputs. When a summary in the middle is broken, its raw
messages appear after later summaries until the next turn redoes it.

## Example 3: A scenarist with tools

**What it does.** Two models share the work. The narrator writes the replies. After each reply, a **scenarist**
model reads the chat and steers the plot: it raises or lowers the tension, moves the story to its next beat, and opens
or closes plot threads, through [tools](WORKFLOWS.md#llm) that write story state. The narrator's preset reads those
values, so the scenarist's decisions reach the story without ever appearing in the chat.

**The pieces.**

- The `plot` definition: `tension` (0 to 10), `beat` (setup, rising, twist, crisis, climax, aftermath), `threads`
  (a list of open plot threads, at most 10) and `notes` (a [thread key](#thread-keys), at most 20). Each key has a
  description the scenarist sees in its tool list.
- The narrator workflow, **Narrator with a scenarist (example)**: Chat Input → LLM → Chat Output. Its preset is the
  Default preset plus a system entry that reads `{{state.plot.beat}}`, `{{state.plot.tension}}` and the open
  `{{state.plot.threads}}`.
- The **Scenarist (example)** workflow, with no Chat Output, listed **below** the narrator so it runs after the reply:
  Chat Input → **Thread** (`plot.notes`, woven into Chat Input's history) → **LLM** with the Scenarist preset (it may
  read and write `tension`, `beat` and `threads`, at most 6 steps) → **State Write** that adds the LLM's
  `Exchange` to `plot.notes`.
- The thread is the scenarist's memory: the next turn's Thread node puts its earlier tool calls and their results back
  into the chat, after the reply they belong to, so it remembers what it already changed. The model never writes the
  thread itself; the State Write does.

**Try it.** In a new chat, list **Narrator with a scenarist (example)** first and **Scenarist (example)** below it
under **On reply**, then send a message. The scenarist's run shows as a quiet row above the composer; afterwards the
turn's chip lists what it stored, and its log shows every tool call. The chat panel's **Story state** shows `plot`.
Delete the reply and `plot` reads as it did before that turn. Without the scenarist in the list, the narrator just
sees the default `plot` values.

## Seeing what happened

| Where | What it shows |
| --- | --- |
| **Chat panel > Settings** (sliders icon, **Chat panel**) | The current value of each chat setting, and issues such as a stored value that no longer fits. |
| **Chat panel > Story state** | Per definition: every key with its current value ("never written" when nobody wrote it), a sparkline for numbers, "written at turn k" links that scroll to that turn's reply, list items (linked ones as cards), warnings, **Node memory** (Draw's `draws`, the Trigger's `fires`) and, at the bottom, failed runs after the reply. It reloads when a turn settles or you delete or edit a message, never per streamed token. |
| **The chip under a reply** (database icon, **What this turn stored**) | The writes of that turn, including those of the workflows after the reply: `scene.tension → 6`, `scene.injected + 'text'`, `Draw #1 (draw): drew 'text'`, `Trigger #1 (trigger): remembered 'fired at level 2' (fires)`. A turn with several replies has it on its last reply. A warning icon means a workflow after the reply failed or an item was dropped. |
| **Execution details** (under a message) | The run's log: every node with its status, timing, outputs, logs and errors (State Write's `scene.tension: 3 -> 4`, the Trigger's `Reason`, Draw's reason), the settings the turn used and the seed. For an LLM node, the exact request that went over the wire. A turn with workflows after the reply has a log for each of them (**Run details**) behind its chip. |
| **Delete dialog** | What deleting a reply would undo, before you confirm. |

The pencil next to a definition's name in the Story state section opens that definition in the left column.

## Known limitations

- **You cannot choose a seed** or replay a turn with the same one. Each run's seed is recorded in its log (the
  Trigger's `Roll` and `Reason` show what it did with it).
- **The state definition name lock shows up when you save**, not before. Renaming a key does not move stored data.
- **There is no YAML view** in the definition editor. The files (`data/state/definitions/<name>.yaml`) can be edited by
  hand while the app runs.
- **The next message waits for the workflows after the reply.** A summary that takes a minute delays the next reply by a minute.
  A queued message gets no response until the run ends, so a proxy in front of the server with a short idle timeout
  could drop it.
- **Workflows after the reply are not retried.** A failed or interrupted run (a server restart) leaves that turn without its
  memory update; it is listed in the panel. For Rolling summaries the next turn plans the missing chunk again.
- **Summaries: the quality is the model's.** The example's "Summarize" preset is a starting point; edit its
  instruction to change what a summary keeps. Every chunk costs one extra LLM call, and so does redoing a broken one.
- **The Trigger has no built-in signals.** A signal is any number from 0 to 1 that you wire in; nothing in the app
  measures "the scene is stuck" for you.
- **Levels are 1 to 5 and cooldowns count turns,** not messages. A turn counts only while one of its replies exists.
- **A Draw entry has no stable id.** Nodes report `entry-<n>` (its position), so reordering changes it; avoid-recent
  recognizes entries by text.
- **A summary goes with the turn that wrote it.** Deleting or regenerating that reply removes the summary; the next
  turn writes it again (one extra LLM call).
- **Linked items can't be edited or discarded by hand** from the panel; a broken one is ignored and redone.
- **Template macros inside collection entries are not rendered**: an entry's text is used as written.
- **Very long text** written to a key is cut in the chip and the delete dialog (the state itself is complete).
- **The examples need an LLM key** (see [Try the examples](#try-the-examples)) and are written in English.
- **On a phone** everything is one column at a time: the chat panel covers the messages and the editors open
  under **Open menu**.
