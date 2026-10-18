# Phase 6b: message links, summaries as story state, how to try it

Phase 6b replaces phase 6's separate summary store. **Any collection item can link to chat messages**, and a summary is just an item of a collection key whose items link to the messages they cover. There is no summary-specific node: Next Chunk finds messages a key does not cover yet, Unlinked Messages drops the messages intact items already stand for, State Write stores the item with its link, and the `linked` template helper reads the intact items in chat order.

- a linked item is used only while **every message it links is still in the chat and unchanged** (it is **intact**); edit or delete one and the item stops being used until it is redone;
- a linked item is ordinary story state, so it **lives as long as the reply of the turn that wrote it**: deleting or regenerating that turn removes it, and the next turn's after-reply run summarizes the chunk again (one extra LLM call);
- the chat shows which messages state depends on, and warns before you edit or delete one. There is no re-summarize button: it heals by itself on the next turn.

Full reference: README, sections "Message links and summaries" and "Story state in the web"; contracts: AGENTS.md, "Message links". Design: `docs/explorations/STATE-DESIGN-AMENDMENT-1.md`. This supersedes `phase-6-howto.md`.

## 1. The pieces

| Piece | Where | What it does |
|---|---|---|
| **State definition** | State definitions list | A list (collection) key for the items, for example definition `memory`, key `summaries`. **Leave the cap empty**: a cap drops the oldest items, and the messages they stood for then reach the prompt raw again (the editor shows a neutral note under any cap that has a value; it cannot tell whether a Next Chunk node uses the key). |
| **Memory** | category Chat | New checkbox **All**: send the whole history (Last N is ignored while it is on, the panel says so; `0` still means none). |
| **Unlinked Messages** | category **History** | Input **Messages**. Pick a definition and a **list** key. Outputs **Messages** and **Text**: the input without the messages that *intact* items of the key link to. Broken items hide nothing. |
| **Next Chunk** | category **History** | Pick the same key. Outputs the next chunk of messages that no intact item covers (**Messages**, **Text**, **Link**) and, when it redoes a broken item, **Replaces** (that item's id). Config **Chunk Size** and **Raw Window** (the newest messages, never planned). Nothing to do: all outputs empty, so everything after it is skipped. |
| **State Write** | category State | Operation **Add an item** on a list key gets an optional input **Link to messages**: connect Next Chunk's **Link** (or a message, or After Reply's **Replies**). The item is stored with the link; the fingerprint is taken or checked when the run settles. |
| **State Read** | category State | New read **Linked items, in chat order** for list keys. |
| Template helper `linked` | presets and node templates | `{{#each (linked state.memory.summaries)}}{{text}}{{/each}}`: the intact linked items in chat order. |

## 2. The recipe ("Summaries, wired")

Goal: reply as usual; after each reply, summarize the next 4 old messages once there are enough, and feed the summaries and the not-yet-summarized messages back into the prompt.

1. **State definition** `memory` with one list key `summaries`, no cap.
2. **Presets.**
   - Your chat preset: add a message entry `{{#each (linked state.memory.summaries)}}Summary of earlier messages: {{text}}\n{{/each}}` (it renders empty, so the entry disappears, until a summary exists) and a history slot fed by the input you will connect in step 3 (for example `recent`).
   - A `Summarize` preset with a text input `transcript` and a system entry such as `Summarize this conversation excerpt in two short sentences, keep names and facts:\n{{input.transcript}}`.
3. **Workflow** (a copy of Default Assistant is a good start). Reply part: **Memory** (Format `messages`, **All** checked) to **Unlinked Messages** (`memory`, `summaries`) to the reply LLM's `recent` input. After-reply part:
   - **After Reply**; its **Turn** to **Next Chunk** (`memory`, `summaries`, **Chunk Size** `4`, **Raw Window** `2` for a short try; use something like 20 and 16 for real chats). Keep the raw window at least as big as the history you want sent raw.
   - a second **LLM** with the `Summarize` preset: Next Chunk **Text** to its `transcript` input.
   - **State Write** (`memory`, `summaries`, operation **Add an item**): the LLM's **Text** to **Item**, Next Chunk's **Link** to **Link to messages**.
4. **Save**, **Validate**, start a **New chat** on it and send messages.

With chunk size 4 and raw window 2, the first summary (messages 1-4) appears after the reply of turn 4, the next after turn 6, and so on. The prompt then carries the intact summaries in chat order, followed by every message no intact summary stands for (the raw window, messages that do not fill a chunk yet, and the messages of broken summaries).

Ordering caveat: with summaries and raw messages as separate inputs, a broken summary in the middle puts its raw messages after later summaries until the next turn re-summarizes it.

## 3. What you see in the chat

Open the chat panel (sliders icon in the chat header), **Story state**:

- under the key, one card per linked item: **messages 1-4 (4)**, a badge (**intact**, **covers an edited message**, **some messages deleted**, **all messages deleted**) and the text collapsed to one line; open it to read the markdown;
- **click the range** and the thread scrolls to the first linked message and flashes it (on a phone the panel closes so you see it);
- broken items an intact item replaced, and intact repeats of an earlier item, are folded under **Replaced or repeated (n)**;
- the line under the cards reads **last written at turn N**: it is about the key, not about the last card.

In the thread:

- a **link icon** next to the speaker name of every message that state items link to; tap it for the list ("memory.summaries: messages 1-4 (4) - Scene so far..."), each with **Show in Story state**: the chat panel opens (on a phone it covers the thread) and scrolls to that item and flashes it;
- **editing** such a message shows a note first ("1 item of memory.summaries links to this message: messages 1-4 (4). Changing this message stops it being used until it is made again."), and so does the delete step; it is information, not an extra confirmation. The delete of a reply whose turn stored state keeps its dialog, which lists linked items by their words ("forgets 'Scene so far...' (linked to 4 messages)"), then the same note, and asks "Delete the reply?" last.

### Try the loop

1. With an intact summary showing, **edit** one of its messages and save. The card turns **covers an edited message** ("Not used until its messages match again or a Next Chunk node redoes it"), and the next prompt carries those messages raw again.
2. Send a message. After its reply, Next Chunk redoes the chunk; a new item replaces the old one (the old one moves under **Replaced or repeated**).
3. **Delete the reply of the turn that wrote the replacement** (the dialog lists the item). The old item is no longer replaced, and the next turn redoes the chunk again.
4. **Delete** some of a chunk's messages instead: the label reads `messages 5-7 (3 of 4 left)` and the chunk is redone over the three; delete all of them and it reads `all 4 messages deleted`.
5. **Edit a message, let a replacement be written, then edit it back:** the old item is intact again (its text is the original again), and the replacement, whose fingerprint was taken over the edited text, now reads **covers an edited message** and moves under **Replaced or repeated**; the prompt uses the old summary. A **repeat** (an intact item linking exactly the same messages as an earlier one) only arises when two intact items link the same messages, for example two State Write nodes for one chunk: the first in chat order is used and the other is folded.

### When an item is not saved

If a linked message is edited or deleted **while** the item is being written (a slow LLM), the write is dropped at commit time. The turn's chip (under its last reply) gets a warning icon and says which item was lost (quoted as plain words, without the markdown marks); the execution log has it too.

## 4. More details

- **Not only summaries.** Any State Write `add` on a list key can link to messages (a fact from a message, a mood per reply, an open thread and where it started): connect a message, or After Reply's **Replies**, to **Link to messages**. A `messages` key inside the value is ignored: links only come through that input.
- **Several summary sets** are several keys (and a Next Chunk plus Unlinked Messages pair for each).
- **Reply-part wiring** (Next Chunk and State Write without After Reply) works too but delays the reply; a link to the turn's own reply by id alone is fine from the after-reply part.
- **Phase 6 chats:** summaries stored by the phase 6 build are ignored (left untouched on disk) and re-summarized as new items.
- **Workflows with a Save Summary node** (phase 6 branch) open with it as an unknown-type placeholder; delete it and wire State Write as above.

## 5. Known limitations

- **Deleting or regenerating the turn that wrote a summary removes it.** It heals on the next turn (one extra LLM call); that is the cost of summaries being turn state.
- **No retry.** A failed after-reply run is not re-run; the next turn plans the chunk again.
- **No hand editing of linked items** (no discard, no re-summarize button).
- **A cap on the key drops the oldest items**, not the ones furthest back in the chat; leave it empty for summaries. The editor only notes it: it does not check workflows for a Next Chunk node.
- **A definition's field called `link`** keeps working if it already existed; new definitions cannot declare fields called `messages` or `link`, and a declared field called `messages` is never stored (that name is the built-in link).
- Memory with **All** sends the whole chat when no summary stands for anything yet.
- Linked text is sent whole in the state view; a chat with very many items makes that answer big.
- **Pre-existing, not part of 6b (reported, not fixed):** dropping a new LLM node with no preset shows a "Preset (none) not found" toast although a not-set-up node should be quiet; and **Validate saves the draft first**, so validating an invalid workflow (for example Chunk Size 1) stores it, and the chat then fails with "Workflow is invalid".
- The summary prompt, the model and the quality are yours: there is no built-in summarizer and no seeded example workflow.

## Quick checks

- The preset editor's preview, with a chat that has summaries as Conversation, shows the `linked` entry with the intact summaries (a broken one is left out).
- Workflow validates with the six wiring steps above; **Next Chunk** shows "Select a key" until a list key is picked (only list keys are offered).
- After turn 4 (chunk 4, raw window 2): Story state shows `messages 1-4 (4)` **intact**; messages 1-4 each show the link icon.
- Edit message 1: the note appears; after saving, the card says **covers an edited message**; after the next reply a replacement exists and the old card is under **Replaced or repeated**.
