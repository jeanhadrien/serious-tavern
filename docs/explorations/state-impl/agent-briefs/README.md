# Agent briefs: how phases 4a, 4b and 5 were run

Phases 1–3 used an older Workflow-tool script (removed, in git history). Phases 4a, 4b
and 5 ran it by hand with the Agent tool (Sonnet sub-agents), driven by short prompts that point at
brief files, and phase 5 slimmed it down (below). Use either; this folder holds what the Agent-tool
route needs.

## Files

- `common.md`: ground rules every agent reads first. Copy it to the session's scratchpad and fill in the
  placeholders (scratchpad path, session URL, working branch).
- `roles/implement.md`, `roles/review.md`, `roles/fix.md`, `roles/verify.md`: one role each (step 5
  gives the resumed implementer both `fix.md` and `verify.md`).
- `roles/lenses.md`: the review lenses (spec, correctness, ui; conventions and tests kept for big
  refactors).
- Per phase, write `<scratch>/briefs/phase-<N>.md`: a header (base commit, plan file path, screenshot
  dir, where reusable live-check scripts are), a one-paragraph context on what earlier phases built, then
  the spec from [../specs/](../specs/).

## Pipeline per phase (4 agents, 5 with UI)

Phases 4a and 4b ran 12 agents each (a separate planner, four or five reviewers, a second review round, a
fixer and a verifier). Most real issues came from the spec/correctness reading and the live UI check, and
every fresh agent spends much of its budget re-reading the code, so from phase 5 the pipeline is:

1. **Implementer A** (fresh agent): reads the brief and the code, writes the plan to
   `<scratch>/plans/phase-<N>.md` (one commit per feature, decisions on ambiguities; the orchestrator
   reads the decisions and amends them if needed), then implements the first half of the commits and
   leaves "Notes from implementer A" at the end of the plan. If the phase is small, it does everything.
2. **Implementer B** (fresh agent): the second half of the commits; UI phases end with a Playwright live
   check at desktop and phone sizes.
3. **Reviewer** (fresh agent): the spec and correctness lenses together (`roles/lenses.md`), including
   whether the risky paths are pinned by tests. Findings as JSON in `<scratch>/findings/`.
4. **Live UI reviewer** (fresh agent, UI phases only, in parallel with 3): drives the app in a browser
   and reports what is broken. Kept separate: its context is mostly server setup, scripts and screenshots.
5. **Fix and verify** (implementer B resumed with SendMessage, so it keeps its knowledge of the code):
   all findings plus the orchestrator's decisions, then `npm run check`, the conventions and docs pass
   (`roles/verify.md`), a short live re-check, and the user-facing "how to try it" note.
6. **Checkpoint** (orchestrator): clean tree, `npm run check` green, skim the core diffs, copy the how-to
   into the user guide `docs/STATE-AND-LORE.md` (current behaviour only, without scratch paths), update [../HANDOFF.md](../HANDOFF.md), push the
   working branch and `claude/state-impl-phase-<N>`.

## Lessons

- **Usage limits stop agents mid-task.** A stopped agent keeps its transcript: after the reset, send
  it a message (SendMessage) to continue rather than starting a new one; its uncommitted work is in the
  tree. Don't commit an agent's partial work yourself.
- **Reading cost:** each agent re-reads AGENTS.md; `common.md` tells agents to read only the README
  sections they need (README is ~136 KB).
- **Live checks:** the vite `/api` proxy target is hard-coded (`apps/web/vite.config.ts`), so live
  checks use an out-of-repo vite config pointing at a temp-dir server on a free port. Agents saved their
  Playwright drive scripts under `<scratch>/tools/`; they are lost with the container, so copy what is
  worth keeping into the repo.
- **Planner decisions are worth reading closely:** several real issues (State Write gating, writing a
  constant, the post part writing twice) were caught at plan or review time, not by tests.
