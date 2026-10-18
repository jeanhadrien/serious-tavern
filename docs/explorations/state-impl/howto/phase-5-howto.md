# Phase 5: work after the reply (After Reply), how to try it

Some work should not delay the answer or put it at risk: noting what just happened, extracting facts, writing a summary. This phase adds a node, **After Reply**, that marks such work. Everything wired behind it runs as a **second run after the reply is saved**, in the same chat queue:

- the reply reaches the screen first, complete, exactly as before;
- the second run (the **after-reply run**) then does its work and stores its results in the **same turn's** story state, so deleting the reply undoes them too;
- if it fails, the reply and the turn are untouched: you only get a message that the after-reply steps failed.

Full reference: README, section "After Reply and post-turn runs" (and "Story state"). Templates: `docs/TEMPLATING.md`.

## 1. What After Reply is

In the workflow editor's **Nodes** palette, category **Chat**: **After Reply +**. It has no inputs and three outputs that only have values in the after-reply run:

| Output | Type | What it holds |
|---|---|---|
| **Replies** | messages | the turn's saved assistant messages |
| **Text** | text | their contents joined by a blank line |
| **Turn** | number | the turn's number (1 for the first reply) |

Any **sink** (a node that must run, today **State Write**; later Save Summary) that has After Reply upstream of it belongs to the after-reply run. Everything else, every Chat Output included, is the reply. A workflow with no After Reply behaves exactly as before and has no second run.

**Chat Output cannot depend on After Reply** (its reply would have to be written before the run that feeds it). **Validate** (or a send) says so, naming both nodes, and the offending connection is highlighted in red.

## 2. A recipe without an LLM

Goal: after every reply, store the reply's text as a note in the chat's story state.

1. Workflows list, **+ New**, name it `After demo`. Add **Chat Input**, **Chat Output**, **After Reply** and **State Write**.
2. Connect Chat Input **Message** to Chat Output **Value**, and set Chat Output's **Template** to `Reply {{trigger.turn}}: {{input.value}}` (or just leave the passthrough).
3. State Write: **State definition** `scene`, **Key** `injected (collection)`, **Operation** Add an item.
4. Connect After Reply **Text** to State Write **Item**. Nothing else needs connecting: State Write runs because it is a sink, and it is after-reply work because After Reply is upstream.
5. **Save**, **Validate** ("Workflow is valid"), start a **New chat** on `After demo` and send `hello`.

What you see: the reply `Reply 1: hello` appears at once. Under it, a small icon button (**What this turn stored**) appears a moment later; its card says `Turn 1 stored:` and `scene.injected + 'Reply 1: hello'`, then an **After-reply run details** disclosure. The chat panel (sliders icon in the chat header, **Story state**) shows the note under `scene`.

To actually watch the second run, make it slow. Add an **HTTP Request** (GET `https://httpbin.org/delay/5`), connect After Reply **Text** to its **Input**, and its **Status** output to State Write's **Run when**. For about five seconds a quiet row above the composer reads **Running after-reply steps… (turn 1)** with a spinner and a stop button, while the composer stays usable.

An increment is just as easy: a second State Write on `scene.tension`, Operation Add to the number, **Amount** 1, with After Reply **Turn** connected to its **Run when**.

## 3. A recipe with an LLM summary

Goal: keep a running one-line summary of the chat that the next replies can read.

1. State definitions: **+ New**, name `memory`, add a key `summary` (type text, Default empty). Save.
2. Presets: make a preset `Summarize` with a text input called `reply` and a system entry such as: `Summarize this reply in one short sentence: {{input.reply}}` (the input shows up under **Variables**).
3. Workflow: your usual reply part (Chat Input, an LLM with your chat preset, Chat Output), plus: **After Reply**, a second **LLM** node using `Summarize`, and a **State Write** on `memory.summary`, Operation Set to a value.
4. Connect After Reply **Text** to the second LLM's `reply` input (the preset's input), and that LLM's **Text** to State Write **Value**.
5. In your chat preset reference the result: `Story so far: {{state.memory.summary}}`.

The reply streams as usual. The summary is written afterwards; the **next** message waits for it to be stored, so it always reads the previous turn's summary.

**Wire after-reply work from After Reply's outputs, not from the reply's own nodes.** Rule of thumb: a node needed by both parts runs **twice** (once per run). A reply LLM that also feeds an after-reply node would be called twice and could answer differently. State writes are the exception that makes this safe: **only nodes exclusive to the after-reply run write state there**, so a State Write on the reply side that also feeds after-reply work still counts once per turn (the post log says it skipped the repeated write). Chat Input, the history, your chat settings, character and persona are the same in both runs; random draws use a derived seed, so they differ but are reproducible from the log.

In the after-reply run `{{trigger.turn}}` is the turn that just finished, and `{{state.*}}` already includes what the reply run wrote this turn.

## 4. What you see

- **Status row** (above the composer): **Running after-reply steps… (turn N)**, a spinner and a **Stop after-reply steps** button. It appears right after the reply and disappears when the run ends, no reload needed. The composer keeps working.
- **Sending meanwhile** is allowed. The server queues the message behind the run; the thread shows `Waiting for the after-reply steps to finish`, and the composer's button reads **Cancel queued message** (Esc too).
- **Failure toast**, once: `After-reply steps failed on turn 2: HTTP Request (fetch): HTTP 500 …`. The reply stays.
- **Chip** on the turn's last reply: **What this turn stored** (the writes), or **After-reply steps details** when it stored nothing. A failure gives it a warning icon and the card shows the error. Every ended run has an **After-reply run details** disclosure with its own log (nodes, durations, wire logs of its LLMs).
- **Chat panel, Story state**: a **After-reply steps that failed** list (the newest three) with each run's details. This is where a failure stays after the toast is gone, for a turn that had no reply (no chip to hang on), and for one that happened while the chat was closed. A failure that happened before you opened the chat never toasts; it is here and on the chip.
- **The reply's execution details** list the after-reply nodes as `skipped` with the line "Runs after the reply, in the after-reply run." The run's own log is the one behind the chip.

## 5. Stop, cancel, delete

- **Stop after-reply steps** (the row's button) stops the run. It ends as `stopped` with no toast; the nodes that had finished keep their writes. The chip says the steps were stopped.
- **Cancel queued message** (composer, or Esc) while your message waits behind the run: drops your message unstored (the text returns to the composer) and leaves the run alone. Closing or reloading the page while it waits cancels it too.
- **Delete a reply**: what the turn stored by the reply part **and** by the after-reply run is undone together; the run's status stays on the turn.
- **Delete the chat** while a run works: the run is stopped.
- A failed or stopped **reply** leaves no after-reply run.

## 6. Known limitations

- **The next message waits for the run.** A summary that takes a minute delays the next reply by a minute. A queued message gets no response bytes until the run ends (no "queued" frame yet), so a proxy with a short idle timeout in front of the server could drop it.
- **No retry.** A failed after-reply run is not re-run; that turn simply has no memory update (listed in the panel). Same for a server restart or a graceful shutdown mid-run: the turn reads `The run was interrupted by a server restart.`, with no log if it never finished.
- **If the server is killed** while the page is open, the row can stay until you press its Stop (which reads the state again) or reload.
- **Twice-run nodes** (see section 3) cost twice. There is no warning for it yet.
- **A message that is only queued** is cancelled by the composer, while the row's Stop still ends the run, which is a separate action.
- **Only the open chat toasts.** Failures in other chats show on their chip and panel list when you open them.
- A turn that completed with **no reply** (every Chat Output skipped) still runs its after-reply work, with empty replies and text.

## Quick checks

- `Validate` on a workflow that wires After Reply into a Chat Output: "can't depend on", edge highlighted.
- Send twice quickly with the HTTP delay in place: the second reply shows `Waiting for the after-reply steps to finish` and arrives after the run.
- Stop the row mid-run, then open the chip: "After-reply steps were stopped before they finished."
- Break the URL (use a closed port): one toast, a warning chip, an entry in the panel's failed list, details showing the HTTP Request node in error.
- Delete the reply: `scene.injected` loses the note along with its turn.
