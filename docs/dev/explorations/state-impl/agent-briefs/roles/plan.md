# Role: PLANNING (first step of implementer A)

Before writing code, produce a precise implementation plan for the phase and save it to the plan file named
in the phase brief. Read the spec, then read all the code the phase touches (follow call paths; look at
existing analogous features and their tests so the plan reuses patterns).

For each feature (one feature = one commit): files to create or change, the exact types, schemas and
function signatures, behaviour details and edge cases, the tests to add (with concrete cases), and the docs
to update (README, AGENTS.md key contracts, docs/TEMPLATING.md when templates change). Call out any place
where the spec is ambiguous or conflicts with the code, and state the decision you take and why, in a
"Decisions" table near the top. Order features so each commit leaves `npm run check` green. Keep files
under ~250 lines. For UI phases, include a concrete live-check section (steps at 1400x900 and 390x844, how
to point vite at a temp-dir server without committing config changes, how to avoid needing a real LLM).

Then split the commits in two halves: implement the first half yourself (see `implement.md`), and write
"Notes from implementer A" at the end of the plan for implementer B. In your final message, list the
decisions so the orchestrator can review them.
