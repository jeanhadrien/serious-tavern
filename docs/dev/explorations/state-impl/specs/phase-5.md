POST-TURN RUNS (STATE-DESIGN-PROPOSAL-3 Part 5 "Post-turn runs"). Work that must not delay or endanger the reply (summaries, extraction) runs as a second, separate run after the turn settles, on the same per-chat queue.

ENGINE
- New node `after-reply` (label 'After Reply', category 'Chat'): no inputs. Outputs: `replies` (messages: the turn's settled assistant messages), `text` (text: their contents joined by "\n\n"), `turn` (number: the turn's number). It only produces values in the post-turn run.
- Partition (in prepareWorkflow, computed once, exposed on the prepared workflow): a sink is a **post-turn sink** if an `after-reply` node is among its transitive upstream nodes; all other sinks (incl. every Chat Output) form the **reply part**. Validation issues (plain language, naming nodes): a Chat Output that depends on an After Reply node is an error ("Chat Output … can't depend on After Reply: replies are written before it runs"). More than one After Reply node is allowed.
- `executeWorkflow` gains a `part: 'reply' | 'post'` option (default 'reply' — existing callers unchanged) and, for 'post', the after-reply payload `{ replies, text, turn }`. Reply part: runs nodes needed by reply sinks only (After Reply and post-only nodes are skipped as "runs after the reply"). Post part: runs nodes needed by post-turn sinks (nodes needed by both parts run again in the post part — acceptable). Both parts get the same state snapshot semantics (the post part's snapshot is taken after the reply part's writes are committed) and the post part buffers writes the same way.
- If a workflow has no post-turn sinks, no post run happens.

SERVER
- After the turn settles (replies + TurnEntry saved, `sessions.changed` published, response/stream delivered), if the prepared workflow has post-turn sinks, run the post part as a **second job on the same TurnRegistry key** so the next message to this session waits for it, and Stop (`POST /api/sessions/:id/stop`) stops it (the user stop reason applies). Do NOT keep the client's SSE turn stream open for it; the reply is complete for the client.
- The post run has its own execution log (saved like any execution, with a field linking it to the turn: e.g. `turnExecutionId`), and the TurnEntry records `postExecutionId` and `postStatus: 'running' | 'completed' | 'error' | 'stopped'` (+ `postError` message on failure). Its state writes are appended to the SAME TurnEntry's writes (so deleting the turn's replies undoes them too) under the session lock via `update`, as one write when the post run settles (failed post runs keep completed nodes' writes, like turns). Publish `sessions.changed` when it settles.
- The post run's failure never touches the reply or the turn's messages.
- If the session was deleted meanwhile, the post run's settle is a no-op (no crash, no resurrected file).
- Startup: a TurnEntry left with `postStatus: 'running'` (server restarted mid post-run) reads as `error` with message "interrupted by a server restart" (computed or fixed on next write; never a startup rewrite pass).
- Tests: ordering (a second message waits for the post run), stop stops it, failure isolation, writes attached to the turn and undone with its replies, workflows without post sinks unchanged, seeded workflows still validate.

API
- The session state view (`GET /api/sessions/:id/state`) per-turn data includes `postStatus`/`postError`. The execution endpoint can fetch the post run's log by id.

WEB
- The chat shows post-run status unobtrusively: while a post run is running for the latest turn, a small spinner/label near the composer or on the turn's chip ("updating memory…"); on failure a toast (`alerts.error`) once, plus the error on the turn's chip popover with a link/button to open the post run's execution details (reuse ExecutionDetails if possible). Sending a message while a post run is running is allowed (the server queues it) — the UI must not break.
- Detect completion via `sessions.changed` for the open session (re-fetch the state view), not polling per token.

DOCS: README, AGENTS.md execution semantics (reply part vs post part, After Reply rules, queueing), docs as needed.
