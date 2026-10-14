# 05 — Relevance vs. novelty: retrieving material that is related but not obvious

The core retrieval question: given a scene (say, travellers in a forest at dusk), how do you pull
material that is *related enough to be motivated* but *not what the model would have said anyway*, and
not a random orthogonal item? This file first answers it with concrete recipes (section 1), then lists
the supporting literature (sections 2–5), then maps to the app (section 6).

See the [index](README.md) for the verification legend. Recipes marked **[design reasoning]** are my
synthesis of the cited work, not published methods, and none has been tested here.

## 1. The forest question: recipes

Notation: *s* is the scene embedding (or the last K turns summarised), *C* the candidate pool,
*sim* cosine similarity (or any model-specific similarity).

**Why the nearest neighbour is wrong.** Nearest neighbours of "forest at dusk" are things the LLM
already produces (owls, fog, wolves, a hermit's hut). Injecting them adds nothing; this is the
mode-collapse problem restated in retrieval terms ([01](01-diversity-and-mode-collapse.md)). Why the
far tail is also wrong: items too far from the scene cannot be motivated and read as a non-sequitur
(the "dragon"); the evidence for a curvilinear relationship is in section 3.

### R1. Band-pass on similarity rank **[design reasoning]**
Rank *C* by *sim(s, c)*. Discard the top *m* (the obvious set) and everything below rank *M*; sample
from ranks *m..M*. Use **ranks or percentiles, not absolute cosines**: embedding models differ in how
spread their similarities are, and published thresholds (e.g. the roughly 0.9–1 semantic-distance
level in [Orwig 2025](#31-orwig-et-al-2025--a-sweet-spot-for-creative-ideation)) belong to a specific
scoring model.
- Knobs: *m*, *M*. Failure: embeddings blend topical and structural similarity, so the band can be
  noisy; pools that are small make rank cuts arbitrary.

### R2. Anti-prototype filter **[design reasoning]**
Ask the model, cheaply, for the *predictable* continuations or details of this scene (a
verbalized-sampling-style call, [Zhang 2025](https://arxiv.org/abs/2510.01171)); embed them as the
"obvious set" *P*. Then select *c* maximising *sim(s, c) − μ · max_p sim(c, p)* over *p ∈ P*.
This is MMR (section 2) with the *model's own mode* in the role of the already-selected set, and is
a novelty-search move (novelty measured against an archive, [Lehman & Stanley 2011](#4-novelty-search-and-quality-diversity)).
- Knobs: μ (higher is bolder). Failure: if *P* is sampled from the same collapsed model it
  under-covers the mode; sample several times or from a different model.

### R3. Two-hop walk through a concept graph **[design reasoning]**
Take the scene's concept ("forest"). Expand to neighbours *N₁* (ConceptNet/WordNet/Wikidata edges),
expand again to *N₂*, and keep *N₂ \ (N₁ ∪ nearest-embedding-neighbours)*: things linked to forest
only *through* something else. Choose the relation types on the first hop to choose a **facet**:
sensory (property edges), social (what people do there), event (what happens there / causes).
- Example, hand-produced and illustrative, *not* a retrieval output: forest → timber/woodland trades →
  charcoal burners (glow and smoke from kilns in the dark; a trade of people who live apart); forest →
  medieval legal category → forest law and its officers; forest → acorn mast → herded pigs; forest →
  something being lost → a bell on a lost animal. All are "forest-related" yet absent from the usual
  owl-and-fog set.
- Failure: graph sparsity and noise (ConceptNet edges are crowd-sourced and uneven); two hops can drift
  into unrelated senses of a word.

### R4. Structure-mapping: keep the function, change the domain **[design reasoning]**
Abstract the scene into what it *does* ("a place that hides things and makes you lose direction"),
embed *that*, and retrieve items that satisfy the same abstraction in other domains (fog at sea, a
hall of mirrors, a library's back stacks). This follows the analogy-mining result that representations
of *purpose and mechanism*, rather than surface text, retrieve useful analogies
([Hope et al. 2017](#33-hope-et-al-2017--analogy-mining)).
- Failure: abstraction quality depends on the LLM; cross-domain items need a *fit check* (R6) because
  they are the likeliest to read as non sequiturs.

### R5. Mostly conventional, one atypical element **[design reasoning]**
Keep the scene fully conventional and add **one** atypical element per injection, never a cluster.
This mirrors the citation finding that high-impact work is mostly conventional with a minority of
unusual combinations ([Uzzi et al. 2013](#34-uzzi-et-al-2013--atypical-combinations)).

### R6. Fit check with graceful degradation **[design reasoning]**
After retrieval, ask whether the candidate can be *motivated inside the scene without contradicting
established facts*. If not, fall back to a nearer candidate or a lower intensity rung (texture instead
of a plot event). This is the explicit anti-"dragon" gate; it mirrors the beat/storylet preconditions
in [03](03-drama-management.md). Do not make this check an LLM-as-judge on *originality* (the Hivemind
and TTCW papers show judges are poor at that); use it for *plausibility* only.

### R7. Cover the space, not just the best item **[design reasoning]**
Tag pool items with a small number of descriptor axes (e.g. facet: sensory / social / event / lore;
tone; intensity rung), then choose a *cell* not used recently and pick the best-fit item within it.
This is MAP-Elites/quality-diversity applied to a retrieval pool
([Mouret & Clune 2015](#4-novelty-search-and-quality-diversity)) and guarantees variety across a long
campaign even if per-turn scoring is noisy.

### Suggested composition **[design reasoning]**
1. Candidate generation: R3 (graph walk) and/or R4 (analogy) to widen the pool.
2. Scoring: relevance to *s* within a band (R1) minus similarity to the obvious set and to previously
   injected items (R2, MMR).
3. Selection: stratified across descriptor cells (R7), one atypical element (R5).
4. Gate: fit check (R6); degrade the intensity rung on failure.
5. Delivery: as an optional hook, see [03](03-drama-management.md) and [02](02-story-generation-architectures.md).

## 2. Relevance and diversity in retrieval and recommendation

### Maximal marginal relevance
- Carbonell, J., Goldstein, J. "The Use of MMR, Diversity-Based Reranking for Reordering Documents and
  Producing Summaries", *SIGIR 1998*, pp. 335–336. https://doi.org/10.1145/290941.291025 [V]
- Summary: Greedily pick the next item that maximises a weighted combination of relevance to the query
  and *dissimilarity to items already chosen*; the weight λ trades the two. Clearest gains were in
  non-redundant multi-document summaries.
- Relevance: The standard tunable relevance/novelty trade-off, and cheap. Note its limits for this
  use: it removes *redundancy among picks*, not *obviousness* of the first pick, hence R2.

### Determinantal point processes
- Kulesza, A., Taskar, B. "Determinantal Point Processes for Machine Learning", *Foundations and
  Trends in ML* 5(2–3), 2012. https://arxiv.org/abs/1207.6083 [V]. Chen, L., Zhang, G., Zhou, H. "Fast
  Greedy MAP Inference for Determinantal Point Process to Improve Recommendation Diversity",
  *NeurIPS 2018*. https://arxiv.org/abs/1709.05135 [V; the third author's first name differs between
  sources, so check before citing].
- Summary: A probabilistic model that prefers sets of items that are both high quality and mutually
  dissimilar; the greedy MAP version is fast enough for real-time lists.
- Relevance: The set-level generalisation of MMR; relevant if the app ever injects several items at
  once and wants them mutually diverse.

### Serendipity in recommender systems
- Kaminskas, M., Bridge, D. "Diversity, Serendipity, Novelty, and Coverage: A Survey and Empirical
  Analysis of Beyond-Accuracy Objectives in Recommender Systems", *ACM TiiS* 7(1), 2016.
  https://doi.org/10.1145/2926720 [V]
- Kotkov, D., Wang, S., Veijalainen, J. "A survey of serendipity in recommender systems",
  *Knowledge-Based Systems* 111, 2016, 180–192. https://doi.org/10.1016/j.knosys.2016.08.014 [V
  citation from search; DOI string from memory — see link check]
- Summary: Serendipity is usually defined as items that are relevant *and* unexpected (often also
  novel) to the user; the surveys catalogue definitions, metrics and re-ranking strategies, and show
  that diversity, novelty and serendipity are different, correlated-but-not-identical targets.
- Relevance: Gives the vocabulary (unexpectedness *given the user's profile*) and shows the standard
  engineering pattern: retrieve for relevance, then **re-rank** for unexpectedness. Here the "profile"
  is the story so far plus what the model would predictably say.

## 3. Creativity research: how far is far enough?

### 3.1 Orwig et al. 2025 — A "sweet spot" for creative ideation
- Citation: Orwig, W., Luchini, S., Beaty, R., Schacter, D. "A 'Sweet Spot' for Creative Ideation:
  Non-Linear Associations Between Semantic Distance and Creativity", *Journal of Creative Behavior*
  59(3), e70041, 2025. https://pure.psu.edu/en/publications/a-sweet-spot-for-creative-ideation-non-linear-associations-betwee/
  [V from search]; CCN 2025 abstract
  https://2025.ccneuro.org/abstract_pdf/Orwig_2025_A_sweet_spot_creative_ideation_Non-linear.pdf
- Summary: With generalised additive models over three divergent-thinking tasks (alternate uses,
  question asking, metaphor generation), human creativity ratings rose with semantic distance up to
  a threshold and then flattened, i.e. a curvilinear rather than linear relationship.
- Relevance: The direct empirical support for a *band* (R1) rather than "maximally far". Scale is tied
  to their semantic-distance model, so recalibrate on your own embeddings.

### 3.2 Chan et al. 2017 — Semantically far inspirations considered harmful?
- Citation: Chan, J. et al. *Creativity & Cognition 2017*, pp. 93–105.
  https://doi.org/10.1145/3059454.3059455 [V]
- Summary: In an online ideation experiment (245 participants), far-away inspirations delivered while
  people were productively ideating slowed them down, reduced within-category exploration, gave no
  novelty benefit and made impasses more likely; the paper contrasts an associationist view (far is
  always better) with a view in which far helps at an impasse.
- Relevance: **Timing matters, not just distance.** Far material is better as a response to detected
  stagnation than as a standing injection while the user is productively engaged. Ties directly to
  the trigger design in [04](04-triggering-and-timing.md).

### 3.3 Hope et al. 2017 — Analogy mining
- Citation: Hope, T., Chan, J., Kittur, A., Shahaf, D. "Accelerating Innovation Through Analogy
  Mining", *KDD 2017*, pp. 235–243. https://doi.org/10.1145/3097983.3098038 ; preprint
  https://arxiv.org/abs/1706.05585 [V]
- Summary: Crowd-annotated *purpose* and *mechanism* of product descriptions train a model whose
  vectors retrieve analogies better than surface text similarity; a later IJCAI 2018 version reports an
  ideation experiment where retrieved analogies helped.
- Relevance: Supports R4: retrieve on relational structure, not words.

### 3.4 Uzzi et al. 2013 — Atypical combinations
- Citation: Uzzi, B., Mukherjee, S., Stringer, M., Jones, B. *Science* 342, 468–472.
  https://doi.org/10.1126/science.1240474 [V]
- Summary: Across 17.9 million papers, those with a conventional core of prior citations plus a small
  share of atypical combinations were disproportionately highly cited.
- Relevance: R5. Evidence is about citation networks, not fiction, so it supports a *heuristic*, not a
  parameter.

### 3.5 Measurement tools
- Olson, J. A. et al., "Naming unrelated words predicts creativity", *PNAS* 118(25), 2021.
  https://doi.org/10.1073/pnas.2022340118 [V]. Divergent Association Task: 10 words as different as
  possible, scored by average semantic distance; correlates with established creativity measures.
- Beaty, R. E., Johnson, D. R. "Automating creativity assessment with SemDis", *Behavior Research
  Methods* 53, 2021. https://doi.org/10.3758/s13428-020-01453-w [V]. Open platform; a latent factor over
  five semantic models predicted human creativity ratings.
- Relevance: Off-the-shelf recipes for turning embedding distance into a creativity proxy, usable to
  score candidate pools.

### 3.6 Classical theory
- Mednick, S. A. "The associative basis of the creative process", *Psychological Review* 69(3), 1962,
  220–232. https://doi.org/10.1037/h0048850 [V citation]. Creativity as combining remote associations;
  flatter associative hierarchies reach them more readily; basis of the Remote Associates Test.
- Koestler, A. *The Act of Creation*, Hutchinson, 1964 (bisociation: the intersection of two
  self-consistent frames of reference). [book; no link; content known only via secondary sources here]
- Fauconnier, G., Turner, M. *The Way We Think: Conceptual Blending and the Mind's Hidden
  Complexities*, Basic Books, 2002. [book; no link retrieved] Blending: elements of two input spaces
  are projected into a blended space that develops its own structure.
- Veale, T. *Exploding the Creativity Myth: The Computational Foundations of Linguistic Creativity*,
  Bloomsbury, 2012, and the Metaphor Magnet services. [book; search snippets only; I could not locate
  a citable open paper on computational blending, so treat Veale's coverage as unverified]
- Relevance: Frames R3/R4 in the creativity literature's terms. In practice these give the
  *justification* (combine two frames), not an algorithm; the algorithms are in section 1.

## 4. Novelty search and quality-diversity

- Lehman, J., Stanley, K. O. "Abandoning Objectives: Evolution through the Search for Novelty Alone",
  *Evolutionary Computation* 19(2), 2011, 189–223. https://doi.org/10.1162/EVCO_a_00025 [V]. Drop the
  objective and reward behaviours for being different from those already found; this escaped deceptive
  objectives in maze and walking tasks.
- Mouret, J.-B., Clune, J. "Illuminating search spaces by mapping elites", arXiv 2015.
  https://arxiv.org/abs/1504.04909 [V]. MAP-Elites: user-chosen descriptor dimensions define a grid;
  keep the best solution per cell, yielding a map of qualitatively different high performers.
- Pugh, J. K., Soros, L. B., Stanley, K. O. "Quality Diversity: A New Frontier for Evolutionary
  Computation", *Frontiers in Robotics and AI* 3:40, 2016. https://doi.org/10.3389/frobt.2016.00040 [V].
- Bradley, H. et al. "Quality-Diversity through AI Feedback", *ICLR 2024*.
  https://proceedings.iclr.cc/paper_files/paper/2024/hash/5b9bef4eae0f574cedbf9f4bf29d8ae7-Abstract-Conference.html
  [V]. Uses LMs both to mutate text and to judge quality and *diversity attributes* in natural language;
  fills archives for creative-writing domains (opinions of different sentiment, stories of different
  genres/endings, poetry) better than non-QD baselines.
- Relevance: Novelty is measured **relative to an archive**, which for the app is "everything already
  injected plus the recent history". QDAIF shows LLM-judged descriptors are workable in creative
  writing, which is what R7 needs.

## 5. Open questions

1. Is embedding rank a good enough proxy for "obvious"? An alternative is to measure *predictability*
   directly (does a strong LM already assign high probability to this item given the scene?).
2. Does R3/R4 candidate widening beat a well-built static pool of random-table entries? This is the
   cheapest A/B to run once the pipeline exists, and the answer decides how much infrastructure
   (embeddings, graph) is worth building.
3. Per-genre calibration: bands that work for fantasy forest scenes may not for slice-of-life; should
   bands be tied to the *intensity rung* instead (texture accepts nearer items than twists)?

## 6. Mapping to this app

| Need | App feature today | Gap |
| --- | --- | --- |
| Embeddings and nearest-neighbour search | None. PLAN.md lists "Embed / Retrieve nodes" under backlog ideas (embeddings via OpenRouter) | Not built |
| Concept-graph walk | HTTP request node could call an external graph API (e.g. ConceptNet's public API, see [06](06-datasets.md)) | Local index preferable for latency and licence reasons |
| Obvious-set generation (R2) | An LLM node with a preset works today | Needs a selection step to subtract and rank |
| Scoring/selection (MMR, band, cells) | None; no transform/code node (PLAN "More node types") | Needs a node or an LLM stand-in |
| Archive of used items | No per-chat variables (backlog) | Needed for novelty-vs-archive and for dedup |
| Candidate source | Lorebook node is a backlog item (keyword scan → injections) | The closest existing idea; retrieval is its non-keyword generalisation |

A Lorebook-style keyword trigger is the *relevance-only* baseline against which everything in this file
should be compared.
