# 03 — Drama management and experience management

Interactive-narrative research has spent thirty years on the problem this project is circling: a system
that watches a story unfold and decides what the world does next, without wrecking the player's
agency or the story's coherence. This file collects that literature, the game-industry precedents, and
the (small) LLM-era follow-ups.

See the [index](README.md) for the verification legend.

## What this means for the app (short version)

- The recurring architecture is **gate → choose → shape**: (1) author-written *preconditions* decide
  which content is eligible *right now*; (2) a *selector* picks among the eligible items, usually with a
  quality or arc score; (3) the content is delivered through a character or beat so it feels motivated.
  The "dragon appearing" failure is a missing gate, not a missing source.
- Pacing in the one fully documented industrial case (Left 4 Dead) is a small **state machine over an
  intensity value that decays**, with a forced low-intensity window after each peak. That is simple
  enough to build from a Condition node plus per-session state.
- LLM-era systems keep the author's structure and use the model to *instantiate and trigger* content
  inside it (storylets, beats, schemas), not to direct the story freely.

## 1. Classical drama managers and experience management

### Riedl & Bulitko 2013 — Interactive Narrative: An Intelligent Systems Approach
- Citation: Riedl, M. O., Bulitko, V. *AI Magazine* 34(1), 2013, from p. 67.
  https://ojs.aaai.org/index.php/aimagazine/article/view/2449 [V]
- Summary: The standard survey of roughly two decades of interactive-narrative AI: an *experience
  manager* is an intelligent agent that observes the user and changes the world to keep the
  experience coherent and well-shaped while preserving meaningful user influence. Covers search-based,
  planning-based, declarative and case-based managers and the authorial-burden problem.
- Relevance: Vocabulary and taxonomy to use in design discussions. I only confirmed the abstract and
  scope in my search; read sections on authorial leverage before borrowing specifics.

### Search-based and declarative-optimization drama management
- Sources: Weyhrauch 1997 (thesis, origin; not retrieved); Nelson & Mateas, "Search-Based Drama
  Management in the Interactive Fiction Anchorhead", *AIIDE 2005*
  https://ojs.aaai.org/index.php/AIIDE/article/view/18723 [V]; Nelson et al., "Declarative
  optimization-based drama management in interactive fiction", *IEEE Computer Graphics and
  Applications* 2006 (title and venue [V]; author list not checked)
  https://www.kmjn.org/publications/DODM_IEEECGA-abstract.html.
- Summary: Story = a set of authored *plot points*; the drama manager has a menu of actions (hint,
  deny, cause, temporarily block an event) and an author-defined story-quality function; it searches
  for the action sequence that maximises expected quality. Later work found search scales poorly to
  large stories and moved to reinforcement learning.
- Relevance: The same two ingredients (plot-point menu + quality function) show up in every later
  system. For an LLM app the quality function can be an LLM rubric or a tension target; the menu is the
  set of injectable seeds.

### Mateas & Stern 2003 — Façade
- Citation: Mateas, M., Stern, A. "Integrating Plot, Character and Natural Language Processing in the
  Interactive Drama Façade", *TIDSE 2003*.
  https://users.soe.ucsc.edu/~michaelm/tenurereview/publications/mateas-tidse2003.pdf [V from search,
  link location unconfirmed]
- Summary: Content is a pool of **story beats**. Each beat has authored preconditions, effects on
  story values, and its own reactive behaviours and dialogue. A drama manager sequences beats so that
  a global tension value follows an Aristotelian arc; only one beat is active at a time, but beats can
  interrupt or interleave.
- Relevance: The most direct ancestor of "precondition-gated, tension-aware event selection". Beats
  can be mapped to preset entries; preconditions to Condition-node logic or template `{{#if}}` blocks.

### Booth 2009 — The AI Systems of Left 4 Dead (the AI Director)
- Citation: Booth, M. (Valve). Slides from the AIIDE 2009 invited talk.
  https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf [P: read]
- Summary (from the slides): the Director estimates each Survivor's "emotional intensity" as a number
  that rises with damage taken, incapacitation, being knocked off ledges, and nearby infected dying
  (inversely with distance), and **decays toward zero over time** unless enemies are actively engaging
  them. It tracks the maximum across the four players and runs a four-phase loop: **Build Up** (full
  threat population until intensity crosses a peak threshold) → **Sustain Peak** (3–5 s more, so
  build-up has a minimum length) → **Peak Fade** (minimal threats until intensity leaves the peak
  range, so the fight can play out) → **Relax** (minimal threats for 30–45 s, or until the team has
  progressed far enough) → Build Up again. Boss encounters are exempt from adaptive pacing. The slides
  frame the motivation as avoiding both fatiguing constant combat and boring inactivity.
- Relevance: A complete, shippable pacing algorithm in about five rules. Direct analogues for a text
  app: intensity = a rating of recent turns; decay = turns without escalation; Relax = a refractory
  window where no injected complication is allowed. The numbers (3–5 s, 30–45 s) are game-time and
  have no direct text equivalent.
- Verification note: earlier secondary summaries I saw quoted additional numbers (stress thresholds,
  spawn-reduction percentages) that are **not** in these slides; do not use them.

### Hunicke & Chapman 2004 — AI for Dynamic Difficulty Adjustment (Hamlet)
- Citation: *AAAI Challenges in Game AI Workshop*, 2004, pp. 91–96.
  https://users.cs.northwestern.edu/~hunicke/pubs/Hamlet.pdf [V from search]
- Summary: Hamlet (Half-Life engine) estimates player performance and adjusts game "inventory" supply
  and demand, borrowing inventory theory, to keep challenge in the playable band.
- Relevance: The same "estimate state → bias supply" loop as the Director, applied to difficulty.
  For a story app, "difficulty" is closer to *plot pressure*.

## 2. Storylets and quality-based narrative

### Short 2016 — Beyond Branching
- Citation: Short, E. "Beyond Branching: Quality-Based, Salience-Based, and Waypoint Narrative
  Structures", blog, 2016-04-12.
  https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/
  [V from search; post not fully re-read]
- Summary: Names the two structures. **Quality-based narrative** (Failbetter Games' term): content
  units ("storylets") are unlocked by numeric *qualities* of the player and world (skills, relationships,
  progress). **Salience-based narrative** (Short's coinage): the system picks the content element that
  best matches the current world state instead of presenting everything unlocked.
- Relevance: The two vocabulary items needed to specify the "relevance gate" a source must pass
  before injection. Salience-based selection is essentially "retrieve, but constrained by state".

### Kreminski & Wardrip-Fruin 2018 — Sketching a Map of the Storylets Design Space
- Citation: *ICIDS 2018*, Springer, pp. 160–164. Overview via
  https://emshort.blog/2019/01/06/kreminski-on-storylets/ [S] (paper text not retrieved).
- Summary (via the blog): four design axes — how preconditions are defined, whether storylets can
  repeat, what a storylet contains (linear text, grammars, branching), and the *content selection
  architecture*. Introduces parametrised storylets whose slots can be filled by any entity.
- Relevance: A checklist for designing the app's own "event card" format: preconditions, repeatability,
  slot-filling, selection rule.

### Kreminski et al. — story sifting
- Felt: Kreminski, Dickinson, Wardrip-Fruin, "Felt: A Simple Story Sifter", *ICIDS 2019*;
  code https://github.com/mkremins/felt [citation V, text not read].
- Winnow: Kreminski, Dickinson, Mateas, "Winnow: A Domain-Specific Language for Incremental Story
  Sifting", *AIIDE 2021*. https://ojs.aaai.org/index.php/AIIDE/article/view/18903 [V]. Detects
  "storyful" event sequences *while they are still unfolding*.
- Shepherd: Deo, Chung, McCoy, "Shepherd: An Incremental Story Sifting-Based Drama Manager",
  *AIIDE 2024*, 20(1), 256–259. https://ojs.aaai.org/index.php/AIIDE/article/view/31887 [V]. Uses
  incremental sifting to steer an autonomous simulation toward narratively interesting choices without
  human intervention. (It is not by Kreminski; it builds on his sifter work.)
- Also listed, not read: Kreminski et al., "Select the Unexpected: A Statistical Heuristic for Story
  Sifting", *ICIDS 2022* [title only].
- Relevance: Sifting is *pattern recognition over what already happened*. For this app it suggests
  using the chat history as the event log, and recognising "a thread is open / a Chekhov's-gun is
  pending" instead of injecting unrelated content.

## 3. LLM-era interactive narrative

| Work | Idea | Source | Status | For this app |
| --- | --- | --- | --- | --- |
| Drama Llama (Sun, Wang, Chung et al., 2025) | Storylets whose triggers are written in natural language and evaluated by an LLM; LLM also handles responsiveness. Six-author pilot. | https://arxiv.org/abs/2501.09099 | [V] preprint | Natural-language trigger ≈ an LLM node producing a yes/no or a number that feeds a Condition node; the storylet body is a preset entry. |
| Dramamancer (Wang, Sun, Wang et al., 2026): "Design Techniques for LLM-Powered Interactive Storytelling: A Case Study of the Dramamancer System" | LLM turns author-written story schemas into player-driven playthroughs; extended abstract, Wordplay workshop. | https://arxiv.org/abs/2601.18785 | [V] title matched; abstract-level | Schema = the user's authored plan; a source of design techniques, not an algorithm. |
| From Role-Play to Drama-Interaction (Wu et al., 2024) | "Drama LLMs" with a *Narrative Chain* to control progression during interaction. | https://arxiv.org/abs/2405.14231 | [S] title matched, content from snippet | Relevant only as a pattern (explicit progression state); needs fine-tuning, so not directly usable via hosted APIs. |
| Fabula (Mirowski, Wedin, Amplayo et al., 2026) | LLM "drama manager" over scenes and beats for writers. | https://arxiv.org/abs/2606.14411 | [S] title matched, content from snippet | Same scene/beat hierarchy as Dramatron; confirm details before relying on it. |

Pattern: authors keep schemas/storylets; the LLM evaluates natural-language triggers and renders
content. That is the opposite of unconstrained free-form direction, and it matches the "nothing is
automatic; the user wires it" principle in AGENTS.md.

## 4. Pacing, tension and suspense models

### Emotional-arc shapes
- Reagan, Mitchell, Kiley, Danforth, Dodds, "The emotional arcs of stories are dominated by six basic
  shapes", *EPJ Data Science* 5 (2016). https://doi.org/10.1140/epjds/s13688-016-0093-1 [V from
  search]. Sentiment trajectories of Project Gutenberg fiction cluster into six core arcs; some arcs
  were associated with more downloads. (Corpus size differs between preprint, 1,737, and published
  version, 1,327; use the published figure.) Relevance: a small, citable library of target tension
  curves to steer toward; sentiment is a crude proxy for tension.

### Computational suspense
- Cheong & Young, "Suspenser: A Story Generation System for Suspense", *IEEE T-CIAIG* 2015 (PhD thesis
  2007). https://www.cs.uky.edu/~sgware/reading/papers/cheong2015suspenser.pdf [V from search]. Suspense
  is tied to how few solutions the protagonist has to a threat; the system chooses which events to
  surface in the discourse to control suspense.
- O'Neill & Riedl, "Dramatis: A Computational Model of Suspense", *AAAI 2014*.
  https://ojs.aaai.org/index.php/AAAI/article/view/8836 [V]. Suspense correlates with the audience's
  ability to find a plan for the protagonist to avoid a bad outcome; the model estimates the
  likelihood that such a plan succeeds and matched human ratings in three domains. Both models rest on
  Gerrig & Bernardo (1994) [cited via these papers, not read] and need a symbolic planner with
  hand-built action spaces.
- Wilmot & Keller, "Modelling Suspense in Short Stories as Uncertainty Reduction over Neural
  Representation", *ACL 2020*. https://aclanthology.org/2020.acl-main.161/ [V]. A hierarchical LM; the
  best predictor of human suspense judgements was *uncertainty reduction over story representations*
  (how much the next event narrows the possible futures), close to human accuracy.
- Sui, Zhu, Cheng, West, So, Long, Holtzman, "Spoiler Alert: Narrative Forecasting as a Metric for
  Tension in LLM Storytelling", arXiv 2604.09854, 2026. https://arxiv.org/abs/2604.09854 [S: venue
  unsettled — an ICML 2026 listing exists; a secondary source mentions COLM 2026]. **100-Endings**:
  at each sentence a model forecasts the ending 100 times from the text so far; tension is how often
  forecasts miss the true ending, and an "inflection rate" counts reversals of the curve. Rubric LLM
  judges rated zero-shot LLM stories above New Yorker stories, while 100-Endings ranked the New Yorker
  stories far above. A generation pipeline with templates and scaffolding raised measured tension.
- Relevance: The two LLM-compatible suspense measures are both *forward-looking uncertainty*
  measures. They give a way to estimate tension from history alone (no symbolic planner). Cost is high
  (100 samples per sentence) but the brief says cost is not a concern.

## 5. Putting it together: the "dragon" problem in this vocabulary

| Failure | Which mechanism prevents it | Where it comes from |
| --- | --- | --- |
| Event unrelated to current situation | Precondition gate over scene state | Façade beats, storylets/QBN, salience-based selection |
| Event arrives at a calm, intimate moment | Tension-aware gating (only inject complication when intensity is low-to-medium *and* not just after a peak) | Façade arc, L4D Build Up / Relax |
| Event shows up twice in a row, or on a timer | Refractory window; repeatability flag | L4D Relax window; storylet repeatability |
| Event is a command the narrator must obey | Offer as optional hook the model may adopt or decline | CALYPSO |
| Event contradicts established facts | Plan before prose; check against facts | Re3/DOC edit step, Dramatron layers |
| Event is loud, so it dominates | Scale intensity: texture < complication < twist; reserve the top rung for peaks | L4D thresholds, Façade tension curve |

## 6. Mapping to this app

- **Gate** = Condition node (exists) fed by something that classifies the scene or the last turns.
  Without a code node, the classifier is an LLM node that outputs a short label or number.
- **State** (intensity, turns since last injection, injected-seed log) needs per-chat variables, which
  are a PLAN.md backlog item. A stateless approximation: re-derive intensity each turn from the last
  N messages (costs one LLM call per turn, but needs nothing stored).
- **Delivery** = a system-role preset entry at a chosen depth, worded as an optional hook.
- **Selection** = see [05](05-relevance-vs-novelty.md); **timing** = see
  [04](04-triggering-and-timing.md).

Open questions:

1. Which intensity estimator is good enough and cheap enough: a one-number LLM rating, a sentiment
   proxy, or 100-Endings-style forecasting? No study compares them on interactive, user-driven text.
2. In co-written fiction the *user* drives pacing. Should the director be reactive only (never inject
   when the user is mid-thread) or proactive (a Director that escalates after stagnation)? Face the
   authorial-leverage trade-off Riedl & Bulitko discuss.
