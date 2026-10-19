# Explorations: making LLM-driven fiction less convergent and richer

Background research for a possible pipeline in which a **trigger** decides each turn whether to pull
outside material, **sources** supply it, a **selection** step balances relevance against novelty, and
the result is **injected** into prompts at a tunable intensity, from subtle texture to a plot event,
without a "and suddenly a dragon appears" effect.

These are research notes, not specs. Nothing here changes the app, and nothing is automatic: every
proposal is phrased as nodes and presets the user wires, in line with AGENTS.md ("Prompt behaviour is
chosen by the user"). Written October 2026 from web sources; see the caveats at the end.

## Files

| File | Theme | One-line takeaway |
| --- | --- | --- |
| [01-diversity-and-mode-collapse.md](01-diversity-and-mode-collapse.md) | Alignment, homogenization, samplers, verbalized sampling | Convergence lives in the distribution, not the sampler: change the *context*, not just temperature |
| [02-story-generation-architectures.md](02-story-generation-architectures.md) | Plan-and-write, Re3/DOC, Dramatron, agents | Plan-then-prose chains are workflow topologies; novelty is cheapest at the planning step |
| [03-drama-management.md](03-drama-management.md) | Façade, L4D Director, storylets, suspense | Gate → choose → shape; Left 4 Dead's pacing is a five-rule state machine |
| [04-triggering-and-timing.md](04-triggering-and-timing.md) | Stagnation detection, hazard/cooldown scheduling | Model injection as a hazard with a refractory window, modulated by signals |
| [05-relevance-vs-novelty.md](05-relevance-vs-novelty.md) | MMR, QD, creativity theory, the forest question | Band-pass plus anti-prototype filter plus fit check; one atypical element at a time |
| [06-datasets.md](06-datasets.md) | ConceptNet, Wikipedia, motifs, tropes, museums, tables | Match source to intensity rung; mind ShareAlike/NonCommercial and the unresolved motif-index status |
| [CREATIVITY.md](CREATIVITY.md) | Design notes from the brainstorm this research supports | Trigger → source → selection → integration, with an intensity dial; open questions |
| [STATE-DESIGN-PROPOSAL-3.md](STATE-DESIGN-PROPOSAL-3.md) | The state design as built (phases 1–7); earlier proposals and reviews are in git history | Chat settings (user-owned), story state (follows replies), summaries as linked story state items, authored collections read by Recall and Draw, post-turn runs, a Trigger node |
| [STATE-DESIGN-AMENDMENT-1.md](STATE-DESIGN-AMENDMENT-1.md) | Amendment to proposal 3 after phase 6 | Any collection item can link to chat messages; summaries become linked story state items, written by State Write and read through generic nodes (Next Chunk, Unlinked Messages, a `linked` helper) |

## Legend: verification tags

Every source carries a tag. A tag describes what *I* checked, not whether the paper is right.

- **[P]** primary content read: the paper's PDF, the dataset page, or the slides themselves.
- **[V]** bibliographic record confirmed (arXiv, ACL Anthology, proceedings or publisher page, found by
  search); content summarised from the abstract or record, not the full paper.
- **[S]** secondary or partial: a blog, wiki, search snippet, or a page that blocked my fetch. Use as a
  lead, verify before citing.
- **[unverified]** could not be retrieved at all; cited from memory or marked as a gap.

### Link check (2026-10-14)

Titles, not just reachability: every arXiv ID cited (40) was pulled from the arXiv API and every DOI
(14) from Crossref, and the returned title and first authors were compared with what the files claim.
All matched. One correction came out of it: the Dramamancer preprint's real title is "Design
Techniques for LLM-Powered Interactive Storytelling: A Case Study of the Dramamancer System".

All 96 distinct URLs in these files were requested with `curl` (HEAD, then a one-byte GET).

- 85 returned HTTP 200 (including every arXiv, ACL Anthology, AAAI, ICLR, NeurIPS, GitHub, Valve and
  institutional link).
- 9 are publisher DOIs that answer 403 to scripts: Mednick 1962, Olson 2021, Doshi & Hauser 2024, Uzzi
  2013, Carbonell & Goldstein 1998, Kaminskas & Bridge 2016, Chan 2017, Hope 2017, Lehman & Stanley
  2011. One more (Schmidhuber 2010) answered 202. For all ten I confirmed the DOI is registered
  through the doi.org handle API, but could not load the landing page, so the *content* behind them is
  only as verified as the tags say.
- 1 page (the WordNet licence page) answers 403 to HEAD and 206 to a ranged GET, i.e. it is
  reachable.
- 403/429 responses seen earlier during research, with no usable retrieval: tvtropes.org terms page,
  metmuseum.org policy page, si.edu open-access page. Their claims in [06](06-datasets.md) rest on
  GitHub pages, Wikipedia or secondary sources and are tagged accordingly.

## Synthesis

### The most promising ideas

1. **Inject into the context, not the sampler.** Across [Kirk 2024], [Xu 2025] and [Jiang 2025] the
   evidence points the same way: alignment narrows the *distribution*, so plot elements repeat even when
   words vary, and other model families converge on the same answers. Sampler work (min-p, XTC,
   top-nσ) mostly treats degeneration at high temperature; min-p's own evidence is disputed. So the
   source → selection → injection pipeline is aimed at the right layer.
2. **Gate, then choose, then deliver as an offer.** Every successful interactive-narrative system pairs
   eligibility *preconditions* (Façade beats, storylets, salience-based selection) with a selector and
   a motivated delivery. The LLM-era work (CALYPSO, Drama Llama) keeps this and has the model *use* an
   offered hook instead of obeying it. That is the structural answer to the dragon.
3. **Pacing as a small state machine.** The L4D Director's slides give a complete, tested pattern:
   an intensity value that rises with events and decays, a build-up/peak/relax loop, a minimum build-up,
   and a refractory relax window that waits for the current event to play out. Port the *shape*, not
   the numbers.
4. **"Related but not obvious" as a band, plus an anti-prototype filter.** Creativity research shows a
   curvilinear distance–creativity relation ([Orwig 2025]) and that far material helps at an impasse
   and hurts mid-flow ([Chan 2017]). Recipes R1–R7 in [05](05-relevance-vs-novelty.md) combine a
   similarity band, an exclusion set built from what the model would predictably say, two-hop concept
   walks and a plausibility check. The cheapest distinctive idea is R2: use the model's own mode as the
   thing to avoid.
5. **Intensity ladder tied to source type.** Texture ← concrete objects and encyclopaedic oddities;
   hint ← two-hop associations; complication ← consequence data (ATOMIC, oracle tables); twist ←
   structural seeds (motifs, tropes). Lower rungs tolerate nearer matches; higher rungs require a pass
   through the plausibility gate.
6. **Measure plot-level change, not word-level.** Sui Generis ([Xu 2025]) and 100-Endings ([Sui 2026])
   are the best-fitting metrics; distinct-n and Self-BLEU miss the target.

### Addressing the "dragon" effect directly

It is a composition of five separable failures, each with a known remedy (table in
[03](03-drama-management.md)): no relevance gate; wrong moment; repeated or clocked events; injected
content treated as a command; and mismatch of intensity with the scene. A pipeline that includes a
relevance gate, a refractory window, an optional-hook phrasing, a plausibility fit check and an
intensity ladder addresses all five. None of this requires a smarter source; a better *gate* beats a
better *pool*.

### Dependencies on app features that do not exist yet

From reading the engine and PLAN.md (not from the literature):

| Needed by | Missing feature | Where it is today |
| --- | --- | --- |
| Hazard/cooldown scheduling, novelty-vs-archive | Per-chat variables | PLAN.md backlog ("Per-chat variables & author's note") |
| Stochastic triggers, random-table rolls | A random source (no random/transform node; Handlebars templates have no RNG) | Not in PLAN.md; related "code/JS node" under Later |
| Similarity band, MMR, cell sampling | A transform/selector node | PLAN.md Later: "More node types" |
| Semantic retrieval | Embed / Retrieve nodes | PLAN.md backlog ("Vector storage / RAG") |
| Keyword-gated relevance baseline | Lorebook node | PLAN.md backlog |
| min_p / top_k / XTC, etc. | LLM node sampler fields | PLAN.md backlog; `extraBody` on the provider record is the raw escape hatch; this survey makes no claim about which backends accept XTC |
| Plausibility and tension estimation | None; an LLM node with a preset can do it today | Works now |

A stateless prototype is possible today with LLM nodes only: one node rates intensity/stagnation from
the last N messages, a Condition node (gt/lt on that number) gates, a second node proposes the seed,
a preset entry at depth delivers it as a hint. Expect it to be crude; it is a way to test the idea
before building nodes.

### Open questions

1. **Does retrieval beat prompting?** [Meincke 2024] shows prompt design alone raises idea diversity.
   The experiment that decides how much infrastructure is justified: same scenes, N regenerations, with
   (a) baseline, (b) better prompt, (c) verbalized sampling plus tail pick, (d) retrieved seed. Compare
   Sui Generis and embedding dispersion, plus coherence ratings.
2. **Which intensity estimator?** An LLM rating, a sentiment proxy and 100-Endings forecasting have not
   been compared on co-written, user-driven fiction.
3. **Who is in charge of pacing?** In co-written fiction the user steers. Reactive-only injection is
   safe but may not break stagnation; proactive injection risks overriding the user's thread. The
   authorial-leverage trade-off in [03](03-drama-management.md) applies, and [Chan 2017] suggests
   firing on detected impasse rather than during flow.
4. **Calibration.** Bands and thresholds depend on the embedding model and on genre; are they better
   tied to the intensity rung than set globally?
5. **Judge reliability.** [Jiang 2025] and [Chakrabarty 2024] report that LLM judges are poor on
   originality. Which selection and gate checks can safely use an LLM (plausibility) and which cannot
   (surprise)?
6. **Licensing of structural sources.** The Motif-Index and ATU are the best fit for event seeds and
   have unclear or restricted rights; TV Tropes is NonCommercial. Is there an open equivalent
   (Wikipedia tale-type articles, Gutenberg collections) of good enough granularity?
7. **Stacking.** The studies here test single interventions. Whether sampler, prompt, retrieval and
   gating effects add up or cancel is untested.

## Caveats on this survey

- Written from web search and page fetches; the full text of most papers was **not** read. Tags show
  which. Specific numbers are quoted only where a source was read.
- Several 2026 entries (Spoiler Alert, Fabula, Dramamancer) are very recent preprints; their venues and
  claims may change.
- Contested or uncertain items are flagged inline: min-p ([01](01-diversity-and-mode-collapse.md)),
  the Hivemind-and-min-p claim (dropped), RimWorld cadence figures (version-dependent wiki), TV Tropes
  licence (unconfirmed from source), Motif-Index/ATU copyright (unresolved), Rijksmuseum data licence
  (unconfirmed).
- Publishing details I know that differ between sources: Kirk et al. is ICLR **2024**; Chakrabarty et
  al. is CHI **2024** (arXiv 2023); Reagan et al. report 1,327 stories in the published version versus
  1,737 in the preprint.

[Kirk 2024]: 01-diversity-and-mode-collapse.md
[Xu 2025]: 01-diversity-and-mode-collapse.md
[Jiang 2025]: 01-diversity-and-mode-collapse.md
[Meincke 2024]: 01-diversity-and-mode-collapse.md
[Chakrabarty 2024]: 01-diversity-and-mode-collapse.md
[Orwig 2025]: 05-relevance-vs-novelty.md
[Chan 2017]: 05-relevance-vs-novelty.md
[Sui 2026]: 03-drama-management.md
