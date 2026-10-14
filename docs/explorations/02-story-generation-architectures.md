# 02 — Story generation architectures

How the research community structures LLM story generation beyond "one prompt, one reply": planning,
decomposition, revision, and multi-agent simulation. Mapped onto what a node-workflow app can already
express.

See the [index](README.md) for the verification legend.

## What this means for the app (short version)

- Almost every architecture below is a **prompt chain** (premise → outline → beats → prose, optionally
  with revision). A workflow DAG of LLM nodes with presets is a natural host for that; "planning step
  before prose" is a topology, not a new feature.
- The cheapest place to add novelty is the *planning* stage: variety injected into a plan or a beat
  list propagates into prose, whereas variety injected into prose is cosmetic (see
  [01](01-diversity-and-mode-collapse.md)).
- Interactive fiction differs from the long-form generation these papers target: the story is
  co-written turn by turn with a human, so what matters is a *local* planner ("what could happen next
  here") rather than a global outline fixed upfront. The closest literature is in
  [03](03-drama-management.md) (drama managers, storylets) and the CALYPSO/Drama-Llama line below.

## 1. Planning and hierarchical generation

### Fan, Lewis, Dauphin 2018 — Hierarchical Neural Story Generation
- Citation: *ACL 2018*. https://arxiv.org/abs/1805.04833 [V; PDF read]
- Summary: Introduces the 300K-story WritingPrompts dataset (Reddit r/WritingPrompts) and a two-stage
  model that writes a premise first and then expands it. Stories are sampled with top-k (k=10), which
  the authors found clearly better than beam search for avoiding repetitive text.
- Relevance: Origin of both the dataset (see [06](06-datasets.md)) and the "premise first" idea.

### Yao et al. 2019 — Plan-and-Write
- Citation: Yao, L., Peng, N., Weischedel, R., Knight, K., Zhao, D., Yan, R. *AAAI 2019*.
  https://arxiv.org/abs/1811.05701 [V]
- Summary: Generates a keyword storyline from the title, then the story conditioned on it. Compares a
  *static* schema (finish the whole storyline, then write) with a *dynamic* one (interleave planning
  and writing). Planning improved diversity, coherence and topicality.
- Relevance: The dynamic schema is the one an interactive app resembles: re-plan after each user turn.
  The "storyline as a short list of keywords" format is cheap to produce and to inject at a depth.

### Yang et al. 2022 — Re3
- Citation: Yang, K., Tian, Y., Peng, N., Klein, D. *EMNLP 2022*.
  https://aclanthology.org/2022.emnlp-main.296 [V]
- Summary: Four stages — **Plan** (premise, setting, characters, outline), **Draft** (prompt each
  passage with plan plus story state), **Rewrite** (rerank candidate continuations for plot coherence
  and premise relevance), **Edit** (fix factual inconsistencies). Human raters preferred it over direct
  generation on plot coherence and premise relevance.
- Relevance: Rerank-then-pick is the same shape as a "selection step". The rerankers here score
  *coherence with the plan*, i.e. relevance; there is no novelty term, which is the gap this
  project is trying to fill.

### Yang et al. 2023 — DOC (Detailed Outline Control)
- Citation: Yang, K., Klein, D., Peng, N., Tian, Y. *ACL 2023*.
  https://aclanthology.org/2023.acl-long.190 [V]
- Summary: A hierarchical planner expands a short outline into a nested, detailed one, and a
  controller keeps each drafted passage aligned with its outline item. Reported gains over Re3 in
  plot coherence, outline relevance and interestingness.
- Relevance: Outline items as *typed, bounded* instructions are a good model for "inject at a tunable
  intensity": a beat list can contain a texture item, a complication item or a twist item.

### Mirowski et al. 2023 — Dramatron
- Citation: Mirowski, P., Mathewson, K. W., Pittman, J., Evans, R. *CHI 2023*, "Co-Writing Screenplays
  and Theatre Scripts with Language Models". https://arxiv.org/abs/2209.14958 [V]; code
  https://github.com/google-deepmind/dramatron
- Summary: Prompt chaining from a log line to title, characters, plot beats, locations and dialogue,
  with the human editing between layers. Fifteen theatre/film professionals co-wrote with it; they
  found the output formulaic as a whole but useful for world-building and exploring alternatives.
- Relevance: Best-documented evidence that *human edits between layers* are where value arises, and
  that professionals use LLMs for variation exploration rather than finished prose. An app-level
  analogue: let the user see and veto the injected seed before the prose node runs.

### Huot et al. 2025 — Agents' Room
- Citation: Huot, F., Amplayo, R. K., Palomaki, J., Jakobovits, A. S., Clark, E., Lapata, M. *ICLR
  2025*. https://arxiv.org/abs/2410.02603 [V; arXiv ID from search]
- Summary: An orchestrator hands narrative subtasks (e.g. planning, characters, setting, writing) to
  specialised agents that share a scratchpad. Introduces the Tell Me A Story dataset and an evaluation
  scheme for long narratives; expert raters preferred it over baselines.
- Relevance: The shared scratchpad is the thing this app lacks: per-chat variables are still a PLAN.md
  backlog item. Any multi-step planner that must remember "what was already injected" needs it.

## 2. Simulation-centred approaches

### Park et al. 2023 — Generative Agents
- Citation: Park, J. S. et al. *UIST 2023*. https://arxiv.org/abs/2304.03442 [V]
- Summary: 25 LLM-driven agents with a memory stream, periodic reflection and planning, in a small
  simulated town. A single seeded intention (a party) propagated into invitations and coordinated
  behaviour; ablations showed observation, planning and reflection each contributed.
- Relevance: Retrieval over the memory stream scores items by recency, importance and relevance (my
  recollection of the paper's design, not re-verified): a precedent for multi-factor selection instead of
  pure similarity. Emergent events come from agent interaction, not from an author or random table.

### Vezhnevets et al. 2023 — Concordia
- Citation: Vezhnevets, A. S. et al., "Generative agent-based modeling with actions grounded in
  physical, social, or digital space using Concordia". https://arxiv.org/abs/2312.03664 [V]
- Summary: A library where agents state intentions in prose and a **Game Master** (inspired by
  tabletop RPGs) rules on outcomes and describes effects. A 2025 report, "Multi-Actor Generative Artificial Intelligence as a Game Engine" (arXiv 2507.08892, title from a search listing), re-casts it
  with entity-component structure.
- Relevance: A concrete "world arbiter" pattern: the thing that injects consequences is a separate
  role from the thing that voices characters. In this app that would be a separate LLM node with its
  own preset, wired before the Chat Output(s).

### Zhu et al. 2023 — CALYPSO
- Citation: Zhu, A., Martin, L. J., Head, A., Callison-Burch, C. *AIIDE 2023*.
  https://arxiv.org/abs/2308.07540 [V]
- Summary: LLM-powered side-panel for Dungeon Masters in D&D: it summarises scene context and offers
  brainstormed ideas, which the DM can ignore, adapt or read out. DMs rated the prose good enough to
  read aloud and the rougher ideas as springboards while keeping creative control.
- Relevance: The cleanest precedent for **injection as an offered hook, not a command**. It is the
  design answer to the "suddenly a dragon appears" problem: the narrator model may use the hint.

### LLM-era drama work (see [03](03-drama-management.md))
Drama Llama, Dramamancer and "From Role-Play to Drama-Interaction" belong to the drama-management
literature and are discussed there.

## 3. Surveys and recent work (2024–2026)

- Teleki et al., "A Survey on LLMs for Story Generation", *Findings of EMNLP 2025*.
  https://aclanthology.org/2025.findings-emnlp.750/ [V citation from search; abstract level]. Splits the
  field into fully automatic generation and author-assistance, and compares methods, datasets and
  evaluation. Good entry point for anything not covered here.
- A 2026 narrative-theory-oriented survey and an EACL 2026 student-workshop survey of 2021–2025 work
  appeared in my search results but I could not verify their citations; not listed with links.
- Senanayake, Ware, Birchmeier, "Narrative Planning Using LLMs as a Model of Action Believability"
  (U. Kentucky, 2026): symbolic narrative planning where an LLM filters actions for believability.
  [S: search snippet only; https://cs.uky.edu/~sgware/reading/papers/senanayake2026narrative.pdf]
- Classical background, not re-verified in this survey: Riedl & Young, "Narrative Planning: Balancing
  Plot and Character", *JAIR* 39 (2010) (IPOCL planner); Meehan's TALE-SPIN (1977). [unverified]

## 4. Mapping to this app

| Architecture idea | Node/preset form | Gap today |
| --- | --- | --- |
| Premise → outline → prose (Fan, Yao, Re3, DOC) | LLM node (planner preset) → LLM node (prose preset) with the plan as a preset input slot | None for a fixed chain |
| Rerank candidates (Re3) | N parallel LLM nodes → a selector | No selector/transform node; a second LLM call can act as one |
| Human edits between layers (Dramatron) | Not in the DAG: the executor runs a whole turn | Would need a pause/approve step, out of scope today |
| Shared scratchpad (Agents' Room) | Per-session key/value state | PLAN.md backlog: per-chat variables |
| Game-master arbiter (Concordia) | Separate "world" LLM node feeding the narrator | None |
| Offered hook (CALYPSO) | Inject as a system-note entry at depth with permissive wording | None; wording is a preset decision (the engine applies nothing automatically) |

Open questions:

1. Re3/DOC optimise *coherence with a plan*. What is the analogous reranker for *interestingness
   without breaking coherence*? Candidates: [Sui Generis](01-diversity-and-mode-collapse.md) over
   candidate continuations, or the tension-forecast metric in [03](03-drama-management.md).
2. For an interactive, open-ended story, how much outline should persist? Plan-and-Write's dynamic
   schema suggests re-planning every turn; Re3 suggests keeping a stable premise/plan. Not settled by
   any of these papers, which target single-shot long documents.
