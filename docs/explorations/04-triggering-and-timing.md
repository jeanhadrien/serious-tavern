# 04 — Triggering and timing: when to inject new content

The question "should this turn pull outside material at all?" has three sub-problems: *detecting* that
the story needs it (stagnation, repetition, flat tension), *deciding* when (scheduling, cooldowns) and
*how hard* to push (intensity). The literature is thinner here than for generation, so this file mixes
citations with explicit design reasoning. Sections are labelled **[cited]** or **[design reasoning]**
accordingly.

See the [index](README.md) for the verification legend.

## What this means for the app (short version)

- Two kinds of signal are available from the chat history alone, with no new infrastructure beyond one
  extra LLM or HTTP node: *repetition/stagnation* signals (lexical or embedding overlap with recent
  turns, repeated phrases) and *tension/interest* signals (an LLM rating; see
  [03](03-drama-management.md)).
- Scheduling is best modelled as a **hazard function** over "turns since last injection", gated by a
  refractory window and modulated by those signals. This is design reasoning, not a published method.
- Today's engine has the pieces for the gate (Condition node: equals/contains/regex/isEmpty/gt/lt over a
  rendered template, with True/False branches) but **no random source and no cross-turn state**: the
  node catalogue is chat-input, chat-output, character, condition, http-request, llm, memory, merge, and
  there is no per-chat variable store (PLAN.md backlog). A stochastic trigger therefore needs either an
  LLM node asked for a random-looking number (poor quality), an HTTP call to a random service, or a
  future Random/Transform node. Flag this dependency early.

## 1. Detecting repetition and stagnation

### Within-text degeneration **[cited]**

- **Self-reinforcing repetition.** Xu, Liu, Yan, Cai, Li, Li, "Learning to Break the Loop: Analyzing
  and Mitigating Repetitions for Neural Text Generation", *NeurIPS 2022*.
  https://arxiv.org/abs/2206.02369 [V]. Human text almost never repeats a sentence consecutively
  (0.02% on Wikitext-103 in their count); models do, and the more a sentence appears in context, the
  likelier it is to be produced again (a self-reinforcement effect). Their fix (DITTO) is training-time.
  Relevance: the mechanism is *context-driven*, so long chats with a repetitive history will drift into
  loops. Pruning or summarising history is a mitigation the app can apply.
- **Mirostat's traps.** Basu et al., *ICLR 2021*. https://arxiv.org/abs/2007.14966 [V]. Low
  k/p lowers perplexity over a generation (boredom trap, repetition); high k/p raises it (confusion
  trap). Relevance: confirms that "stagnation" and "incoherence" sit on one axis that decoding alone
  moves along.
- **Metrics.** distinct-n (Li et al., NAACL 2016, https://aclanthology.org/N16-1014/ [V]) and
  Self-BLEU (Zhu et al., SIGIR 2018, https://arxiv.org/abs/1802.01886 [V]).

### Across turns **[design reasoning]**

Cheap indicators computed over the last K assistant messages:

| Indicator | How | Catches |
| --- | --- | --- |
| Shared n-gram rate with previous turns | Fraction of 4-grams in the new draft already present in the last K replies | Verbatim loops, reused stock phrases |
| Embedding similarity between consecutive replies | Cosine similarity of reply embeddings, compare to a threshold | Same beat re-described in new words |
| Entity/location churn | Count new named entities or places over the last K turns | A scene that has stopped developing |
| "Slop" phrase hits | Match against a list of over-used phrases (see Antislop in [01](01-diversity-and-mode-collapse.md)) | Stylistic exhaustion |
| LLM judge | One short call: "has anything new happened in the last K turns?" | Semantic stagnation; costly, biased toward consensus ([Jiang 2025](https://arxiv.org/abs/2510.22954)) |

None of these has been validated for interactive fiction in the literature I found; thresholds must be
tuned on the user's own sessions. The first three need a code/transform node (not in the catalogue
yet); the LLM judge works today.

## 2. Why "stagnation" should trigger novelty at all: interest and novelty as drives

### Schmidhuber 2010 — Formal theory of creativity, fun and intrinsic motivation **[cited]**
- Citation: *IEEE Transactions on Autonomous Mental Development* 2(3), 230–247.
  https://doi.org/10.1109/TAMD.2010.2056368 [V]
- Summary: An agent is rewarded for finding patterns that make its predictor/compressor *improve*:
  not for raw surprise, and not for the already-predictable. What is interesting is what is currently
  unpredictable but learnable.
- Relevance: States the target precisely: injected material should be surprising *and* assimilable.
  This is the formal version of the "related but not obvious" requirement in
  [05](05-relevance-vs-novelty.md). An actionable proxy: reject candidates the narrator model finds
  trivially predictable *or* incoherent.

### Kidd, Piantadosi, Aslin 2012 — The Goldilocks Effect **[cited]**
- Citation: *PLoS ONE* 7(5): e36399. https://doi.org/10.1371/journal.pone.0036399 [V]
- Summary: Seven- and eight-month-old infants looked away from sequences that an ideal-learner model
  rated as very simple or very complex, attending most to intermediate ones.
- Relevance: Empirical grounding for an inverted-U between predictability and engagement. Evidence is
  from infants and visual sequences, so use it as motivation, not as a parameter source.

### Berlyne's inverted-U (Wundt curve) **[unverified — not retrieved]**
Berlyne's work on arousal and hedonic value (*Conflict, Arousal, and Curiosity*, 1960;
*Aesthetics and Psychobiology*, 1971) is the classical source for "pleasure peaks at intermediate
novelty". I did not retrieve the primary texts, so cite them only after checking.

### Experience-driven procedural content generation **[cited]**
- Yannakakis & Togelius, "Experience-Driven Procedural Content Generation", *IEEE Transactions on
  Affective Computing* 2(3), 2011, 147–161. https://pure.itu.dk/en/publications/experience-driven-procedural-content-generation/
  [V from search; full text not read]
- Summary: Frame content generation as optimisation against a *model of player experience*, with a
  taxonomy of PCG methods.
- Relevance: The generic framework for "estimate how the player is doing, then generate for that".
  Fits the stagnation-detector → injection loop as one instance.

## 3. Event-scheduling practice in games

### Left 4 Dead director **[cited, primary read]**
See [03](03-drama-management.md): intensity value with decay, Build Up / Sustain Peak / Peak Fade /
Relax; Relax is a refractory window of 30–45 s in game time (Booth 2009). Peak Fade explicitly
refuses to start Relax until the action has played out, so the quiet period is not eaten by the tail of
the previous event.

### RimWorld storytellers **[secondary sources; version-dependent]**
- Source: community wiki pages for the storytellers (e.g. https://rimworldwiki.com/wiki/Storyteller).
  [S: wiki, not the developer; exact day counts changed between versions, so none are repeated here.]
- Summary: A "storyteller" repeatedly picks incidents from a weighted pool against a threat budget that
  grows with colony size and wealth (with diminishing returns); different storytellers differ mainly in
  the *cadence* of major threats (steady, long-gap, or random magnitude), not in what is available.
  Recent colonist deaths and time since the last major event are reported inputs.
- Relevance: A cleaner separation than L4D's: **budget** (how much can be spent), **cadence** (when),
  **pool** (what). Three independently configurable parts map to three nodes or three preset inputs.
  Different "storytellers" = different cadence presets the user can swap.

### Crusader Kings "mean time to happen" **[secondary sources: forum posts]**
- Source: Paradox forum threads on event scripting and MTTH (e.g.
  https://forum.paradoxplaza.com/forum/threads/event-scripting-tricks-and-traps-explained.140230/). [S]
- Summary: An event is not scheduled at a date; each check rolls a probability derived from a stated
  mean time, with trigger conditions and weight modifiers that scale it. A one-year mean can fire in
  days or never, and the engine evaluates the rolls on a fixed interval.
- Relevance: The simplest honest model of "events happen at random but with a typical timescale": an
  eligibility gate (conditions) plus a rate (the mean time) plus modifiers.

## 4. A scheduling model for turn-based text **[design reasoning, not a citation]**

Let *t* be the number of turns since the last injection and *p(t)* the probability of injecting on
this turn (the discrete hazard).

1. **Constant hazard** *p(t) = p₀*: memoryless; waiting time is geometric (the discrete analogue of the
   exponential). This is exactly what an MTTH rule is. Drawback: it produces both bursts and long
   droughts, which is what the user is trying to avoid.
2. **Refractory window** *p(t) = 0 for t < r*: the L4D Relax period. Guarantees breathing room and
   prevents consecutive injections. Pair with a "do not start while the previous injection is still
   being played out" check (Peak Fade).
3. **Rising hazard** *p(t) = min(p_max, p₀ + k·(t − r))* after the window: a soft "pity timer" so the
   expected gap is bounded without being fixed. A Weibull hazard with shape > 1 is the standard smooth
   version.
4. **Signal modulation** *p ← p · f(stagnation) · g(1 − intensity)*: boost when repetition or low
   novelty is detected; suppress while tension is already high or when the user is mid-thread.
5. **Budget** (RimWorld-style): each injection costs points by intensity rung (texture 1, complication
   3, twist 8), points regenerate per turn, and a rung can only fire when its cost is affordable. This
   gives "mostly texture, occasionally a complication, rarely a twist" without separate probabilities.

The intensity ladder (texture → hint → complication → mandated beat) is a **separate output** of the
trigger: the gate decides *whether*, the budget or tension decides *which rung*, and the retrieval step
in [05](05-relevance-vs-novelty.md) decides *what*.

### Needed state and where it lives
| State | Used by | Today |
| --- | --- | --- |
| Turns since last injection | Hazard, refractory | Derivable from history if injected turns leave a marker, but no per-chat variable store (PLAN.md backlog) |
| Intensity (decaying) | Modulation, ladder | Re-estimate per turn with an LLM, or store |
| Budget points | Ladder | Needs storage |
| Injected-seed log | Dedup, avoiding repeats | Needs storage; or encode into a hidden message |
| Random draw | Stochastic firing | No random node; see the top of this file |

### Reading the signal without state
A stateless variant is viable: re-derive "turns since last injection" by scanning the history for a
marker the injection step writes into the assistant message metadata or a leading tag (the user would
need to wire that). It couples message content to control flow, so a real variable store is cleaner.

## 5. Open questions

1. Is a deterministic schedule (refractory + rising hazard with no randomness) enough? Randomness adds
   unpredictability, but with a diverse enough source the *content* may already supply the variation.
2. Should the user be able to see and veto a pending injection (a "next beat" preview)? Dramatron's
   user study suggests professionals want to edit between layers ([02](02-story-generation-architectures.md)).
3. How to attribute success: did the injection raise tension/novelty without lowering coherence? Needs
   an offline harness with Sui Generis ([01](01-diversity-and-mode-collapse.md)) and a tension measure
   ([03](03-drama-management.md)).
