# State design, review 2: does proposal 2 serve the creativity goal?

An independent product and interaction-design review of
[STATE-DESIGN-PROPOSAL-2.md](STATE-DESIGN-PROPOSAL-2.md) (October 2026). The yardstick is the original
need in [CREATIVITY.md](CREATIVITY.md): make each chat feel fresh instead of converging on the most
probable story. [STATE-DESIGN-REVIEW-1.md](STATE-DESIGN-REVIEW-1.md) covered implementation. This
review leaves storage, locking and commit protocols alone and brings up implementation only where it
changes what a user can build or understand.

Section references such as "P2 §What happens when the chat is edited" point to proposal 2, "C §Trigger"
to CREATIVITY.md, and "R1 §6" to review 1. Tags:

- **[doc]**: what a document says.
- **[app]**: checked in the current code (node configs, schemas).
- **[elsewhere]**: how other roleplay tools behave, from general knowledge and not re-checked against
  their code. Treat these as leads.
- Untagged prose is my own judgement.

## 1. Verdict in brief

**Go with changes.** Proposal 2 is a sound memory layer: the rewind rule is mostly right for
roleplayers, the scope is honest and the slice is small. It is still only **one third** of what
CREATIVITY.md asks for. It builds the *bookkeeping* (counters, cooldown timestamps, a list of injected
items, summaries) and leaves out the two parts that create freshness:

1. **The source.** There is nowhere to keep outside content. The only "seed" in the first slice is a
   list typed into a Random node's config, and a list of objects there is read-only JSON in node-ui
   ([app] AGENTS.md, node-ui section).
2. **The trigger as a decision.** Random + Condition can express "dice below X and cooldown over",
   but not a score built from signals, a rising hazard, choosing an intensity rung, or "don't repeat
   what was drawn". With no arithmetic and no loops, those are not buildable.

On top of that, the proposal drops two things its predecessors had: the divergence harness (C §Where
to start: "alongside step 1") and any per-message visibility in the first slice. Without them, nobody
can tell whether the state work made stories fresher.

The top changes, ranked, are in §9.

## 2. Fit to the original need, stage by stage

"Buildable" means a user can wire it in the first slice (P2 §First slice) with existing nodes plus
the four new ones. I counted nodes as I would wire them, not as the proposal describes them.

### 2.1 Trigger (C §1. Trigger)

| Signal or rule | Status in the first slice | What is missing |
| --- | --- | --- |
| Plain random chance | **Buildable**: Random → Condition (`lt`) | Nothing |
| Cooldown (refractory window) | **Buildable, with a trap**: State Read meta `turnsSinceWrite` → Condition | The never-written case: before the first injection, "turns since written" has no value. A Condition `gt 3` on an empty string compares `0 > 3` ([app] Condition uses `Number(left)`), so **the trigger never fires**. The same trap blocks the first rolling summary. P2 must define meta for an unwritten key (for example "turns since the chat started"), and say whether empty sends and reply-less turns count as turns |
| Cooldown **per intensity level** | **Partly**: only with one timestamp key per level | Meta "turns since the last item of level ≥ 4 was added" needs item filters, which come last (P2 §Later 6) |
| Combining two conditions (dice **and** cooldown) | **Awkward**: Condition has one `value` input ([app]). You need Merge (object) → Condition with `{{#if (and (lt input.value.roll 0.2) (gt input.value.since 3))}}y{{/if}}` and `isNotEmpty`, or chained Conditions | This is the most common trigger shape, and it already takes Handlebars subexpressions |
| Hazard function (probability rises with time since the last injection) | **Not buildable**: no arithmetic anywhere (Condition compares, templates have comparison helpers only) | A step function made of several Conditions is the only workaround |
| Score = signals + noise, compared to a volatility threshold | **Not buildable**, for the same reason | |
| Tension vs. a target curve (build-up, peak, relax) | **Not buildable as described**. The walkthrough stores tension (P2 §Walkthroughs, step 1) but **never uses it**: step 3 tests only the roll and the cooldown. A curve needs a phase (an `enum` key works) plus transitions over the last few values, and `history(n)` is deferred | History reads, or a phase/clock primitive (§6) |
| Stagnation | **Partly**: an LLM judge over Memory works today, without state | Embedding distance needs embeddings; nothing in P2 helps here, and that is fine |
| Scene change | **Partly**: an LLM classifier writes an `enum`/`text` key; the next turn compares | Fine for a first version |
| Which **intensity rung** fires this turn | **Missing**. C §Trigger: "should we inject this turn, and **at what intensity**?" The walkthrough's seed "with its level" appears from nowhere | A rule that maps signals and the dial to a rung, or a budget (04 §4, item 5) |

Conclusion: the proposal's claim that Random + Condition covers the trigger, with a Gate only "if the
pattern proves tedious" (P2 §Later 6, following R1 §6.3), holds for the simplest trigger only. The
research's own recommendation (04 §4: refractory window + rising hazard + signal modulation + budget)
cannot be wired. A Trigger node is a **product necessity**, not a convenience. It is also the natural
place to record *why* a turn fired (C §4. Integration).

### 2.2 Sources (C §2. Sources)

| Source | Status | Comment |
| --- | --- | --- |
| Random tables | **Barely**: a list in the Random node config | No reuse across workflows, no tags, no intensity, no editor for objects. C §Where to start step 2 explicitly asks for "table files stored like presets". P2 dropped that |
| World-authored seeds (world bible) | **Not addressed** | P2 §Why this exists puts "world-specific seeds" under shared state, "later". A world bible is **authored, read-only content**, not state that chats write. It needs a record type, not the outbox |
| Real-world material | Possible through HTTP Request today | No change |
| Offline LLM-generated pools | Nowhere to store them | Same record type as tables |
| Verbalized sampling (model proposes, code picks) | **Probably buildable**: LLM → Parse JSON → Random pick | Only if Random's pick can take its list from an **input**. P2 doesn't say |
| Model rotation, samplers | Unaffected | |

This is the biggest gap measured against principle 4 ("outside content beats inside content"). The
state layer remembers what was injected but gives users no good place to keep what *could* be
injected. In practice, users will type ten items into a node config, and those ten items will be
their own mode.

### 2.3 Selection (C §3. Selection)

| Technique | Status | Comment |
| --- | --- | --- |
| Novelty against session memory (don't repeat what was injected) | **Not buildable as selection**. The `injected` collection exists, but nothing can *exclude* its items from a pick. Rejection sampling needs a loop, and workflows are DAGs | Needs a pick with an `exclude` input, or a Draw node that keeps its own "recently drawn" memory |
| Facet pivot | **Buildable**: LLM extracts facets → Parse JSON → Random pick → LLM or seed lookup | A good showcase of "LLM evaluates, code picks" |
| Anti-prototype filter | **Partly**: as prompting ("avoid these") | As a filter it needs similarity |
| Similarity band, association graphs, MMR | Not buildable (no embeddings) | Rightly deferred. Note that the band applies to **source pools**, while P2 §Later 5 talks about search over **collections**. Different things |
| Cover the space (R7: cells by facet/tone/rung) | Not buildable | Needs tagged pools plus "least recently used cell", the same gap as above |

### 2.4 Integration (C §4. Integration)

The best-supported stage. Offers worded by level (`{{#if (eq input.level 1)}}…`), depth placement,
and the empty-entry rule (a seed entry that renders empty on non-inject turns is dropped, [doc]
AGENTS.md Presets) all work today. When the inject branch is skipped, the narrator LLM still runs on
its other inputs ([app] executor), so the wiring is natural. The one weak point is "**why**": the
execution log shows the roll and the writes node by node, but nothing gathers them into a sentence a
user can read ("fired: roll 0.13 < 0.20, 6 turns since last; drew L1 'resin smell'").

### 2.5 Measuring (C §Measuring it)

**Not addressed.** Proposal 1 kept the harness "alongside phase 1" (P1 §Phases). Proposal 2 drops it.
The research index says plainly that the baseline / better prompt / verbalized sampling / retrieved
seed experiment "decides how much infrastructure is worth building" ([doc] README §Open questions 1).
Without it, every later item in P2 §Later is a guess.

### 2.6 The two problems

- **Sameness:** proposal 2 helps only indirectly (cooldowns, memory of injections, long-chat
  summaries). The parts that attack sameness, outside sources and code-made choices, are mostly
  missing (§2.2–2.3).
- **Overload:** role decomposition is already a workflow topology ([doc] 02). State adds what a
  director needs between turns (beats, threads, phase), so P2 helps here more than it claims.

### 2.7 Is state the right first block?

C §Where to start puts state first because "every trigger and novelty check needs it". That is true
for **refinements** (cooldowns, no repeats, pacing) but not for the **hypothesis**. The cheapest test
of "does outside content make chats fresher?" needs Random + a table + the harness, and no state at
all. A fixed-probability, level-1 texture injection has no cooldown to remember. The proposal's own
first two commits (Parse JSON, Random) are already stateless.

My view: keep the slice, but **add a decision point after Random + tables + harness**. Run the
README's experiment, then build the state commits. State is still worth building either way, because
it also delivers PLAN.md backlog items (summaries, author's note), so this costs time, not work.

## 3. The user's mental model

### 3.1 Concepts, as a roleplayer meets them

| Concept | Understandable? | Comment |
| --- | --- | --- |
| "A state definition: what this chat remembers" | Yes, for this app's users (they already edit YAML providers and presets) | The name is engineer-speak. In the UI, "Chat memory" or "Story variables" will read better |
| Declared, typed keys | Yes | "The key reads as its default" hides the difference between *never written* and *written with the default value*. The panel should show it |
| "What a turn stored lives as long as its replies" | **Yes for the last turn**, which is 90% of use | It matches the gesture: "delete and retry" gives a clean retry |
| "A value is what the most recent surviving turn wrote" | **Partly**. It's correct, but users will apply it wrongly in the middle of a chat (below) | Needs to be visible on messages, not only in a rule |
| Collections: survivors' adds minus survivors' removes, capped | Mostly | **Caps silently forget** (below) |
| "Pending, then published" for shared state | Yes, if phrased as "**locked in when you continue**" | The word "publish" suggests other people. The "commit" action needs a visible state on the message |

### 3.2 Where users will be surprised or lose work

1. **Deleting a reply removes a summary of messages that still exist.** The rolling summary is written
   by whichever turn fires it. Delete that one reply (it went off the rails) and the summary of
   messages 1–40 goes with it, though those messages are still there. The next turn re-fires the
   summary (cost, latency, and a *different* summary). The rule anchors data to **when it was
   written**, while summaries and extracted facts are about **what they cover**. At minimum, the
   delete confirmation should say "this also removes the summary of messages 1–40". Better, ask
   whether derived items should be anchored to their source range (a question P2 doesn't ask).
2. **Edits are the most common correction in roleplay, and they change nothing.** Roleplayers fix a
   reply far more often than they delete it: removing a contradiction, undoing an outcome, cutting the
   injected detail they didn't like. P2 §What happens when the chat is edited: "Editing a message
   never changes stored state", with staleness second in Later. The tension, facts and summary keep
   describing the unedited text, and nothing shows it. I'd move a **visible "built from an edited
   message" flag** into the first slice, or right after it. Nothing automatic is needed, just the
   flag.
3. **User-set values can be undone by deleting a reply.** P2 §Later 3: "Manual edits are recorded like
   a turn's writes." If a manual edit is attached to the latest turn, deleting that reply reverts the
   author's note the user just typed. That would be real lost work. User-owned values (the intensity
   dial, the author's note, a goal) need a different lifetime from turn-derived values (§3.4).
4. **Collection caps forget the beginning of the story.** `summaries: cap 20` cuts the **oldest**
   summary, which is exactly the part of a long story a summary exists to keep. That should come with
   a warning in the panel, and the walkthrough should show summaries of summaries (P1 had a `level`
   field for this).
5. **Middle deletions behave half-way.** Deleting a reply in the middle removes the items that turn
   added to collections but leaves scalars alone unless it was their latest writer. A relationship
   meter that went +2 in the deleted reply stays +2. That is the right call (exact replay would mean
   re-running later turns, P2 §What this deliberately leaves out), but users will expect otherwise.
   P2's open question 2 is the right one; see §8.
6. **Stop is the "this is going wrong" gesture.** A stopped turn keeps its writes while its partial
   reply exists. If the injection derailed the reply and the user stops and simply types on, the
   cooldown stays consumed and the item stays "used". Acceptable, but the per-message annotation should
   make it visible.
7. **Multi-output turns.** Deleting the narrator's reply while the character's reply from the same
   turn stays keeps all the state. That is correct by the rule, but the injection is usually visible
   in the narrator reply, so users will expect it to go.

### 3.3 Is the rewind rule the right product behaviour?

Compared with the tools roleplayers know ([elsewhere]):

| Tool and feature | Behaviour on delete, swipe or edit | Compared with P2 |
| --- | --- | --- |
| SillyTavern chat variables (`/setvar`, `{{setvar}}`) | Stored in chat metadata. Not rewound on delete or swipe, a long-standing complaint. Community extensions store variables per message so swipes roll back | P2 fixes the main complaint by design |
| SillyTavern Summarize extension | The summary is kept on a message. The latest message that carries one wins, so deleting it falls back to the previous one | **Exactly P2's rule.** Good precedent: users already live with it |
| SillyTavern Author's Note | Chat metadata, user-owned, never rewound. Has a depth and an "every N messages" frequency | User-owned, which P2 has no notion of (§3.4) |
| SillyTavern World Info | Global, character or chat lorebooks. Keyword scan, per-entry **trigger probability**, inclusion groups with **weighted random** choice, timed effects (sticky, cooldown, delay) | A ready-made random table with cooldowns. Users will ask why they must wire eight nodes to get what a lorebook entry has as fields |
| Swipes (ST, Character.AI, NovelAI retries) | Each alternative is separate. State usually does *not* follow the swipe | P2 makes state follow the visible alternative. Correct and better |
| NovelAI / KoboldAI Memory and Author's Note, AI Dungeon Memory and Story Cards, Character.AI pinned memories | Visible text the user edits, sometimes kept up by the model | All user-visible and editable. P2's first slice is read-only |

Verdict: the tail rule is right and has precedent. Two additions make it a good product rule rather
than an engine rule: user-owned keys that turns never rewind (§3.4), and visibility on each message
(§4.4).

**Regenerate deserves a decision now**, even though it isn't built (P2 §What happens when the chat is
edited, "Regenerate and swipes"). With the rule as written, regenerating re-rolls everything,
including the injection. That is good for variety (swipes become a source of freshness), but a user
who liked the detail and hated the prose has no way to keep the dice. "Regenerate, keep the rolls" is
a cheap, distinctive feature if rolls are recorded per turn, which the Random node already does.

### 3.4 A missing concept: who owns a value

Every roleplay tool above separates two kinds of value, and P2 has only one:

| | Story state (turn-owned) | Settings and notes (user-owned) |
| --- | --- | --- |
| Examples | tension, injected items, summaries, scene phase | intensity dial per layer, author's note, current goal, "events off" |
| Written by | workflow nodes during a turn | the user, from the panel (or a workflow, rarely) |
| On delete or swipe | follows the turn (P2's rule) | **never rewinds** |
| Needed in the first slice? | yes | **yes**: the dial is CREATIVITY's central control, and the author's-note walkthrough is unbuildable without it |

Today the only way to set the author's note is "a chat command parsed by a Condition" (P2
§Walkthroughs, Author's note). That command is a user message, so it also lands in the history the
narrator reads. Proposing it as a workaround tells me the editable panel belongs in the first slice,
at least for user-owned keys. A `owner: user` flag on a key (or a separate definition kind) is a
small addition to the concept, and it removes surprises 3 and 6.

## 4. Authoring ergonomics

### 4.1 Walking the walkthroughs

**Tension + cooldown (P2 §Walkthroughs, first one).** As a user would actually build it:

| Step | Nodes and records |
| --- | --- |
| Define memory | 1 YAML definition (4 keys) in the raw YAML editor |
| Rate tension | Memory, LLM (rater) + a rater preset, Parse JSON, State Write |
| Trigger | Random, State Read (meta), Merge, Condition with a Handlebars subexpression |
| Pick and record | Random (pick, list in config), State Write `injected`, State Write `lastInjectedTurn` |
| Deliver | an edit to the narrator preset: a new input, an entry at depth, `{{#if (eq …)}}` wording per level |

That is **about 11 new nodes**, 2 presets and 1 definition, spread over 3 editors, to get a trigger
that ignores tension, cannot ramp, picks from an untagged list, can repeat items, and doesn't choose an
intensity. `lastInjectedTurn` also has no meaningful value to write (there is no turn-number macro),
so users write a dummy value to stamp a time. That shows the real primitive is "an event happened",
not "a number". In fact `turnsSinceWrite` on the `injected` collection already gives the same thing,
so the key isn't needed.

**Rolling summary.** "Memory gives the messages since the last summary" (P2 §Walkthroughs, step 2)
does not work: Memory has only `lastN` and no inputs ([app] `nodes/memory`). Proposal 1's `since`
option was dropped. Users will summarize "the last 20 messages" every 10 turns, and the preset's
history slot can't start where the summary ends, so the narrator sees overlap or a gap. The bootstrap
also hits the never-written trap (§2.1). Fixable, but the walkthrough as written isn't buildable.

**Author's note.** Not buildable in the first slice (§3.4).

### 4.2 Is Random + Condition enough?

No (§2.1). The minimum trigger that matches the research is one node:

- **Trigger** (or Gate): base chance, refractory turns, ramp per turn, cap, optional signal inputs
  (numbers 0–1, each with a weight), per-rung cooldowns, the dial as an input. Outputs: `fire`
  (boolean branch), `rung`, and `reason` (text), all logged. It keeps its own "last fired per rung"
  memory in the chat's state, so users don't wire timestamp keys.

That one node replaces six of the eleven, and it is where the CREATIVITY rules (hazard, cooldown per
intensity, noise vs. signals) get a single, tested implementation instead of each user's hand-built
version. "Nothing is automatic" still holds: the user places it and sets every number.

A cheaper half-step is arithmetic and `min`/`max` template helpers, but that moves the complexity into
Handlebars strings, which is worse for this audience.

### 4.3 Declared YAML definitions as a first UX

Declared keys are the right foundation (typed ports, hints, warnings). Making them the *first thing a
user touches* is the wrong first experience. Two cheap fixes:

- **"New key…" from the State Write node** (name, type), written into a default per-chat definition,
  so a user can start in the workflow editor and tidy up in YAML later. This also answers P2's open
  question 3 without a second storage location.
- **A seeded example**: "Fresh texture" (a definition, a small CC0/CC BY table, a workflow with the
  trigger and a narrator preset with level-worded entries). Seeds already exist for "Default
  Assistant" and "Parallel demo" ([doc] AGENTS.md). For most users the first experience will be
  opening this and turning the dial, not writing YAML.

### 4.4 Is a read-only panel enough?

No, for two reasons:

- **User-owned values must be editable** from day one (§3.4).
- **The panel is the wrong place to explain a turn.** A per-message chip ("rolled 0.13, drew 'resin
  smell' (L1), tension 6") answers CREATIVITY open question 3 ("visible or invisible?"), makes deletes
  predictable (§3.2), and gives tuning feedback without opening the execution log. P2 puts it in
  "Later" (P2 §Seeing it). It should be in the slice, folded by default.

The panel also needs a **small history** for numeric keys (a sparkline of the last 20 values). Without
it, the user cannot see that the tension rater always answers 6 (§5).

## 5. Risks to the creativity goal

| Risk | How it makes stories more samey | Can the user see and fix it under P2? |
| --- | --- | --- |
| **Summaries flatten detail** | Prose summaries keep the gist and drop the specific nouns, names and odd details, which are exactly what C §The dragon effect says freshness lives in. A long chat drifts toward the summary's generic voice | Partly: the summary is visible in the panel. Suggest walkthroughs that keep a "specific details" or "open threads" collection next to the gist |
| **LLM tension ratings are mode-collapsed too** | A 0–10 rating clusters at 6–7, so a curve built on it is a constant and the trigger effectively ignores it | **No**: the panel shows only the current value, and `history(n)` comes last. Prefer categorical or relative questions ("calmer, same or tenser than before?") and show history |
| **Feedback loops** | (a) The narrator sees "Tension: 8" and escalates, the rater sees more tension, and so on. (b) The rater sees its previous value and anchors on it, so the value sticks | Only by reading prompts. Walkthroughs should advise: don't show the rater its last value; feed the narrator words, not scores |
| **Small hand-typed tables** | Ten items in a node config cycle quickly and reflect the author's own mode | No support for imported or shared tables (§2.2) |
| **Repeat avoidance by exact text** | "Resin smell" and "smell of pine resin" both pass an exact-match check | Accept for v1, but say so; similarity-based dedup waits on embeddings |
| **Per-chat-only memory and variety across sessions** | Every new chat with the same character starts from empty memory. Randomness is the only protection against the same opening seed (C open question 6) | Cheap fix within P2: **session-start seeding** (draw a premise twist, stored on turn 1). It deserves its own walkthrough, and it needs an "is this key set?" meta |
| **State makes the narrator predictable** | Visible state ("goal: find the key") becomes a script the model follows: more coherent, less surprising | A trade-off, not a bug. The harness is the only way to see it |
| **Regenerate re-rolls by design** | Fine for variety; frustrating when the user wants the same detail with new prose | Not yet (§3.3) |

The common thread: P2 gives the user the execution log and a current-value panel. Both are too deep
or too shallow to notice slow, statistical failures (a constant rating, a cycling table). Those show
up only across many turns or many runs, so the panel needs history and the project needs the harness.

## 6. Alternatives at the product level

| Framing | What it is | Strengths for this goal | Weaknesses | Compared with P2 |
| --- | --- | --- | --- | --- |
| **A. P2 as written** | Typed keys; turn-scoped lifetime; generic nodes | Small, general, clean rewind | Bookkeeping without sources or decisions; a lot of wiring | Baseline |
| **B. Storylets / quality-based narrative** ([doc] 03 §2) | State = *qualities*; content = **decks** of storylets with preconditions, tags (intensity, facet, tone), weights and repeatability; a selector draws among the eligible ones | Gives the gate → choose → shape structure every working system uses (03 §What this means). Content is authored, so it comes from outside the model. "Don't repeat" and "cover the cells" (R7) become properties of the draw | Needs a deck record and a Draw node; authoring decks is work | **Best complement**: P2 is the qualities half, B adds the missing deck half. Recommended (§9) |
| **C. Director object** (beats, threads, clocks/fronts as in tabletop RPGs) | First-class pacing objects: a *clock* with N segments that ticks and fires when full; *fronts* (threats that advance); *threads* (open plot hooks) | Clocks are more legible than "tension: 7". "Resurface a dormant thread" is a strong, cheap freshness move: content from the story itself, chosen by code, and it cannot derail (03 §2, story sifting) | A fixed ontology, against "nothing automatic" if built in; genre bias (action-heavy) | Build as **recipes on P2** (a clock = a number key with max plus a Trigger; threads = a collection with `lastMentioned`), not as a new engine concept |
| **D. Lorebook-first** | Keyword-triggered entries (PLAN backlog) extended with probability, cooldown and intensity | The relevance baseline the research says to compare against ([doc] 05 §6). Roleplayers already know it. ST shows probability and cooldown fit naturally on entries | Keyword recall is relevance-only; no novelty by itself | Merge with B: **one record type** (entries with keys *and* tags), two nodes (Recall by keywords, Draw at random) |
| **E. Notes-first** | Free-text notes the LLM maintains and the user edits (NovelAI Memory, AI Dungeon Story Cards) | The most trusted memory UX in roleplay; easy to correct | No typed counters; gives the LLM the job of deciding what matters, which pulls toward the mode | Supported by P2 `text` keys **if** the panel is editable. Not a replacement for typed state |
| **F. Per-scene state** | State resets or rolls up at scene boundaries; cooldowns count scenes, not turns | Scenes are the unit roleplayers think in; "scene change" is already a trigger signal (C §Trigger) | Needs a reliable scene-break signal | A recipe on P2 (a `scene` counter key) plus "turns since X **in this scene**" as meta later |
| **G. State visible in the fiction** | The draw is shown in the chat as a card ("the Director draws: *a bell on a lost animal*"), with accept / reroll / veto | Answers C open question 3 and 04 open question 2 (preview and veto). Turns the dice into play, as tabletop oracles do. Lets the user who drives the story stay in charge (C open question 5) | Breaks immersion for some users; needs a "pending injection" step before the narrator runs | Optional later. The per-message chip (§4.4) is the passive first step |

None of these replaces P2's core. B and D add the content side P2 lacks, and C and F are best shipped
as **documented recipes** on top of it.

## 7. Scope and sequencing

### 7.1 Per-chat only first?

Right for **writable** state: the rewind rule is clean, and every creativity need in P2 §Why this
exists except the last row is per chat. But P2 files two different things under "shared":

- **Shared authored content** (world bible, decks, lorebook, seed tables): read-only from chats, no
  rewind question, no outbox. It serves C §Sources directly ("probably the strongest way to make a
  world feel like *theirs*"). It should come **early**, as a record type like presets.
- **Shared writable state** (character memory across chats, campaign facts written by parallel
  chats): needs the pending/publish rule. It can stay later.

A character's memory across chats is the feature companion-style users value most, but it isn't on
the creativity path. Its delete semantics also need a product answer first: when a chat is deleted,
does the character forget what that chat taught her?

### 7.2 Proposed order

| # | Item | Why here |
| --- | --- | --- |
| 1 | Parse JSON; Random (pick takes an **input** list, can exclude) | As in P2 |
| 2 | **Decks/tables** as YAML records (tags: intensity, facet, tone; weights) + **Draw** node (filter by max rung, avoid recent draws in this chat, log why) | The source stage; principle 4 |
| 3 | **Variations harness**: from a message, run the workflow N times without saving, side by side, each with its trace | C §Measuring; the same UI later becomes swipes |
| — | **Decision point**: run the README experiment (baseline / prompt / verbalized sampling / drawn seed) | Decides how far to go |
| 4 | Sinks, definitions, session state, `{{state.*}}`, with **user-owned keys editable** in the panel, meta defined for never-written keys | P2 commits 3–7, adjusted |
| 5 | Per-message trace chip; delete confirmation lists what is undone; numeric sparkline | Visibility |
| 6 | **Trigger** node (hazard, per-rung cooldowns, signals, rung choice) | Makes the C §Trigger buildable |
| 7 | Post-turn runs; Memory `since` / skip-first; "edited source" flag | Summaries done properly |
| 8 | Shared authored content used across chats (world decks per character or per "world"); Lorebook recall node on the same records | Variety across sessions |
| 9 | Shared writable state (character memory, campaigns) with the outbox | As P2 §Later 4 |
| 10 | Search, embeddings, similarity band | Only if step 3's experiment says so |

### 7.3 Table stakes missing for "memory"

Roleplayers will expect these, and none is in the first slice:

- **Lorebook-style keyword recall.** Already in the PLAN backlog. Should share a record type with decks.
- **Per-character facts within one chat.** Group chats (several Chat Outputs, `character` ports, [doc]
  AGENTS.md Execution semantics) want a relationship meter per NPC. A `partitionBy: [character]`
  *inside* the session is a different scope from "across chats" and isn't discussed.
- **Visible, editable notes** (§3.4, §4.4).
- **History trimmed to a token budget** alongside summaries (PLAN backlog). Summaries without "history
  since the last summary" are half a feature (§4.1).

## 8. Proposal 2's open questions, answered

1. **Per-chat only first, or character memory across chats before post-turn runs?** Per-chat first.
   Post-turn runs before character memory, because memory extraction belongs after the reply. Pull
   **shared read-only content** (decks, world bible) ahead of both: it serves the creativity goal and
   has no rewind question.
2. **Is "latest surviving turn wins" understandable, or must the panel show what a deletion undoes?**
   Understandable for the last reply. For everything else, show it, but on the **message** and in the
   **delete confirmation** ("Deleting this also undoes: injected 'resin smell'; summary of messages
   1–40"), not only in the panel. Only list what is lost; scalars that won't change need no mention.
3. **Separate definition records, or a workflow-carried definition?** Keep records (templates need a
   catalog), but let users create keys from the State Write node into a default per-chat definition,
   and ship a seeded example. That removes the friction without a second storage location.
4. **Where does the volatility / intensity dial live?** A **user-owned, per-chat key** (one per layer
   if wanted: C open question 2), with its default in the definition, editable in the panel and passed
   into the Trigger and Draw nodes. Not a preset input (it would apply to every chat using the preset)
   and not a "workflow input" (workflows have no inputs today, [app] `workflowSchema`).

### Questions P2 should add

- Where do seeds live, who authors them, and how are they tagged by intensity?
- How is the **rung** chosen each turn, and how does the dial cap it?
- How will we know it worked? Which harness, and where in the sequence?
- What does a never-written key report as meta, and what counts as a turn (empty sends, reply-less
  turns, multi-output turns) for cooldowns?
- Which values are user-owned and never rewound?
- Should derived items (summaries, extracted facts) live as long as their writing turn or their source
  range?
- On regenerate: re-roll, or keep the dice?
- What happens to old summaries when a cap is reached?
- Are injections visible in the chat, and can the user veto one before the narrator runs?
- Interactive play vs. co-writing (C open question 5): what tells the trigger that the user is
  mid-thread, so it holds back (05 §3.2, Chan 2017)?
- Per-character state inside one group chat.

## 9. Recommendation

**Go with changes.** Keep proposal 2's core: declared keys, the turn-lifetime rule, per-chat first,
Parse JSON and Random first. Change the slice as follows, in order of importance:

1. **Add the source half.** Deck/table records (YAML, tagged by intensity, facet and tone, weighted)
   and a Draw node that filters by rung, avoids recent draws in this chat and logs why. Without it,
   the slice remembers injections it has no good way to make, and principle 4 is unserved.
2. **Add the harness and a decision point** after Random + decks, before the state commits. It is the
   only defence against building infrastructure on vibes (C §Measuring, README open question 1).
3. **Split user-owned from turn-owned values,** and make user-owned keys editable in the first slice.
   This unblocks the dial and the author's note and prevents lost manual edits.
4. **Make each turn's state visible on the message** (trace chip, delete confirmation listing what is
   undone, a sparkline for numbers). Move it from "Later" into the slice.
5. **Plan a Trigger node, not just a "Gate if tedious".** Hazard, per-rung cooldowns, signal inputs,
   rung output, reason. Random + Condition covers only the simplest trigger.
6. **Fix the walkthroughs so they can be built.** Define meta for never-written keys; add Memory
   `since` (or don't promise it); actually use tension in the trigger; show caps and summaries of
   summaries; flag values built from edited messages.
7. **Separate shared authored content from shared writable state** in "Later", and bring the first
   one forward.
8. **Ship a seeded "Fresh texture" example** (definition, a small openly licensed table, workflow,
   level-worded preset), so the first experience is turning a dial, not writing YAML.

With those changes the design serves CREATIVITY.md's pipeline end to end at a crude level (trigger,
source, selection by tags and recency, integration as offers, measurement), and leaves embeddings and
shared writable state for when the harness says they're worth it.
