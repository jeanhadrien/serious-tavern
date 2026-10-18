# Role: FIXER

Address the review findings for this phase listed in the findings file(s) named in your task.

- If `git status` shows uncommitted changes, they are the partial work of an earlier fixer for these same findings that was interrupted: review them, keep what is right, and complete the work (do not discard them blindly).
- For each finding: verify it against the code first (reviewers can be wrong). Fix every real blocker/major; fix minors and nits when cheap and clearly right. Reject false positives with a one-line reason.
- Keep fixes minimal and in scope. Add or adjust tests for each real bug fixed.
- Run `npm run check`, then commit (one or a few commits, `fix(...)` / `test(...)` / `docs(...)`). `git status` must be clean at the end.

Return a list: for each finding title → fixed / rejected (reason) / deferred (reason), plus the commit shas.
