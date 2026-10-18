> **Superseded by phase 6b.** Summaries are no longer a separate store: they are ordinary story state (a collection key whose items link to the messages they cover), Save Summary and Memory's summary set are gone, and deleting the turn that wrote a summary now removes it. See `phase-6b-howto.md` and `docs/explorations/STATE-DESIGN-AMENDMENT-1.md`. This page describes the phase 6 build only.

# Phase 6: history summaries (Next Chunk, Save Summary, Memory with a summary set), how to try it

Long chats outgrow the model's context. This phase lets a chat send the **most recent messages as they are** and **older history as short summaries of fixed chunks**. Summaries belong to the messages they cover, not to the turn that wrote them:

- a summary is used only while **every message it covers is still in the chat and unchanged**; edit or delete one and that chunk falls back to its raw messages until it is summarized again;
- the summaries are written by your own workflow (the LLM and the summarizing prompt are yours), typically **after the reply**, so summarizing never delays an answer;
- deleting a reply does **not** remove a summary (unlike story state): summaries are chat data, not turn state.

Full reference: README, section "History summaries" (and "Story state in the web" for the panel). Contracts: AGENTS.md, "History summaries".

## 1. The three nodes

| Node | Where | What it does |
|---|---|---|
| **Next Chunk** | Nodes palette, category **History** | Looks at the whole chat and the summaries of one **set**. Outputs the next chunk that needs a summary (or nothing). Config: **Set** (default `main`; letters, digits, `_`, `-`, up to 40), **Chunk Size** (default 20), **Raw Window** (default 16: the most recent messages are never summarized). Optional input **After** (wire After Reply into it). Outputs **Messages**, **Text** (a `user: ...` / `assistant: ...` transcript) and **Chunk** (a reference Save Summary needs). |
| **Save Summary** | category **History** | A sink (it always runs). Inputs **Chunk** (from Next Chunk) and **Text** (the summary; empty text fails the node, nothing is stored). Output **Summary**. |
| **Memory** (existing) | category **Chat** | New field **Summary Set** (empty = off, behaves exactly as before). With a set, older messages covered by a valid summary are replaced by it. |

Next Chunk hands out **one chunk per run**: the first summary that is no longer valid (re-planned over the messages it still has), else the next `Chunk Size` unsummarized messages outside the raw window, else nothing (its outputs stay empty and everything downstream is skipped).

## 2. The recipe

Goal: reply as usual; after each reply, summarize the next 4 old messages once there are enough, and feed summaries back into the prompt.

1. Presets: make a preset `Summarize` with one text input `transcript` and a system entry such as `Summarize this conversation excerpt in two short sentences, keep names and facts:\n{{input.transcript}}`.
2. Workflow (a copy of Default Assistant is a good start): **Chat Input**, **LLM** (your chat preset), **Chat Output** as usual, plus:
   - **Memory**: **Format** `messages`, **Last N** `4`, **Summary Set** `main`. Connect its **History** to the reply LLM's **History** input (instead of Chat Input's History).
   - **After Reply**.
   - **Next Chunk**: **Set** `main`, **Chunk Size** `4`, **Raw Window** `4`. Connect After Reply **Turn** to Next Chunk **After**.
   - a second **LLM** with the `Summarize` preset: Next Chunk **Text** to its `transcript` input.
   - **Save Summary**: Next Chunk **Chunk** to **Chunk**, the second LLM's **Text** to **Text**.
3. **Save**, **Validate** ("Workflow is valid"), start a **New chat** on it, and send messages.

What happens: through turn 4 nothing is summarized (chunk size 4 plus a raw window of 4 need 8 earlier messages). After the reply of turn 5 the after-reply run summarizes messages 1-4; from then on the prompt carries `[Summary of earlier messages]` + the summary + the recent messages. Every four more turns, another chunk.

**Keep Raw Window at least Memory's Last N.** A summary is used only when all its messages lie before Memory's raw part; one that reaches into it stays raw (no message is ever sent twice).

## 3. What you see

Open the chat panel (sliders icon in the chat header) and scroll to **Summaries**:

- per set, one card per summary: **messages 1-4 (4)**, a **valid** / **invalid** badge, and **Summary text** (collapsed; markdown is rendered like a reply) with when it was written;
- **click the label** and the thread scrolls to the first covered message and flashes it (on a phone the panel closes so you see it);
- with no summaries yet the section explains the feature;
- the numbers count the chat's messages from 1, user and assistant alike.

### Try the invalid / fallback / re-summarize loop

1. With a valid summary showing, **edit** one of its messages in the thread (pencil icon) and save. The badge turns **invalid**: "A covered message was edited or deleted; raw messages are used until it's summarized again."
2. The next prompt carries those messages raw again (open the reply's **Execution details**, the Memory node's log says how many summaries were used).
3. Send a message. After its reply, Next Chunk re-plans the damaged chunk; a new summary replaces the old one and the badge is **valid** again. Only the first invalid summary is re-planned per turn.
4. **Delete** some covered messages instead: the label reads `messages 5-7 (3 of 4 left)`; the chunk is re-planned over the three. Delete **all** of a summary's messages: it reads `all 4 covered messages deleted`, is not used, and **is removed the next time that set stores a summary**.

### When a summary is not saved

If a covered message is edited or deleted **while** the summary is being written (a slow LLM), the write is dropped at commit time: the turn's chip (under its last reply) gets a warning icon ("Turn warnings") and says `The summary for set "main" was not saved: a message it covers was edited or deleted while it was being written.` The run's log has the same line, and the next turn tries the chunk again. The same happens if a duplicate Save node would cover messages another valid summary already covers.

## 4. More details

- **Several sets** are fine (`short`, `detailed`): give each Memory / Next Chunk / Save Summary pair its own set name.
- **Reply-part summaries**: wiring Next Chunk and Save Summary without After Reply makes the summary part of the reply run (it delays the reply). The commit rules are the same.
- **Failed or stopped runs** keep the summaries their completed Save Summary nodes stored.
- **Text format**: Memory with **Format** `text` shows summaries as `Summary: <text>` lines.
- The editor shows the new fields with their help text; the **After** input on Next Chunk reads nothing, it only places the node after the reply.

## 5. Known limitations

- **Memory sends older, not-yet-summarized history raw.** **Last N** bounds only the raw part. With a summary set that nobody has written yet, or while summaries are invalid, the **whole** chat is sent, so enable a set on a long chat only together with the Next Chunk chain, and expect the prompt to shrink only as summaries get written (one chunk per turn, so a long existing chat catches up one chunk per message).
- **Chunks lag one turn.** The after-reply run sees the history as the reply run did (without the current turn), so a chunk is summarized a turn later than it could be.
- **Edits cost a re-summary.** Any edit inside a chunk invalidates the whole chunk, and its raw messages are sent until the next turn re-summarizes it.
- **No way to delete or hide a summary by hand.** Invalid ones wait for the re-plan; ones with no message left are removed when the set next stores a summary.
- **No retry.** A failed after-reply run is not re-run (phase 5): that turn just has no summary, and the next turn plans the chunk again. The failure stays listed in the panel's Story state section even after a later turn summarized fine.
- **The failure text names the node by its id** (`LLM (322696c2-...): ...`), an older behaviour of after-reply failures, not specific to summaries.
- **Set names are limited** to 1-40 letters, digits, `_` and `-` (not starting with `-`); anything else is a config error on the node.
- The summary prompt, the model and the quality are yours: there is no built-in summarizer and no seeded example workflow.

## Quick checks

- Validate a workflow with Memory `Summary Set` `bad name!`: the field reports the allowed characters.
- Run 5 turns of the recipe: **Summaries** shows `messages 1-4 (4)`, valid; click it and the thread jumps to message 1.
- Edit message 2: invalid + explanation; send one more message and the badge returns to valid with a new text.
- Delete a reply that came after the summarized messages: the summary stays valid.
