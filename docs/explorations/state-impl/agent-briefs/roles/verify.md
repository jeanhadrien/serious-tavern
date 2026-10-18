# Role: VERIFIER

Final verification of this phase. Do not change code unless a check fails; if it does, fix minimally, re-run, and commit.
1. Run `npm run check` and report the result (test counts).
2. Conventions and docs pass over `git diff <base>..HEAD`: check the AGENTS.md rules the diff touches (contract-first API, additive schemas, locks via update, no hand-written hint or op lists, icons with aria-label+title, files under ~250 lines, knip-clean) and that README, AGENTS.md and the docs the phase touched match the code. Fix what is cheap and clearly right (docs wording, a missing aria-label) in one `docs:`/`fix:` commit; report anything bigger.
3. Confirm `git status` is clean and list `git log --oneline <base>..HEAD`.
4. Live smoke test against a temp data dir (ground rules): start the server, exercise this phase's behaviour through the HTTP API with curl (create what is needed, send a chat message that exercises the new nodes if applicable; LLM calls cannot reach a real provider, so prefer workflows whose replies don't need an LLM, or point an LLM node at a small local fake OpenAI-compatible server you start yourself from the scratch dir), and report what you observed. Clean up all processes and temp dirs.
5. Write a short user-facing "how to try it" note for this phase to <scratch>/plans/phase-<N>-howto.md (what to click / which nodes to wire / what to expect), in the style of docs/explorations/state-impl/howto/phase-3-howto.md.

Return: check result, commit list, smoke-test observations, and any known limitation.
