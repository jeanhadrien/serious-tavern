# Workflows and nodes — user guide

A **workflow** decides what happens when you send a message: which history is used, which prompt is built, which
model answers, what gets remembered. It is a graph of **nodes** connected by wires, edited in the workflow editor.
A chat runs one or more workflows on every message (its **On reply** list, see
[the chat panel](GETTING-STARTED.md#the-chat-panel)).

- [The editor](#the-editor)
- [How a workflow runs](#how-a-workflow-runs)
- [Ports and types](#ports-and-types)
- [Node reference](#node-reference)

## The editor

Open the **Workflows** list (left column) and pick a workflow, or **+ New**. The editor opens in the middle column,
with the chat moved to the right so you can test as you go.

- **Add a node:** drag it from the palette onto the canvas, or click it. The palette groups nodes by category; click a
  category's name to fold or unfold it (the browser remembers which). A category with a single node shows that node
  directly.
- **Connect:** drag from an output (right side of a node) to an input (left side). An input takes one wire; a new one
  replaces the old. Hover a port to see its type and description. A small red dot after an input's name means the
  node can't run without it. A connection that converts the data (a number into
  text) is dashed; one that can't work is refused, and a saved one that no longer fits is drawn red until you fix it.
- **Quick add:** double-click empty canvas, or press **/** while the editor has the keyboard (and you're not typing in
  a field), to get the same list with every node type. The node is added where you clicked, or where the pointer last
  was over the canvas (the middle of it if it never was), with no wire. Double-click no longer zooms; use the zoom
  buttons or the wheel.
- **Drop a wire on empty canvas** to get a short list of the nodes that can take it (type to filter, arrows and Enter
  to pick, Escape to close). The new node comes already connected.
- **Summary line:** under a node's name, a muted line says how it is set up: the model and preset of an LLM, the key and operation of a State node, a Condition's operator, the collections of Recall and Draw, and so on. It is cut when long (hover for the whole), and a node that isn't set up yet has none.
- **Configure:** select a node to open its settings panel. Fields that accept templates (`{{...}}`) list the available
  variables; see [templating](TEMPLATING.md).
- **Tidy:** the canvas's **Tidy** button lays all the nodes out left to right, following the wires, and fits the view.
  Nodes with no wire are stacked in the first column, under the wired ones. It is a single undo step, so Ctrl/Cmd+Z puts everything back.
- **Undo and redo:** **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z** (or **Ctrl/Cmd+Y**), or the toolbar buttons, up to 100
  steps: adding, removing, connecting, moving, tidying and configuring nodes (typing in one field counts as one step). Opening
  another workflow or reverting clears the history; saving doesn't.
- **Copy and paste:** **Ctrl/Cmd+C** copies the selected nodes and the wires between them; **Ctrl/Cmd+V** pastes them,
  also into another workflow or another browser tab. A second Chat Input is not pasted (a workflow has one).
- **Chat settings:** the toolbar's **Chat settings** button declares the knobs each chat can turn for this workflow.
  See [chat settings](STATE-AND-LORE.md#chat-settings).
- **Problems:** the editor checks the workflow as you edit (a moment after your last change) and marks what is wrong. A
  node with a problem gets a red count on its corner (hover for the messages), and every wire a problem names turns
  red. The toolbar's **Problems** button, with the count, lists them over the canvas: click one to select the node or
  wire and zoom to it. Problems about the whole workflow (a loop, no output) are listed but have nothing to click, and
  problems with the chat settings show in the **Chat settings** panel instead.
- **Live run:** while a message is being answered in the open chat, the nodes of the workflow that is running light up in
  the editor if that workflow is open: blue and pulsing while running, green when done, faded and dashed when skipped,
  red on an error and amber when cancelled. The marks clear a few seconds after the reply ends. Three limits: only the
  workflows that make the reply show it (the ones that run after the reply don't), only in the browser tab that sent the
  message, and the marks follow the node ids of the saved workflow that ran, so a node you added or removed since shows
  nothing.
- **Last run:** with a node selected, the settings panel ends with a collapsed **Last run** section: that node's inputs
  and output from the open chat's most recent run of this workflow (for a skipped node, why it was skipped). The
  inputs are rebuilt from the outputs of the nodes before it, so they are greyed, with a note, when you have unsaved
  edits or the workflow was saved after that run (an older run can't tell, and is always greyed). Long values are cut,
  with **Show all**.
- **Save** when you're done. A workflow with a problem (a required input not connected, a setting missing, a node
  pointing at a deleted preset) can still be saved. **Validate** in the toolbar checks right away, without saving, and opens the list of problems, and a chat that
  runs it gets a message naming the node, with a link that opens the workflow and highlights the wire.

A node type the app doesn't know (from a newer or older version) is kept as a read-only placeholder and saved
unchanged.

## How a workflow runs

- A workflow needs exactly one **Chat Input** and at least one node that writes something: a **Chat Output** (a
  reply), a **State Write**, or an **LLM** node with write tools.
- Only those nodes and what they depend on run; a node that nothing needs is skipped ("not needed by any output").
  Nodes that don't depend on each other run in parallel.
- Each **Chat Output** that runs adds one reply. Their order is fixed: an output comes before the ones that depend on
  it, then by the output's **Order** setting, never by which finished first.
- A **Condition** or **Random** chance node sends its value down one branch only: the nodes on the other branch are
  skipped, and so is a node whose inputs all come from skipped nodes. A node with a required input fed by a skipped
  node is skipped too.
- Each run has a random seed, shown in its log, and every random choice (Random, Draw, Trigger) comes from it.
- A run's full record is in the reply's **Execution details**.

## Ports and types

Every port has a type: `text`, `number`, `boolean`, `object`, `array`, `messages`, `character` or `any`.

| Output → input | Result |
| --- | --- |
| Same type, or `any` on either side | Passed unchanged |
| `number`, `boolean`, `object`, `array` → `text` | Converted to text (objects and arrays as JSON) |
| `messages` → `text` | Converted to a `role: content` transcript |
| `messages` → `array` | Passed unchanged |
| `character` → `object` | Passed unchanged |
| `character` → `text` | Refused |
| Any other pair, including `text` → `number` or `boolean` | Refused: text is never guessed into a value |

To turn text into a number, a boolean or JSON, use a **Parse JSON** node: the conversion is explicit, and it fails
with a clear message instead of guessing.

## Node reference

### Chat

**Chat Input.** Where every run starts; no inputs. Outputs:
- `Message`: the message you sent (empty for an empty send).
- `History`: the chat's earlier messages.
- `Replies`: what the workflows above this one in the chat's On reply list replied in this turn (empty for the first).
- `Turn`: the turn's number, the same as `{{trigger.turn}}`.

**Chat Output.** Adds one reply to the chat from its `Value` input. Settings:
- **Template:** empty posts the value as it is; otherwise the template is rendered and posted.
- **Name:** the speaker's name. A **Character** connected to the `Character` input wins over it; with neither the
  reply is from "Assistant". Choosing a character for the chat doesn't name replies by itself.
- **Order:** only breaks ties between outputs that don't depend on each other (smaller first).

Its `Reply` output carries the posted text, so one workflow can chain two speakers. Only a reply posted as it is
(no template, straight from an LLM) shows the model's reasoning.

**Memory.** The recent history: **Last N** messages (default 10; 0 = none), or **All** of it. **Format** gives a
`role: content` text or the messages themselves (for a preset's history slot). Use **All** in front of Unlinked
Messages (see [summaries](STATE-AND-LORE.md#message-links-and-summaries)).

**Character.** Outputs a character: the chat's character (default) or a specific card. Connect it to a Chat Output to
name the speaker, to an LLM to use that character in its prompt instead of the chat's, or both. When the chat has no
character, "the chat's character" fails with a message saying so.

**Chat Settings.** The chat's settings as this workflow declares them: `Settings` (all of them) and `Value` (the one
named by **Key**; absent, so whatever it feeds is skipped, when the key is empty or not declared). Templates read
the same values as `{{settings.<key>}}`. See [chat settings](STATE-AND-LORE.md#chat-settings).

### LLM

Sends a prompt to a model and outputs its answer.

- **Provider** and **Model:** which backend and model (see [LLM providers](PROVIDERS.md)). The model field suggests
  what the provider serves; you can type any id.
- **Preset:** builds the prompt (see [presets](PRESETS.md)). Each input the preset declares becomes an input of the
  node (`history`, `message`, ...). The history reaches the model only through a preset slot; it is never added
  silently.
- **Character** input: a card connected here replaces the chat's character for this node's prompt only.
- **Temperature** (default 0.7), **Max tokens** (default 1024), and the optional top-p, frequency and presence
  penalties and stop sequences.
- **Reasoning:** ask the model to reason first (effort, a token budget, or reason without returning it). The reasoning
  shows above the reply.
- **Streaming** (on by default): the reply appears as it is written. Off, it arrives in one piece.
- **Merge consecutive system messages** (off by default): joins system messages that follow each other and have no
  name, with blank lines, for models that want a single system message.

Outputs: `Text` (the answer), `Raw` (the backend's last response) and `Exchange` (every step's messages, tool calls
included, for a [thread key](STATE-AND-LORE.md#thread-keys)).

**Tools.** The **Tools** section lets the model read and change story state itself, in a loop, during its answer:

- **Readable keys:** state keys the model may read. **Writable keys:** keys it may change, and always read too, so it
  never changes a value it cannot see. Nothing is offered unless you list it. A key whose definition or key was
  deleted shows as unknown and is left out.
- A text key can also be edited in place: the model replaces one passage (it must appear exactly once) or appends a
  line, without rewriting the whole text. An item of a collection can be updated in place, its text and the values of
  its declared fields: it keeps its place in the list and its link to messages, so a corrected summary still points
  at what it summarizes. It cannot get a field the key doesn't declare.
- A write follows the same rules as a State Write node (bounds, enum options, declared fields), and counts only if the
  node finishes, like all story state. The model sees its own writes when it reads again; other nodes and templates see
  them from the next turn.
- **Step limit** (default 5): after that many rounds of tool calls, the model is asked for its answer without tools.
  **Tool choice:** let the model decide, or make it use a tool first. **Parallel tool calls:** backend default,
  allowed, or one at a time.
- **Replay reasoning:** whether earlier reasoning of the same model is sent back (never, since your last message, or
  always).
- An LLM node with writable keys counts as writing something: it runs even when no reply needs it.
- Every round's text streams, but only the last round's text is the reply. The log shows every call.

**Text Stats.** Measures a text, normally a reply before it is posted, with the same numbers as the optional
[text statistics](GETTING-STARTED.md#chatting) under replies (whatever that setting says). Input `Text` (connect a
single reply text, not a message list: messages become a `role: content` transcript and the role names get measured).
The optional `History` input holds the messages to compare against; without it the node uses the chat's history minus
this turn's own replies, so a node in a workflow after the reply doesn't compare the reply with itself. Only the last
five assistant replies count. Outputs: `Words`, `MTLD`, `Slop words`, `4-gram overlap` (0 to 1), `Recycled sentences`
and `Stats` (all of them as an object). A number that can't be measured (`MTLD` on a short text, the overlap with no
earlier reply) is absent, so what it feeds is skipped, except as a Trigger signal, where an absent signal counts as 0.

### Logic

**Condition.** Compares two texts and sends the `Value` input down `True` or `False` (the other branch is skipped).
**Left** (default `{{input.value}}`) and **Right** are templates; operators: equals, not equals, contains, does not
contain, matches a regular expression, is empty, is not empty, greater than, less than (the last two compare as
numbers). With nothing connected to `Value`, the branch carries the left text.

**Merge.** Joins branches: inputs A to D, only those that ran count. **Mode:** an object (`{ a, b, ... }`), a list,
or the first value that isn't empty.

**Random.** Draws once per run, from the run's seed. Every mode also outputs `Roll`, the raw draw between 0 and 1.

| Mode | Result |
| --- | --- |
| Number (default) | A number from Min up to (not including) Max; blank bounds mean 0 and 1. |
| Integer | A whole number from Min to Max, both included; blank bounds mean 1 and 6 (a die). |
| Pick | One item of the `Items` list. An object item with a number in its weight field (default `weight`; blank turns weights off) is weighted by it; anything else weighs 1, and 0 or less is never picked. When nothing can be picked, `Value` is absent and what it feeds is skipped. |
| Chance | True when the draw is below the probability (the `Probability` input, or the setting, default 0.5). Like a Condition, the `Value` input (or the result itself) goes out of `True` or `False`. A connected input whose source was skipped skips the whole node. |

**Parse JSON.** Reads one JSON value out of text, typically a model's answer. **Expect** (any, object, array, number,
boolean or text) is also the output's type. It tries the whole text, then the first code fence, then the first
complete `{...}` or `[...]` of the expected type. A number or boolean must be the whole answer (`7`, not `Rating: 7`).
A wrong type or no value fails the node with a plain message (`Expected a number, got an object`), and the node's log
shows the text it got.

**Pick Fields.** Keeps only the listed fields of an object (**Fields**, comma separated, in that order). Useful in
front of a State Write when an object has more fields than the key declares.

### Integration

**HTTP Request.** Calls a web address. **Method** (GET, POST, PUT, PATCH, DELETE), **URL**, **Headers** and **Body**
(not sent with GET) accept templates; **Response type** is JSON (default) or text; **Timeout** defaults to 15 seconds.
Outputs `Body`, `Status` and `Headers`. An error status fails the node.

### Lore, state, history and creativity

These are covered in their own guides:

| Node | Category | What it does | Guide |
| --- | --- | --- | --- |
| Recall | Lore | Entries of your collections whose keywords appear in the recent chat | [Collections](COLLECTIONS.md#recall) |
| Draw | Lore | A weighted random pick from your collections, with filters | [Collections](COLLECTIONS.md#draw) |
| State Read, State Write | State | Read and store what the chat remembers | [Story state](STATE-AND-LORE.md#writing-and-reading) |
| Next Chunk, Unlinked Messages | History | Find the messages no summary covers yet; leave out the ones summaries stand for | [Summaries](STATE-AND-LORE.md#message-links-and-summaries) |
| Thread | History | Give a model back its earlier exchanges, tool calls included | [Thread keys](STATE-AND-LORE.md#thread-keys) |
| Trigger | Creativity | Decide whether to inject something this turn, and how strongly | [The Trigger](STATE-AND-LORE.md#the-trigger) |
