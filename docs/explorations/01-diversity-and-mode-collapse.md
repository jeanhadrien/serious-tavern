# 01 — Mode collapse and output diversity in aligned LLMs

Why the same scene keeps producing the same story, what the literature says about the cause, and which
levers exist at the model, sampler and prompt level. Read this first: the rest of the folder assumes the
conclusion below.

See the [index](README.md) for the legend used in the verification tags.

## What this means for the app (short version)

- The convergence JH describes is mostly **not** a sampling problem. Instruction tuning and RLHF narrow
  the model's output distribution itself, so sampling harder (temperature, top-p, min-p) mostly changes
  wording and leaves plot elements alone. Evidence: [Kirk 2024], [Padmakumar 2024], [Xu 2025],
  [Jiang 2025], [Peeperkorn 2024].
- The levers that work on *semantic* diversity act on the **context**: different inputs, personas,
  seeds, or retrieved material ([Meincke 2024], [Zhang 2025], and the whole retrieval theme in
  [05](05-relevance-vs-novelty.md)). That is exactly the direction of the pipeline under discussion
  (trigger → source → selection → injection).
- Samplers still matter, but as a *coherence safety net* when you raise randomness, not as the source of
  novelty. Their availability is backend-dependent. In this app today the LLM node exposes the basic
  OpenAI-style samplers; `min_p`, `top_k`, `repetition_penalty` and friends are a PLAN.md backlog item,
  and the provider record's `extraBody` is the raw escape hatch (which backend accepts which field is a
  per-provider question this survey does not answer).

## 1. Evidence that alignment homogenizes output

### Kirk et al. 2024 — Understanding the Effects of RLHF on LLM Generalisation and Diversity
- Citation: Kirk, R. et al. (UCL, Meta, Oxford). *ICLR 2024*. https://arxiv.org/abs/2310.06452 [V]
- Summary: Compares SFT, reward modelling and RLHF stages on summarisation and instruction following
  (OPT and LLaMA bases). RLHF generalises better to new inputs than SFT but lowers output diversity on
  several measures, i.e. the generalisation/diversity trade-off is a property of the current pipeline.
- Relevance: Establishes the baseline claim that the preference-tuning stage is where per-prompt
  diversity is lost. Practical consequence for a roleplay/fiction app: model choice matters as much as
  sampler choice, and "less tuned" or "more creatively tuned" models are worth exposing as an option.

### Padmakumar & He 2024 — Does Writing with Language Models Reduce Content Diversity?
- Citation: Padmakumar, V., He, H. *ICLR 2024*. https://arxiv.org/abs/2309.05196 [V]
- Summary: A controlled co-writing study. Essays written with InstructGPT as a collaborator became more
  similar to each other (lexically and in content); writing with the base GPT-3 did not significantly do
  so. The effect traced back to the model's contributions, not to authors changing what they wrote.
- Relevance: Homogenization is a *collective* effect across users and sessions, not only inside one
  chat. In a single-user app the visible symptom is "every campaign starts the same way".

### Doshi & Hauser 2024 — Generative AI enhances individual creativity but reduces collective diversity
- Citation: Doshi, A. R., Hauser, O. P. *Science Advances* 10(28), 2024.
  https://doi.org/10.1126/sciadv.adn5290 [V]
- Summary: Writers given LLM story ideas produced stories rated more creative individually, but the set
  of AI-assisted stories was more alike than the human-only set.
- Relevance: Motivation, and a caution: LLM-suggested ideas look good locally and converge globally.
  Any "idea injection" source that is itself an LLM inherits this.

### Chakrabarty et al. 2024 — Art or Artifice? LLMs and the False Promise of Creativity
- Citation: Chakrabarty, T., Laban, P., Agarwal, D., Muresan, S., Wu, C.-S. *CHI 2024*.
  https://arxiv.org/abs/2309.14556 [V]
- Summary: Introduces the Torrance Test of Creative Writing (14 binary tests over fluency, flexibility,
  originality, elaboration). Expert-judged LLM stories passed several times fewer tests than
  professional stories; LLM judges did not track the experts.
- Relevance: A usable rubric if the project ever wants a human-in-the-loop quality check, and a warning
  that LLM-as-judge is weak for originality (relevant to any automatic "selection" step).

### Mohammadi 2024 — Creativity Has Left the Chat: The Price of Debiasing Language Models
- Citation: Mohammadi, B. arXiv 2024. https://arxiv.org/abs/2406.05587 [V citation, S content]
- Summary (abstract level only): Studies, on the Llama-2 family, how RLHF alignment affects syntactic
  and semantic diversity ("creativity" in the paper's sense). I did not read the experiments; check the
  paper before quoting numbers.
- Relevance: Same direction as Kirk et al., from the safety-alignment side.

### West & Potts 2025 — Base Models Beat Aligned Models at Randomness and Creativity
- Citation: West, P., Potts, C. arXiv 2025. https://arxiv.org/abs/2505.00047 [V]
- Summary: On random-number generation, mixed-strategy games and creative writing, base models beat
  their aligned counterparts; aligned models gravitate to a few favourites ("7" for random numbers,
  pleasant over original prose). Better benchmark scores tended to correlate with worse results on
  these tasks.
- Relevance: Supports using a base/less-tuned model *for ideation steps* (premise, twist, NPC seed)
  and an instruct model for the final prose. Caveat for this app: PLAN.md puts text-completion backends
  out of scope; base models are only reachable where a provider serves them through the chat API.

### Jiang et al. 2025 — Artificial Hivemind: The Open-Ended Homogeneity of Language Models
- Citation: Jiang, L. et al. *NeurIPS 2025* (oral).
  https://arxiv.org/abs/2510.22954 [V citation; award status S]
- Summary: Builds Infinity-Chat (about 26k real open-ended prompts, 31k human annotations, a taxonomy of
  6 top-level and 17 sub-categories). Reports two effects: one model repeats itself across samples, and
  different model families produce strikingly similar answers. Also reports that LLM judges and reward
  models are poorly calibrated on prompts where annotators disagree.
- Relevance: Rules out "just switch to another provider" as a diversity fix, and implies a
  selection/judge step built on an LLM will be biased toward the consensus answer.
- Not verified: a secondary summary claimed the paper shows min-p does not fix the homogeneity. The
  abstract does not mention sampling methods, so I dropped that claim; check the full text if you want
  to cite it.

### Xu et al. 2025 — Echoes in AI: Quantifying lack of plot diversity in LLM outputs
- Citation: Xu, W., Jojic, N., Rao, S., Brockett, C., Dolan, B. *PNAS* 2025, doi
  10.1073/pnas.2504966122. https://arxiv.org/abs/2501.00273 [V]
- Summary: Generating continuations of the same story many times, the same plot elements recur
  (their Kafka example: half the continuations have a policeman point the narrator "second left").
  They propose **Sui Generis**, a score for how unique a plot element is among samples drawn for the
  same prompt, and show it correlates moderately with human surprise judgements.
- Relevance: The best-fitting *metric* found for this project's goal. It can be run offline over N
  regenerations of the same turn to measure whether the pipeline actually changes plot content, not
  just wording. See also 100-Endings in [03](03-drama-management.md).

### Chung et al. 2025 — Modifying LLM Post-Training for Diverse Creative Writing
- Citation: Chung, J. J. Y. et al. arXiv 2025. https://arxiv.org/abs/2503.17126 [V]
- Summary: Adds a "deviation" weight (how far a training sample is from other responses to the same
  prompt) to DPO/ORPO so rare high-quality responses count more. A trained 8B model reaches diversity
  close to a human-written reference set with quality similar to strong instruct models, on r/WritingPrompts
  data.
- Relevance: Shows the diversity loss is a training-objective artefact, fixable in principle. Not
  actionable for a client app, but a hint that "creative-tuned" models exist and are worth listing in
  the provider model picker when they appear.

## 2. Prompt-level levers

### Verbalized Sampling (Zhang et al. 2025)
- Citation: Zhang, J., Yu, S., Chong, D., Sicilia, A., Tomz, M., Manning, C., Shi, W. arXiv
  2510.01171, 2025 (also listed for ICML 2026). https://arxiv.org/abs/2510.01171 [V]
- Summary: Argues mode collapse is driven by *typicality bias* in preference data (annotators prefer
  familiar text). Training-free fix: ask the model to output several candidates *with probabilities*
  (e.g. five jokes with their probabilities) instead of one answer. Reported creative-writing diversity
  gains of roughly 1.6–2.1x over direct prompting, larger for stronger models, without hurting facts or
  safety.
- Relevance: Directly implementable as a preset: "list 5 distinct continuations as JSON with an
  estimated probability each". The pipeline then *chooses* from the tail (low-probability but coherent
  candidates) rather than letting the model pick its favourite. Needs a selection step; the app has no
  code/transform node yet (PLAN "More node types"), so the selector is either a second LLM call or a
  future node. Treat the "probabilities" as the model's self-reported ranking, not calibrated numbers.

### Meincke, Mollick, Terwiesch 2024 — Prompting Diverse Ideas: Increasing AI Idea Variance
- Citation: arXiv 2402.01727, 2024. https://arxiv.org/abs/2402.01727 [V]
- Summary: GPT-4 idea sets were less varied than human groups; prompt design changed this a lot, and
  chain-of-thought-style prompting gave the most diverse and most numerous unique ideas among the
  prompts tested.
- Relevance: Cheap baseline to benchmark any retrieval-based injection against: if a better prompt gets
  the same Sui Generis score, the external source is not earning its complexity.

### Peeperkorn et al. 2024 — Is Temperature the Creativity Parameter of LLMs?
- Citation: Peeperkorn, M., Kouwenhoven, T., Brown, D., Jordanous, A. *ICCC 2024* (best student paper).
  https://arxiv.org/abs/2405.00492 [V]
- Summary: On a fixed narrative task, higher temperature gave a weak gain in novelty and a moderate loss
  in coherence, with no clear effect on typicality or cohesion. Temperature is not a creativity dial.
- Relevance: Cites the empirical basis for "temperature only adds surface variation".

## 3. Decoding and samplers

| Method | Idea | Source | Status | For this app |
| --- | --- | --- | --- | --- |
| Top-k | Sample from the k most likely tokens. | Fan et al. 2018 use k=10 for stories (https://arxiv.org/abs/1805.04833) | [P] read in the PDF | Backlog LLM-node field; backend-dependent. |
| Nucleus / top-p | Smallest token set holding mass p. | Holtzman et al. *ICLR 2020* (https://arxiv.org/abs/1904.09751) | [V] | Already an LLM-node sampler (topP). |
| Eta-sampling | Entropy-scaled probability floor ("desmoothing"). | Hewitt, Manning, Liang, *Findings of EMNLP 2022* (https://arxiv.org/abs/2210.15191) | [V] | Rarely offered by hosted APIs; local servers only, if at all. |
| Locally typical | Keep tokens whose surprisal is near the distribution's entropy. | Meister, Pimentel, Wiher, Cotterell, TACL 2023 (https://arxiv.org/abs/2202.00666) | [V] | As above; mainly a repetition fix. |
| Mirostat | Feedback control of k to hold a target perplexity; names the "boredom" and "confusion" traps. | Basu et al., *ICLR 2021* (https://arxiv.org/abs/2007.14966) | [V] | Local-server option; the trap vocabulary is useful in [04](04-triggering-and-timing.md). |
| Min-p | Cutoff is a fraction of the top token's probability. | Nguyen et al., *ICLR 2025* (https://arxiv.org/abs/2407.01082) | [V], **contested**, see below | PLAN.md backlog (OpenRouter `min_p`); a coherence net for higher temperatures, not a diversity source. |
| Top-nσ | Statistical cutoff applied to raw logits, designed to stay stable as temperature rises. | Tang et al., arXiv 2024 (https://arxiv.org/abs/2411.07641) | [V] abstract read; preprint | Needs per-backend support; reported on reasoning benchmarks, not fiction. |
| XTC ("exclude top choices") | With some probability, drop all but the least-likely token above a threshold, so the obvious continuation is removed. | p-e-w, text-generation-webui PR #6335, opened 2024-08-18, merged 2024-09-28 (https://github.com/oobabooga/text-generation-webui/pull/6335) | [V] PR page read; no paper | Prose only, risky on fact turns; reachable only if a backend accepts it via `extraBody` (not claimed here). |
| Antislop | Backtracking sampler plus fine-tuning to suppress over-used phrases ("slop"). | Paech et al., arXiv 2025, *ICLR 2026* (https://arxiv.org/abs/2510.15061) | [V] | Backtracking is not possible over a stateless chat API; approximate with logit bias, stop sequences, or a regenerate-if-slop loop. |

Notes:

- **Min-p is contested.** Nguyen et al. report better quality/diversity trade-offs at high temperature
  and wide adoption. Schaeffer, Kazdan, Denisov-Blanch re-analyse the human evaluation, benchmark sweeps
  and LLM-judge results and conclude the evidence does not show an improvement once hyperparameter
  count is controlled (https://arxiv.org/abs/2506.13681, [V]). Treat min-p as a reasonable
  coherence-preserving default, not as a diversity solution.
- **XTC** is the only sampler here that *deliberately targets the most probable token*, which makes it
  the closest sampler-level analogue of "avoid the obvious continuation". It is heuristic and has no
  peer-reviewed evaluation that I found. Risk: it can remove the correct token when only one answer is
  right (names, continuity facts), so it suits prose, not factual turns.
- **Antislop** needs backtracking during generation, which a stateless HTTP chat API cannot offer. The
  closest client-side tools are logit bias and stop sequences. A post-hoc "regenerate if slop detected"
  loop is a workflow-level alternative.
- Samplers fix *degeneration* (repetition loops, incoherence at high T), see Holtzman, Mirostat and the
  repetition work in [04](04-triggering-and-timing.md). None of them re-sample plot.

## 4. Measuring diversity

| Metric | What it measures | Source | For this app |
| --- | --- | --- | --- |
| distinct-n | Share of unique n-grams in a set of outputs. | Li et al., *NAACL 2016* (https://aclanthology.org/N16-1014/) [V] | Cheap repetition signal across regenerations; blind to same-plot-new-words. |
| Self-BLEU | Mean BLEU of each sample against the others; higher means more collapse. | Zhu et al., Texygen, *SIGIR 2018* (https://arxiv.org/abs/1802.01886) [V] | Same family as distinct-n; offline evaluation only. |
| Embedding dispersion | Mean pairwise distance of sample embeddings. | Cosine distance between response embeddings underlies the "deviation" weight in [Chung 2025] | Needs embeddings (not built); catches paraphrased repeats. |
| Sui Generis | Uniqueness of plot elements among samples for one prompt. | [Xu 2025] | Best fit for "did the plot change?"; needs plot-element extraction (an LLM call). |

Lexical metrics (distinct-n, Self-BLEU) miss exactly the problem here (same plot, different words),
which is why Xu et al. built Sui Generis. For this project the practical recipe is: sample N replies for
the same turn with and without the injection pipeline, embed them, and compare dispersion; use Sui
Generis-style plot-element extraction when you want the plot level.

## 5. Open questions for this app

1. Where should "ideation" run, on a different (less aligned or more creative) model than the prose
   model? The workflow editor already supports several LLM nodes with different providers.
2. Does a verbalized-sampling candidate list plus a tail-biased pick beat simply injecting a retrieved
   seed? This is cheap to test since cost is not a concern.
3. Is there a stable, backend-independent way to expose min-p/top-k/XTC? Today it is per-provider
   `extraBody`; no claim is made here about which providers accept XTC.

[Kirk 2024]: https://arxiv.org/abs/2310.06452
[Padmakumar 2024]: https://arxiv.org/abs/2309.05196
[Xu 2025]: https://arxiv.org/abs/2501.00273
[Jiang 2025]: https://arxiv.org/abs/2510.22954
[Peeperkorn 2024]: https://arxiv.org/abs/2405.00492
[Meincke 2024]: https://arxiv.org/abs/2402.01727
[Zhang 2025]: https://arxiv.org/abs/2510.01171
[Chung 2025]: https://arxiv.org/abs/2503.17126
