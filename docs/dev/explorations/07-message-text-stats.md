# 07 — Text-quality stats on chat messages

Which measurable properties of a generated reply (vocabulary diversity, repetition, novelty, "slop",
rhythm) have literature or prior art behind them. The aim is a set of discreet, per-message stats,
behind a setting, that let the user spot degenerate output and act on it. Research notes, not a spec.

Written October 2026 by a research agent from web search and page fetches; the citations were then
spot-checked, but not link-checked like the rest of the folder. See the [index](README.md) for the
tags. [01](01-diversity-and-mode-collapse.md) covers the *cause* of sameness (mode collapse) and why
word-level metrics miss plot-level repetition. This file is about what can be *measured* per reply.

Cost classes used below:

- **(a)** pure string math, cheap, computable in TypeScript;
- **(b)** needs a tokenizer or word lists;
- **(c)** needs embeddings;
- **(d)** needs LLM logprobs or an LLM judge.

## What this means for the app (short version)

- Chat replies (50–500 words) sit at the bottom of the length range these indices were built for.
  **Absolute thresholds will mislead.** Every displayed stat should be relative to the chat's own
  rolling baseline, and shown with its length.
- The most actionable signals are **cross-message**: overlap with the last few replies and recycled
  sentences. They need the chat's history (through `activeMessages`), not just the message.
- The cheap set (a/b) is enough for a first version. Embeddings (c) are the best next step, because
  they catch paraphrased repetition that n-grams miss. Logprob and judge metrics (d) are for model
  benchmarking, not per-message display.
- Prior art: no SillyTavern extension found shows per-message quality stats. Roleplay communities treat
  repetition at the sampler (DRY, XTC). There is no UI pattern to copy.

## 1. Lexical diversity

| Metric | Computation | Cost | Weaknesses | Reference |
| --- | --- | --- | --- | --- |
| TTR | types / tokens | a | Strongly length-dependent: useless across replies of different lengths | — |
| MATTR | mean TTR over a sliding window of W tokens | a | No value when the reply is shorter than W; window choice changes results | Covington & McFall 2010, *J. Quant. Linguistics* 17(2) [S] |
| MTLD | tokens / number of "factors" (segments where running TTR stays above 0.72), forward and backward averaged | a | Factor count gets noisy under ~100 tokens | McCarthy & Jarvis 2010, *Behav. Res. Methods* 42(2), https://doi.org/10.3758/BRM.42.2.381 [V] |
| HD-D | probability of each type appearing in a random 42-token draw (hypergeometric), summed | a | Deterministic, a plus over vocd-D | McCarthy & Jarvis 2007 [unverified] |
| vocd-D | curve fit of TTR over random subsamples | a | Stochastic (needs a seed), slowest, fits poorly on short texts | McKee, Malvern & Richards 2000 [unverified] |
| Maas | a² = (ln N − ln V) / (ln N)²; lower means richer | a | Found oversensitive to length in one comparison | [S] |
| Yule's K | 10⁴ · (Σ i²·Vᵢ − N) / N² | a | Length-dependent | Yule 1944 [unverified] |

In the 2010 validation study MTLD was the only index that did not vary with text length; the authors
still recommend reporting more than one. A 2024 study (Bestgen, MATTR/MTLD/HD-D on short texts) could
not be read [unverified].

**Take:** MTLD with a minimum-length guard, or MATTR with a window of 25–50, shown relative to the chat.

## 2. Repetition and degeneration

| Metric | Computation | Cost | Notes |
| --- | --- | --- | --- |
| distinct-n / repeated-n rate | unique n-grams / total n-grams | a | Length-dependent; function-word n-grams dominate unless n ≥ 3 or stopwords are filtered. Li et al., NAACL 2016, https://arxiv.org/abs/1510.03055 [V] |
| Cross-message n-gram overlap | share of the reply's 4-grams already present in the last K active replies | a | Not a published metric; the most direct signal for long chats. Names and catchphrases repeat legitimately, so it needs the per-chat baseline |
| Near-duplicate sentences | normalized sentences (case, punctuation) matched against recent replies | a | Very cheap and very concrete ("this sentence appeared 3 messages ago"); misses paraphrase |
| Compression ratio | compressed size / raw size (zlib, brotli) | a | Looping text compresses well. Header overhead distorts it under ~300 words |
| Self-BLEU | BLEU of each sample against the others in a set | a–b | A *set* metric: fits the alternatives (swipes) of one reply, not a single message. Zhu et al. 2018, Texygen, https://arxiv.org/abs/1802.01886 [V] |

Background: Holtzman et al., "The Curious Case of Neural Text Degeneration", ICLR 2020,
https://arxiv.org/abs/1904.09751 [V], explains why likelihood-maximizing decoding loops, and proposes
nucleus sampling. Welleck et al., unlikelihood training, ICLR 2020, https://arxiv.org/abs/1908.04319
[V], defines sequence-level repetition metrics (seq-rep-n and similar). HUSE (Hashimoto, Zhang & Liang,
NAACL 2019, https://arxiv.org/abs/1904.02792 [V]) scores quality and diversity jointly, but needs
human judgments and works at the population level (d).

## 3. Creativity and novelty

Caveat: these metrics measure novelty or divergence, not quality. Random text scores high. Display
them, if at all, as novelty signals.

- **Creativity Index** (Lu et al., ICLR 2025, https://arxiv.org/abs/2410.04265 [V]): share of a text
  that cannot be reconstructed from near-verbatim web snippets (DJ Search). Reports professional human
  writing scoring ~66% higher than LLM output, and alignment lowering LLM scores by ~30%. Needs a
  web-scale index: not feasible in this app.
- **Divergent Association Task** (Olson et al., *PNAS* 118(25), 2021,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC8237676 [V]): average pairwise semantic distance
  (GloVe) of 10 unrelated nouns. Built for word lists; applied to a reply's content words it measures
  topical spread more than creativity (c).
- **Embedding semantic diversity:** mean pairwise cosine distance of sentence embeddings (SBERT-class,
  e.g. all-MiniLM-L6-v2) across a set of replies (c). Can miss narrative homogenization: varied
  wording over the same plot [S].
- **Surprisal / perplexity:** mean negative log-probability per token under a reference model (d).
  Separates cliché (low) from degeneration (high). Depends on the provider exposing logprobs.
- **TTCW** (Chakrabarty et al., https://arxiv.org/abs/2309.14556 [V]): 14 expert-judged binary
  tests (fluency, flexibility, originality, elaboration). LLM stories passed 3–10× fewer tests than
  professional ones, and no LLM judge tested correlated positively with the experts (d). A
  reference-based automation (Li et al., Findings of EMNLP 2025, https://arxiv.org/abs/2504.15784 [V])
  reports 0.75 pairwise accuracy against humans.
- **EQ-Bench Creative Writing** (https://eqbench.com/creative_writing.html [V]): LLM-judged
  benchmark, for comparing models, not per message (d).

## 4. Slop and LLM-isms

- **EQ-Bench slop score** (https://github.com/sam-paech/slop-score [V]): frequency of words and
  trigrams from a list of LLM-overused phrases, plus a "not X, but Y" detector (regex and POS tagging)
  (b). The lists are derived from model output and age as models change; a Go port warns that rates
  are unstable under ~100 words [S]. **Check the licence before reusing the lists.**
- **Antislop** (Paech et al., https://arxiv.org/abs/2510.15061 [V]): a backtracking sampler that
  suppresses 8,000+ patterns, and FTPO fine-tuning (~90% less slop by the authors' measure). They also
  report that DPO degrades lexical diversity. A generation-side tool; its slop-list pipeline is the
  reusable part.
- **Excess vocabulary** (Kobak et al., *Science Advances* 11(27), 2025,
  https://arxiv.org/abs/2406.07016 [V]): estimates LLM use in biomedical abstracts from excess "style
  words" such as *delve* (≥13.5% of 2024 abstracts). A **population** estimate: it cannot classify a
  single text. Good inspiration for a per-chat word-frequency baseline, not a detector.

## 5. Style and rhythm

- **Burstiness:** coefficient of variation of sentence lengths (a). Sentence splitting breaks on
  dialogue, ellipses and emoji, so dialogue-heavy roleplay looks bursty for unrelated reasons. GPTZero
  says it stopped using perplexity and burstiness for detection in 2023 and now shows them only as
  explanations
  (https://support.gptzero.me/hc/en-us/articles/15130070230551-How-do-I-interpret-burstiness-or-perplexity [V]).
  A weak, descriptive stat at best.
- **Flesch Reading Ease:** 206.835 − 1.015 · (words/sentences) − 84.6 · (syllables/words) (b, needs
  a syllable heuristic). Readability is not quality for fiction.
- **Dialogue-to-narration ratio:** share of characters inside quotes (a). No literature found; fine
  as a descriptive stat.

## 6. Prior art in tools

- Python `lexicalrichness` (https://lexicalrichness.readthedocs.io/en/latest/ [V]): MTLD, HD-D,
  MATTR, vocd-D. Good as a reference implementation to test a TypeScript port against.
- R: `koRpus` (https://rdrr.io/cran/koRpus/man/lex.div-methods.html) and `quanteda::textstat_lexdiv`
  (https://quanteda.io/reference/textstat_lexdiv.html) [V]. Python TAALED
  (https://pypi.org/project/taaled/) [V].
- TypeScript: not surveyed. MATTR and MTLD are a few dozen lines each; no dependency needed.
- Chat frontends: no SillyTavern extension found with per-message quality stats; the community relies on
  samplers like DRY and XTC [S].

## 7. Shortlist

Cheap, per-message (a/b):

1. **Cross-message 4-gram overlap** with the last K active replies, relative to the chat's baseline.
   Catches exactly what users complain about in long chats.
2. **Repeated n-gram rate inside the reply** (distinct-3, stopwords filtered): in-reply loops.
3. **Compression ratio** above ~300 words: a near-free loop flag, not a score.
4. **Near-duplicate sentences** against recent replies: cheap and concrete.
5. **MTLD**, with a length guard, relative to the chat.
6. **Slop density** (hits per 100 words), curated list plus the "not X, but Y" pattern. The list
   needs maintenance and a licence check.
7. **Sentence-length variation**, low weight and descriptive only.

Expensive but valuable:

1. **Embedding similarity with recent replies or across swipes** (c): paraphrased repetition ("same
   scene, new words"). A small local sentence embedder in the backend would do.
2. **Per-token surprisal** when the provider gives logprobs (d): the only signal tied to the model's
   own distribution.
3. **Self-BLEU or embedding diversity across the alternatives of one reply** (a–c): whether
   regenerating actually produces something different.

Not recommended per message: LLM-judge creativity rubrics. They are slow, and TTCW found LLM judges
correlate poorly with experts.

## Decisions so far (2026-10-21)

1. **Two kinds of stats:** stats on a message (its own text) and stats across messages (relative to
   the chat's history, through `activeMessages`). The second kind changes with edits, forks and
   hidden alternatives.
2. **Computed on the server** for now.
3. **Shown in the chat first, and exposed to workflows** as well.
4. **Display is gated by an app setting** (a checkbox).
5. **English only** for now.
