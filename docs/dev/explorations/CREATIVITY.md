# Creativity: fresh stories instead of the most probable one

Design notes from a brainstorm (October 2026) on making each chat feel original instead of
converging on the same story. These notes are not a spec: nothing is decided yet, and the open
questions at the end still need answers. The supporting literature is in this folder; see the
[index](README.md).

Cost is set aside for now. The point is to find what works first.

## The problem

The baseline is a single LLM call that does everything at once: narrate, move the scene forward,
develop characters, write dialogue. That bundles two separate problems.

| Problem | What it looks like | What fixes it |
| --- | --- | --- |
| **Sameness** | The same inputs (history, characters, instructions) lead down the same path in every session | Randomness and material from **outside** the model |
| **Overload** | One call can't do pacing, characters and prose well at the same time | Splitting the work into roles (director, narrator, characters) |

Multi-agent setups mostly fix overload. They don't fix sameness on their own.

### LLMs are mode-collapsed, not deterministic

- **Temperature varies tokens, not decisions.** A plot choice is committed in the first few tokens of
  a reply, and instruction tuning has narrowed the model's sense of what a good story beat is. A
  higher temperature gives different words for the same story, then incoherence.
  See [01](01-diversity-and-mode-collapse.md).
- **A separate "ideas" LLM has the same collapse.** Given the same context, a brainstormer or
  scenarist suggests the same "surprising" twist every time (the mentor's betrayal, the mysterious
  stranger, a character named Elara). It moves the convergence one step earlier.
- **The fix is upstream:** randomness has to enter at the decision level, through the prompt
  context, not through the sampler.

## Principles

1. **Code rolls the dice, the LLM interprets them.** LLMs are bad at being random and very good at
   making sense of a random constraint.
2. **LLMs evaluate well and surprise badly.** "Is this scene stagnating?" and "does this detail fit?"
   are classification tasks the model handles fine. "Come up with something surprising" is where
   mode collapse bites. So use an LLM for gating and fit checks, never as the source of novelty.
3. **Never let an LLM pick the most interesting option.** An LLM judge picks the mode again. If a model
   proposes candidates, code chooses among them (verbalized sampling, possibly weighted toward the
   unlikely ones).
4. **Content from outside the model's distribution beats content from inside it.** Human-written
   corpora, curated tables and world-specific seeds bring real novelty. LLM-generated pools are
   acceptable when built offline, seeded with random material and deduplicated.
5. **Enrich, don't derail.** The goal is a generic mechanism that makes the main story richer, with
   no "and suddenly a dragon appears" effect unless that is explicitly dialled in.

## The dragon effect comes from framing, not dice

An injection derails a story for two reasons, and neither is the random roll itself:

- **What kind of content it is.** An event forces the plot; a detail only colours it.
- **How the narrator is told.** "Make this happen" forces a pivot. "Here is something true about
  this world" gets absorbed.

So **intensity** is a property of every injected item, and a dial caps it.

| Level | Kind | Example (forest scene) | Frequency |
| --- | --- | --- | --- |
| 1. Texture | sensory, lexical, imagery | resin smell, a specific bird call, an unusual verb | can fire every turn |
| 2. Detail | objects, customs, local history | a boundary stone with a worn inscription | often |
| 3. Interiority | a character's memory, desire, contradiction | it reminds her of her father's workshop | sometimes |
| 4. Development | a shift in a relationship or situation | she finally says what she's been avoiding | rarely |
| 5. Event | external plot intrusion | the dragon | almost never, or opt-in |

The integration wording scales with the level: level 1 says "weave this in if it fits", level 5 says
"this happens". Most of the freshness probably lives in levels 1 to 3, because prose that feels alive
comes from specific detail, and detail never derails a scene.

The research reaches the same conclusion: the dragon is a mix of five separable failures (no
relevance gate, wrong moment, clocked events, content treated as a command, intensity mismatched with
the scene), and "a better gate beats a better pool". See [03](03-drama-management.md) and the
synthesis in the [index](README.md).

## The pipeline

Four separate stages, each tunable on its own:

1. **Trigger:** should we inject this turn, and at what intensity?
2. **Source:** where does the content come from?
3. **Selection:** which item, balancing relevance against novelty?
4. **Integration:** where it goes in the prompt, and how strongly it is phrased.

### 1. Trigger

A plain random number is a start, but the trigger should be a **score built from signals, plus some
noise**, compared against a threshold set by a "volatility" dial. Candidate signals:

- **Stagnation:** the last N turns are semantically too close to each other, so the story is
  circling. Embedding distance between turns measures it.
- **Scene change:** a large semantic jump, or a classifier spotting a change of place or time. A
  natural moment for fresh texture.
- **Tension vs. a target curve:** an LLM rates the current tension and compares it with a pacing
  curve (build-up, peak, relax, as in the Left 4 Dead AI Director). Inject when the story drifts off
  the curve.
- **Hazard function:** the probability rises with the time since the last injection and resets after
  one fires. That avoids both uniform dice and predictable "every 5 turns" pacing.
- **Cooldown per intensity level:** for example, at most one level-4 item every X turns.

The research adds a useful nuance: distant material helps at an impasse and hurts mid-flow, so
injecting on detected stagnation is safer than injecting during momentum. See
[04](04-triggering-and-timing.md).

### 2. Sources

Ordered roughly from simplest to richest:

- **Random tables:** curated lists (sensory details, objects, motives, names). Names deserve their
  own tables built from real-world corpora, because LLM name generation is badly collapsed.
- **World-authored seeds:** a world bible written by the user. Probably the strongest way to make a
  world feel like *theirs*.
- **Real-world material:** a random Wikipedia article, a historical event, an obscure word, a museum
  object.
- **LLM-generated pools, built offline:** generate hundreds of seeds once, seeding each batch with
  random words so batches don't converge, then deduplicate and curate.
- **Verbalized sampling:** a model proposes N candidates with rough probabilities, and code picks one.
- **Model diversity:** rotating models (different training, different modes); base models for
  ideation, where available.
- **Samplers** (`min_p`, XTC) only as a prose-level complement, through the provider's `extraBody`.
  The research flags the evidence for min-p as disputed.

### 3. Selection: semantic match vs. orthogonal

Nearest-neighbour retrieval adds nothing: a forest scene pulls "trees, moss, sunlight", which the
model would have written anyway. Pure orthogonal retrieval is noise. This is the relevance vs.
serendipity trade-off from recommender systems. Ways through it:

- **Similarity band:** retrieve from a cosine band (say 0.3 to 0.5) instead of the top-k: related,
  but not obvious. The band's position is the novelty dial.
- **Facet pivot:** don't embed the whole scene, which averages out to "forest". Extract facets (rot,
  mushrooms, silence, borders, hunting, getting lost), pick a minor one at random, and retrieve on
  it. The result stays anchored in the scene but enters from an angle the model wouldn't take.
  Lateral rather than orthogonal.
- **Association graphs:** ConceptNet gives explicit hops (forest → mushroom → mycelium → network →
  rumour). Two or three hops lands in the interesting band, and the path explains why the item fits.
- **Novelty against session memory:** penalize anything close to what was already injected or written
  in this session (maximal marginal relevance), so a long session doesn't circle back to the same
  motifs.
- **Anti-prototype filter:** ask the model what it would predictably say, then exclude it. The
  research calls this the cheapest distinctive idea (R2 in [05](05-relevance-vs-novelty.md)).
- **Bisociation, for rare high-intensity moments:** pair the scene with something truly distant and
  let an LLM find the bridge. Powerful when it works; keep it behind the dial.

Caveat: embeddings capture **topic**, not **narrative function**. A vector can't express "something
that reveals character" or "something that raises the stakes". Hence the next point.

### Public datasets: preprocess them offline

Raw dataset text injected into a prompt reads clunky. Instead, run an offline LLM pass over a corpus
once, turning entries into story-ready seeds tagged with **intensity level, narrative function, tone
and setting affinity**. Then:

- tag filters handle tunability (with the dial at 2, no level-4+ item can come out),
- embeddings handle relevance,
- and the content comes from human-written sources, outside the model's distribution.

Candidates: ConceptNet and WordNet (associations, vocabulary), Wikipedia/Wikidata (facts), museum
open-access collections (level-2 objects), Project Gutenberg (imagery), folktale motif indexes
(structure). Licences vary: TV Tropes is NonCommercial and the Motif-Index status is unresolved.
Details in [06](06-datasets.md).

### 4. Integration

- Phrase injections as **offers, not commands**, with the strength scaling with intensity.
- Placement matters as much as wording: a hint at depth near the end of the prompt is more
  influential than one buried in the system prompt.
- Recording what was injected, and why, in the execution log makes tuning possible at all.

## Measuring it

Without a harness, "freshness" gets judged by vibes. Run the same opening N times and compare the
outputs side by side, then move to plot-level metrics. The research points to Sui Generis and
100-Endings, and warns that word-level metrics (distinct-n, Self-BLEU) miss the target. The research
index also proposes the experiment that decides how much infrastructure is worth building: baseline
vs. a better prompt vs. verbalized sampling vs. a retrieved seed, on the same scenes.

## Gaps in the app today

From AGENTS.md and the research survey, not from a code review:

- **No per-session state.** Cooldowns, the hazard timer, the "already injected" memory and tension
  history all need somewhere to live. Everything above depends on it. PLAN.md already lists per-chat
  variables in its backlog.
- **No random source.** Handlebars templates have no RNG, and there is no random or transform node.
- **No embeddings.** The provider adapter does chat and model listing only. Retrieval needs an
  embeddings call and a vector store: new infrastructure.
- **Templates only consume values.** Handlebars fits the integration stage; triggers, sources and
  selection are computation, so they belong in nodes.

A stateless prototype is possible today with LLM nodes alone (a rating node, a Condition node, a seed
node, a preset entry at depth). It would be crude, but enough to test the idea before building nodes.

## Where to start

1. **Per-session state**, since every trigger and novelty check needs it.
2. **A random primitive** (a node and/or a template helper) backed by table files stored like presets.
   The roll is recorded in the execution log, and regenerating a reply re-rolls.
3. **Intensity-tagged seeds and a trigger node** combining signals, noise and cooldowns.
4. **Retrieval** (embeddings, similarity band, facet pivot) over preprocessed public datasets.
5. **Role decomposition** (director, narrator, separate characters) once the above shows a gain.

Alongside step 1, the divergence harness.

## Open questions

1. **What does "enrich" mean in practice?** Mostly levels 1 to 3 (richer prose and characters), or
   plot steering too? A concrete example of a turn that felt dead, and what would have saved it, would
   help a lot.
2. **Global dial or one per layer?** "Texture high, events off" seems obviously useful, but it means
   more controls.
3. **Visible or invisible?** Should the chat show what was injected and why (great for tuning), or
   hide it?
4. **Authored or pulled?** Should users write seed tables per world, or should everything come from
   generic corpora?
5. **Interactive roleplay or co-writing?** When the user plays a character, the director has to react
   to their moves; when co-authoring, it can plan arcs more freely. The research's "who is in charge of
   pacing?" question is the same tension.
6. **Variety across sessions or within one?** Same setup, different story each time, versus keeping a
   long session from looping. They lead to different first moves (session-start seeding vs. per-turn
   triggers).
