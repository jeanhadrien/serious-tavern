# Phase workflow script

The Workflow-tool script used for every phase (plan, implement, review in parallel, fix, re-review, verify). Copy the code block into a `Workflow` call (`script`), or save it as a `.js` file and pass `scriptPath`. Arguments are described in HANDOFF.md.

```js
export const meta = {
  name: 'state-phase',
  description: 'Plan, implement, review (multi-lens), fix and verify one phase of the state design',
  phases: [
    { title: 'Plan', detail: 'read spec + code, write implementation plan' },
    { title: 'Implement', detail: 'one implementer, one commit per feature' },
    { title: 'Review', detail: 'parallel reviewers, one lens each' },
    { title: 'Fix', detail: 'address findings, commit' },
    { title: 'Re-review', detail: 'second pass on the fixes' },
    { title: 'Verify', detail: 'full check + live smoke test' },
  ],
}

const A = args
const PLAN_FILE = `${A.scratch}/plans/phase-${A.phase}.md`
const COMMON = `
You are working in the repository at /home/user/serious-tavern (TypeScript npm-workspaces monorepo: packages/shared, packages/engine, packages/node-ui, apps/server, apps/web).

Ground rules (read carefully):
- First read AGENTS.md (conventions and key contracts, they are binding), README.md, PLAN.md (never modify PLAN.md) and the design spec docs/explorations/STATE-DESIGN-PROPOSAL-3.md. For any web layout work also read docs/FRONTEND-LAYOUT.md.
- Environment: Linux with bash (AGENTS.md mentions Windows/PowerShell; ignore those shell specifics here). Dependencies are installed. Chromium + Playwright are available (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; do not run "playwright install"; if needed launch with executablePath '/opt/pw-browsers/chromium').
- Stay on the current git branch (claude/state-impl). Never switch branches, never push, never touch main, never rewrite history (no amend/rebase/reset of existing commits).
- Never run anything against apps/server/data. For live checks, create a temp dir under ${A.scratch}/live-<something>, run the server from that dir as cwd (node /home/user/serious-tavern/node_modules/tsx/dist/cli.mjs /home/user/serious-tavern/apps/server/src/main.ts with PORT set to a free port), and delete the temp dir afterwards. Kill only processes you started, by PID.
- \`npm run check\` (biome + typecheck + tests + knip) must pass before every commit. \`npm run fix\` applies formatting.
- Commit messages: conventional style \`type(scope): subject\`, a short body explaining why, and exactly these trailer lines at the end:
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BszbVoRAsWXxU1ySwyAPch
- Data compatibility is sacred (alpha, user data preserved): schema changes additive with defaults, unknown fields kept.
- Keep files focused (roughly under 250 lines), follow existing patterns, delete dead code (knip).
- Scratch files go in ${A.scratch}, not in the repo.

The phase being built: PHASE ${A.phase} — ${A.title}.
The work started from commit ${A.base}; \`git diff ${A.base}..HEAD\` shows everything done for this phase so far.

PHASE SPEC (decisions already taken by the orchestrator; they refine STATE-DESIGN-PROPOSAL-3 and win over it where they differ):
${A.spec}
`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          detail: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'title', 'detail'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['findings', 'summary'],
}

phase('Plan')
const plan = await agent(`${COMMON}
YOUR TASK: produce a precise implementation plan for this phase. Do not change any repository file.
Read the spec, then read all the code the phase touches (follow call paths; look at existing analogous features and their tests so the plan reuses patterns). Write the plan to ${PLAN_FILE}: for each feature (one feature = one commit), list files to create/change, the exact types/schemas/function signatures, behaviour details and edge cases, the tests to add (with concrete cases), and docs to update (README, AGENTS.md key contracts, docs/TEMPLATING.md when templates change). Call out any place where the spec is ambiguous or conflicts with the code, and state the decision you recommend and why. Order features so each commit leaves \`npm run check\` green.
Return a short summary (max 25 lines) of the plan and the decisions you made.`, { label: 'plan', phase: 'Plan', effort: 'high' })

phase('Implement')
const impl = await agent(`${COMMON}
YOUR TASK: implement this phase completely, following the plan in ${PLAN_FILE} (written by a planner after reading the code; you may deviate where the code proves it wrong — note why in the commit body).
Work feature by feature; one commit per feature (as listed in the plan), each with \`npm run check\` passing first. Write thorough tests (table-driven where it fits) for every behaviour in the spec, including edge cases and failure paths. Update README.md / AGENTS.md / docs as the plan says.
${A.ui ? 'This phase has UI. After the UI commit(s), do a live check: run the server (temp data dir, see ground rules) and the web dev server (vite, apps/web, proxy /api to your server port — check apps/web/vite.config.ts for how the proxy target is set, and override with an env var or a temporary config passed on the command line, never by committing a change), drive the new UI with Playwright at desktop (1400x900) and phone (390x844) sizes, save screenshots under ' + A.scratch + '/shots/phase-' + A.phase + '/, and fix what is broken.' : ''}
When done, return a summary: commits made (sha + subject), what was implemented, any deviation from the plan/spec and why, and anything left undone.`, { label: 'implement', phase: 'Implement', effort: 'high' })

const LENSES = [
  { key: 'spec', prompt: 'Spec conformance: compare the implementation against the PHASE SPEC and the relevant parts of STATE-DESIGN-PROPOSAL-3. List every missing behaviour, deviation, or half-implemented item. Check the user-facing behaviour described in the spec actually works end to end (engine → server → API → web where applicable).' },
  { key: 'correctness', prompt: 'Correctness: hunt for real bugs in the new code. Trace realistic paths from real callers/inputs: edge cases, empty/missing values, error paths, determinism, concurrency and locks (AGENTS.md lock rules), data written to disk, interaction with existing features (streaming turns, stop, message edit/delete, workflow save/validation, presets). For each finding give a concrete failing scenario. Do not report style.' },
  { key: 'conventions', prompt: 'Conventions and contracts: check the diff against every relevant rule in AGENTS.md (contract-first API in packages/shared/src/api with server tests, data compatibility/additive schemas, locks via update, canConnect as single source of port rules, macro/hint lists never hand-written, Handlebars templating rules, node-ui never importing web clients, layout rules in apps/web/src/layout, icons lucide with aria-label+title, files < ~250 lines, knip-clean, docs updated: README/AGENTS.md/TEMPLATING.md). Also check maintainability: duplication with existing helpers, naming, needless complexity.' },
  { key: 'tests', prompt: 'Tests: evaluate whether the new tests actually pin the behaviour in the spec. Find untested behaviours, tests that would pass even if the feature were broken, missing failure-path and edge-case tests, and missing contract coverage (app.test.ts requires every endpoint exercised). Run `npm test` and report failures.' },
]
if (A.ui) LENSES.push({ key: 'ui', prompt: 'Live UI check: run the server (temp data dir per the ground rules) and the web dev server pointed at it, then use Playwright (Chromium at /opt/pw-browsers) to exercise every new or changed UI flow of this phase as a user would, at desktop 1400x900 and phone 390x844. Check: it renders, controls work, values persist after reload, errors are shown sensibly, nothing existing broke (open chat, workflow editor, presets). Save screenshots to ' + A.scratch + '/shots/phase-' + A.phase + '/review/. Report concrete broken behaviours as findings. Clean up processes and temp dirs.' })

phase('Review')
const reviews = await parallel(LENSES.map((l) => () => agent(`${COMMON}
YOUR TASK: review the work of this phase (\`git diff ${A.base}..HEAD\`, plus the plan in ${PLAN_FILE}). Do NOT modify repository files or commit.
LENS — ${l.prompt}
Be concrete: file and line, what is wrong, why it matters, and the fix. Severity: blocker = broken feature, data loss or failing check; major = wrong behaviour in a realistic case or a spec item missing; minor = edge case or maintainability issue worth fixing; nit = cosmetic. Report only real issues; an empty list is a fine answer.`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS })))

const all = reviews.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ ...f, lens: LENSES[i] ? LENSES[i].key : '?' })))
const actionable = all.filter((f) => f.severity !== 'nit')
log(`review: ${all.length} findings (${actionable.length} non-nit)`)

async function fixRound(findings, label, phaseName) {
  return agent(`${COMMON}
YOUR TASK: address review findings for this phase. Findings (JSON):
${JSON.stringify(findings, null, 1)}
If \`git status\` shows uncommitted changes, they are the partial work of an earlier fixer for these same findings that was interrupted: review them, keep what is right, and complete the work (do not discard them blindly).
For each finding: verify it against the code first (reviewers can be wrong). Fix every real blocker/major; fix minors and nits when cheap and clearly right. Reject false positives with a one-line reason. Keep fixes minimal and in scope. Add or adjust tests for each real bug fixed. Run \`npm run check\`, then commit (one or a few commits, \`fix(...)\` / \`test(...)\` etc.).
Return a list: for each finding title → fixed / rejected (reason) / deferred (reason), plus the commit shas.`, { label, phase: phaseName, effort: 'high' })
}

phase('Fix')
const fix1 = actionable.length || all.length ? await fixRound(all, 'fix-1', 'Fix') : 'no findings'

phase('Re-review')
const base2 = A.base
const rr = await parallel(['spec', 'correctness'].map((k) => () => agent(`${COMMON}
YOUR TASK: second-pass review of this phase after fixes. Look at the whole phase diff (\`git diff ${base2}..HEAD\`) with fresh eyes, focusing on ${k === 'spec' ? 'spec conformance and end-to-end user-facing behaviour' : 'real bugs with concrete failing scenarios'}. The previous fixer reported:
${typeof fix1 === 'string' ? fix1 : JSON.stringify(fix1)}
Do NOT modify files. Report only blocker/major/minor issues that are still present.`, { label: `re-review:${k}`, phase: 'Re-review', schema: FINDINGS })))
const remaining = rr.filter(Boolean).flatMap((r) => r.findings).filter((f) => f.severity === 'blocker' || f.severity === 'major' || f.severity === 'minor')
log(`re-review: ${remaining.length} remaining issues`)
const fix2 = remaining.length ? await fixRound(remaining, 'fix-2', 'Re-review') : 'none needed'

phase('Verify')
const verify = await agent(`${COMMON}
YOUR TASK: final verification of this phase. Do not change code unless a check fails; if it does, fix minimally, re-run, and commit.
1. Run \`npm run check\` and report the result (test counts).
2. Confirm \`git status\` is clean and list \`git log --oneline ${A.base}..HEAD\`.
3. Live smoke test against a temp data dir (ground rules): start the server, exercise this phase's behaviour through the HTTP API with curl (create what is needed, send a chat message that exercises the new nodes if applicable; LLM calls cannot reach a real provider, so prefer workflows whose replies don't need an LLM, or point an LLM node at a small local fake OpenAI-compatible server you start yourself from the scratch dir), and report what you observed. Clean up.
4. Write a short user-facing "how to try it" section for this phase to ${A.scratch}/plans/phase-${A.phase}-howto.md (what to click / which nodes to wire / what to expect).
Return: check result, commit list, smoke-test observations, and any known limitation.`, { label: 'verify', phase: 'Verify', effort: 'high' })

return { plan, impl, findings: all, fix1, remaining, fix2, verify }
```
