# Phase 7: the Trigger, two example workflows and the guide, how to try it

Phase 7 adds a **Trigger** node (decides whether to inject something this turn and how strongly), a small **Pick Fields** node, two **example workflows** that are added for existing users too, and one user guide, `docs/STATE-AND-LORE.md`, that explains chat settings, collections, story state, after-reply work, summaries and the Trigger in plain language.

Full reference: README, sections "Trigger node", "Pick Fields" (under Random and Parse JSON nodes) and "Example seeds"; contracts: AGENTS.md ("Trigger", "Seeded workflows"). User guide: `docs/STATE-AND-LORE.md`.

## 1. The examples appear by themselves

Start the app (`npm run dev`). On the first start after this phase the server adds, once:

- **Fresh texture (example)** with the collection "Forest textures (example)", the preset "Fresh texture narrator (example)" and the `scene` definition (if you have none);
- **Rolling summaries (example)** with the `memory` definition, the presets "Narrator with summaries (example)" and "Summarize (example)".

This happens even if you already have workflows. The server remembers what it seeded in `data/.seeded.json` (lines like `fresh-texture/workflow:<id>`, `rolling-summaries/preset:<id>`):

- delete an example and it stays deleted (record by record); edit one and it is never overwritten;
- **to get deleted examples back**, stop the server, delete `data/.seeded.json` and start it again: every missing record is created, nothing that exists is touched. To bring back only one example, remove every line that starts with its name (`fresh-texture/` or `rolling-summaries/`). If only some of its lines are removed while some of its records are still deleted, the example is skipped and the server log says "a record it uses was deleted after it was first seeded";
- if you already have a state definition named `scene` or `memory`, it is used when it has the keys the example needs with the same types (and, for a list key, the same item fields: `scene.injected` needs `level:number` and `entryId:text`, `scene.lastInjectionLevel` a number, `memory.summaries` a list), otherwise the example is left out and the server log says why (once per start while it still has something to create). A list with a Cap is accepted, with a log hint that the cap drops the oldest summaries;
- a problem while seeding (a failing save) is logged and skipped; the server always starts. A ledger that is not valid JSON (or not a list of strings) stops all example seeding and is left untouched: fix or delete it by hand.

The examples' LLM nodes use the built-in OpenRouter provider and `openai/gpt-4o-mini`. Either save an `openrouter` secret in Settings, or open the example, pick your own provider and model on each LLM node (Rolling summaries has two) and Save.

## 2. The Trigger node

Palette category **Creativity**, **Trigger +**. Select it and its panel shows:

- **Base chance** (0.1), **Growth per turn** (0.05), **Volatility** (0.3), **Max level** (a dropdown, 1 to 5, default 2);
- a **Levels** table with a **Cooldown** (turns between two firings at that level) and a **Weight** (relative chance, 0 = never) per level;
- **Signals**: **+ Add signal**, then a name and a weight. A signal that is not connected, or whose source was skipped, counts as 0 and never stops the Trigger from running. A name must start with a letter, can use letters, digits and `_`, and cannot be `volatility`, `maxLevel` or `value`, or repeat. The name becomes an input of the node. A bad name shows a hint under the row and one toast. Renaming a signal drops the connections to the old name.

Score = `clamp01((baseChance + growthPerTurn × turnsSinceLastFiring + sum of weight × signal) × (0.5 + volatility))`, where `clamp01` keeps it between 0 and 1. It rolls once from the turn's seed; it fires when the roll is below the score and a level is available (at most Max level, off cooldown, weight above 0). Outputs: `Fire`, `Level` (only when fired), `True`/`False` (pass an optional `Value` through), `Score`, `Roll`, `Reason`. A firing is remembered as the node's own state (`fires`), so **deleting the reply undoes the firing and its cooldown**.

A recipe without an LLM: Chat Input to Trigger `Value`; Trigger `Reason` to a Chat Output; send messages and read the reasons (`score 0.225 = (0.1 + 0.05×1) × 1.5; roll 0.872 ≥ 0.225: no firing`). Connect a Chat Settings `volatility` to the Trigger's `Volatility` input to turn it per chat.

## 3. Pick Fields

Palette category **Logic**. A new node has no names yet and **Validate** says so ("List at least one field name"). Keeps only the listed fields of an object (`Fields`: comma-separated names, in that order; a name the object lacks is left out and logged). The example uses it so that Draw's `Entry` (which also has `collectionId`, `keywords`, `tags`) becomes `{ text, level, entryId }`, exactly what `scene.injected` declares, and State Write has nothing to log as left out.

## 4. Fresh texture, step by step

1. New chat on **Fresh texture (example)**. Open the chat panel (sliders icon): **Settings** has **Volatility** and **Max level**. Set Volatility to 1.
2. Send 6 to 10 messages. On a firing turn the reply gets a database icon; its card lists the Trigger's firing, Draw's pick, `scene.lastInjectionLevel` and `scene.injected + '...' (level 1)` (its items keep `text`, `level` and `entryId`).
3. **Story state** shows `scene` and, under **Node memory**, Draw's `draws` and the Trigger's `fires`.
4. **Execution details** on any reply: the Trigger's `Reason`; on a firing turn the LLM request carries the offer ("Optional color, only if it fits the moment: ...", "If the story has room, ...", "If it serves the story, ..." by the drawn entry's level), otherwise the plain prompt. No "Left out fields" log line.
5. Delete the reply of a firing turn: the dialog lists the Trigger forgetting its firing, Draw forgetting the draw and `scene.injected` forgetting the item. After OK all three are gone.

Why no Condition is needed: when the Trigger does not fire there is no `Level`, so Draw (its `maxLevel` input is connected) and the two State Writes are skipped, while the LLM's optional `seed` and `level` inputs let it answer anyway.

## 5. Rolling summaries, step by step

1. New chat on **Rolling summaries (example)**. For a quick try, open the workflow, select **Next Chunk** and set **Chunk Size** 4 and **Raw Window** 2, Save (the defaults are 20 and 16).
2. Chat. The after-reply run sees the history as the reply run had it, so with 4 and 2 the first summary (messages 1-4) is written after turn 4, the next after turn 6; with 20 and 16 the first is written after **turn 19** and is in the prompt from turn 20.
3. **Story state**: `memory.summaries` with a card `messages 1-4 (4)`, badge **intact**, the text; the linked messages carry a link icon in the thread.
4. Edit a linked message: the card says it covers an edited message and is no longer used. Send a message: the chunk is redone and the new summary replaces it.
5. Delete the reply of the turn that wrote a summary: the dialog lists it; the next turn summarizes the chunk again.

## 6. Fixes from the review rounds

- The Trigger panel no longer prints the node description twice; the levels table has Cooldown and Weight headings and no wrapping labels; the signals have Name and Weight headings.
- Example layouts are spread out (the Chat Settings nodes no longer touch the Trigger; edges do not loop back or run under nodes).
- README and test comments said the first summary appears after turn 18; it is turn 19 (see section 5).
- A Trigger wired only to a signal from a branch not taken used to be skipped; signals now count as 0 there and the Trigger still runs.
- The example presets now carry Personality, Scenario, Example dialogue and Post-history instructions like Default, so a character card behaves the same in them.
- The coercion label on a connection ("→text") has a dark background and is readable on the canvas; the Next Chunk Raw Window hint and the Trigger Base chance hint were reworded.
- Seeding: the same-id definition is fit-checked too, a failing pack no longer stops startup, the ledger is written per pack and names the pack on each line (old bare lines still read).

## Known limitations

- The examples are written in English and need an LLM key.
- The Trigger has no built-in signals: a signal is any 0..1 number you wire in.
- Levels are 1 to 5 and cooldowns count turns, not messages.
- Summaries cost one extra LLM call per chunk (and one to redo a broken one); an after-reply run delays the next message until it ends.
- Deleting an example does not delete the records it shares (collection, presets, definitions).
- Someone who already has the older Fresh texture workflow keeps its old wiring (no Pick Fields): it still works, its State Write only logs the fields it left out. Delete the workflow and the ledger lines of `fresh-texture/` to get the new one.
- An example skipped because of a clashing definition is only reported in the server log.
