TRIGGER NODE (STATE-DESIGN-PROPOSAL-3 Part 6) + SEEDED "FRESH TEXTURE" EXAMPLE.

NOTE FROM PHASE 3 (overrides the wording example below): preset inputs are only `text` or `messages`, so a preset can't read `{{input.seed.level}}`. Draw has a `level` output and a `text` output. Word the drawn seed by level another way: e.g. two or three preset inputs (`seedTexture`, `seedDetail`) fed from Draw's `text` behind a Condition on Draw's `level`, or a Condition that picks one of several wording templates before the LLM. Pick the simplest wiring that works and document it in the guide.

1) TRIGGER NODE (`trigger`, label 'Trigger', category 'Creativity')
- Decides WHETHER to inject this turn and HOW STRONGLY; Draw/Recall decide what; the preset decides the wording.
- Inputs (all optional): `volatility` (number 0..1; default from config `volatility`, default 0.3), `maxLevel` (number 1..5; default config `maxLevel`, default 2), and signal inputs. Signals: config `signals: { name, weight }[]` (key/value-like list; if the generated form can't edit it, add a custom node-ui panel) → one dynamic input port per signal (number 0..1, optional) via resolvePorts.
- Config: `baseChance` (0..1, default 0.1), `growthPerTurn` (default 0.05: added per turn since the last firing), `cooldowns` (per level 1..5: minimum turns between firings at that level; default {1:0,2:2,3:4,4:8,5:15}), `levelWeights` (per level relative weights; default {1:5,2:3,3:2,4:1,5:0.5}), `volatility`, `maxLevel`.
- Score = clamp01( (baseChance + growthPerTurn × turnsSinceLastFiring + Σ weight_i × signal_i) × (0.5 + volatility) ) — document the formula in the node description and README; keep it simple and explainable. Roll = ctx.random(); fire iff roll < score and at least one level ≤ maxLevel is off cooldown. Level = weighted pick (ctx.random) among levels ≤ maxLevel that are off cooldown.
- Implicit node state (like Draw's recent draws, built in phase 4a): the node writes its firing `{ level }` to its own node key when it fires; `turnsSinceLastFiring` and per-level cooldowns are computed from the folded node state (never fired ⇒ turnsSinceLastFiring = current turn number). Deleting the reply undoes the firing.
- Outputs: `fire` (boolean), `level` (number, optional: only when fired), `true`/`false` branch outputs passing an optional `value` input through (like Condition/Random chance), `reason` (text: e.g. "score 0.42 = (0.10 + 0.05×3 + 0.6×0.2) × 0.8; roll 0.31 < 0.42; level 2 (level 4 on cooldown for 5 more turns)").
- Tests: never-fired fresh chat, growth, cooldown enforcement per level, maxLevel cap, all levels on cooldown, determinism with seed, signals weighting, reason text.

2) SEEDED EXAMPLE "Fresh texture" (idempotent seeds: create only when missing, never overwrite; must keep validating — extend the seeded-workflows test)
- A collection "Forest textures (example)" with ~20 self-written entries (no copyrighted text) tagged sensory/object/sound/history etc., levels 1–3, a few weights.
- The `scene` state definition (seeded in phase 4a) is reused.
- A preset "Fresh texture narrator (example)" (follow how existing seeded presets are created, if any; else create via the preset repository) with a system prompt, the history slot, and a depth entry that words the drawn seed by level using `{{#if input.seed}}…{{/if}}` and `(eq input.seed.level 1)` (offers, not commands).
- A workflow "Fresh texture (example)" that declares chat settings `volatility` (number 0..1, default 0.3) and `maxLevel` (enum or number 1..5, default 2), wires: Chat Input → Chat Settings → Trigger (volatility, maxLevel) → Draw (collection above, maxLevel from Trigger level, avoidRecent 10) → LLM (the example preset, seed input from Draw) → Chat Output; plus a State Write of `scene.injected` (add, item from Draw entry) and `scene.lastInjectionLevel`. The LLM node uses the same provider/model defaults as the existing seeded "Default Assistant". When the Trigger doesn't fire, the LLM must still answer (the seed input is simply absent) — check how optional/unconnected preset inputs behave and wire accordingly (e.g. a Merge or the preset input being optional).
- Verify with a fake OpenAI-compatible server in the live check that a few turns produce replies, the panel shows draws/state, and deleting the last reply rewinds.

3) USER GUIDE
- `docs/STATE-AND-LORE.md` (user-facing, plain language): chat settings, story state (definitions, nodes, the rewind rule), collections (format, Recall, Draw), post-turn runs, summaries, the Trigger, and a walkthrough of the seeded example; how to see what happened (chips, panel, execution details). Link it from README.

DOCS: README, AGENTS.md (Trigger implicit state, seeded example must keep validating).
