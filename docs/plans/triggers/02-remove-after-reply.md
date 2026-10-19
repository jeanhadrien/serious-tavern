# Triggers, step 2: remove After Reply; workflows after the replies

Design: [docs/explorations/TRIGGERS-PROPOSAL-1.md](../../explorations/TRIGGERS-PROPOSAL-1.md) (its phase 3, done before
the concurrency phase so the scheduler only has one kind of run). Builds on step 1
([01-reply-list.md](01-reply-list.md)).

**Decision (user):** After Reply never reached a release (it exists only on the unmerged PR branches), so it is
deleted outright, with no compatibility path: no placeholder, no migration, no reading of its stored entry fields.
Everything After Reply did is now done by listing a workflow below the reply workflow.

## What the user gets

- Post-reply work (summaries, extraction) is its own workflow in the chat's On reply list, below the workflow that
  replies. It can be switched off per chat.
- The reply is never delayed by it: workflows at the end of the list that cannot reply run after the reply is
  complete, while the composer stays usable (the next message waits for them, as it waited for After Reply).
- A workflow no longer needs a Chat Output: any node that writes (a sink: Chat Output, State Write) is enough.

## Engine (`packages/engine`)

- Delete the After Reply node (`nodes/after-reply/`, its registry entry), `parts.ts`, `executeWorkflow`'s `part` and
  `afterReply` options, `ctx.afterReply`, `PreparedWorkflow.parts` (what runs is the sinks and their upstream nodes,
  as before After Reply), `StateRun`'s `repeated` set, `postRunSeed`, and the validation issue about a Chat Output
  that depends on After Reply. Remove what knip then reports.
- **Validation:** exactly one Chat Input (unchanged) and **at least one sink** (any definition with `sink: true`),
  instead of at least one Chat Output. Message in plain language, e.g. "A workflow must contain at least one node that
  writes something, such as a Chat Output or a State Write."
- **Chat Input** gains two outputs: `replies` (`messages`: the replies the runs above this one saved in this turn,
  in chat order; an empty list for the first run) and `turn` (`number`: the turn's number, as `{{trigger.turn}}`).
  The run context gets the replies from the server (an `executeWorkflow` option, `[]` by default).

## Server

- **Two sections.** The enabled workflows of the list split into:
  - the **reply section**: from the top down to the **last workflow that has a Chat Output node** (static: the
    workflow's nodes), streamed, ending with `turn.complete`/`turn.error` as in step 1;
  - the **after section**: the enabled workflows below it (none of them has a Chat Output). They run after the
    reply section's result is sent, in the turn's queue slot, exactly where After Reply runs ran: announced as
    `running` (`runs` records with `part: 'post'`) in the write that settles the last reply-section run, so the chat
    never shows a gap; the next message waits for them; Stop stops the running one and the rest do not run; each
    settles into the turn's entry through `withRunSettled` and publishes `sessions.changed`; a failure is that run's
    `error` and never the turn's; a server restart reads a `running` one as interrupted (per-run liveness, unchanged).
  - A list with no Chat Output at all has an empty reply section: the turn completes at once with no reply, and every
    workflow runs in the after section.
- **Every run sees what the runs above it did**, in both sections (step 1's rule): their committed writes and the
  chat as it stands (the user message, then the replies). The after section no longer reuses a reply run's history.
- The after section runs unless the reply section was **stopped**. A failed reply run no longer prevents it (each
  workflow is independent; the failure is reported as before). A regenerate that saved no reply still runs no after
  section (its turn is not present).
- Each run has its own random seed (no derived post seed).
- Delete the post-run code that only served After Reply: the stored entry fields `postExecutionId`, `postStatus`,
  `postError` (schema, `effectivePostRun`, the legacy branch of `postOfEntry`, `withPostRun`), and anything in
  `post-turn.ts`/`settle-post-run.ts` that the after section doesn't need (rename or merge files where that makes
  them clearer; `after-section.ts` is a fine name). The state view keeps sending its derived `postStatus`,
  `postExecutionId`, `postError` per turn (from the `post` runs), so the web's status row keeps working.
- **Example pack "Rolling summaries"** (`apps/server/src/examples/rolling-summaries.ts`) becomes two workflows with
  fixed ids: the narrator, unchanged apart from losing the After Reply branch, and a new "Summarize history
  (example)" workflow (Chat Input → Next Chunk (`memory.summaries`, chunk 20, raw window 16) → LLM (the pack's
  summary preset) → State Write `add` with Next Chunk's `link` on its `messages` input). Both must validate
  (`seed-examples.test.ts`); keep the ledger rules (`<pack>/<kind>:<id>` lines, all or nothing).

## Web

- Strings and comments that talk about After Reply or "the after-reply run" say "running after the reply" and name
  the workflow (the status row already does when the view has runs). The node palette updates by itself.
- `docs/FRONTEND-UX.md`: the Escape rule's mention of after-reply runs becomes "workflows running after the reply".

## Docs

- `README.md`: replace "After Reply and post-turn runs" with "Workflows after the reply" (the two sections, the rules
  above, the summaries recipe as two workflows); update "Example seeds", the node list, the validation rule, Chat
  Input's outputs. `docs/TEMPLATING.md` if it mentions After Reply.
- Leave `docs/explorations/` alone: it is the design history.

## Tests

Delete the After Reply and parts tests; port the post-run tests to the after section: a trailing State-Write-only
workflow runs after `turn.complete` and holds the queue slot (a message sent meanwhile waits), sees the reply in its
history and in Chat Input's `replies`, its writes join the turn (deleting the reply undoes them), Stop during it, its
failure (`error` on its run, the turn's replies intact), a restart reading it as interrupted, a list with no Chat
Output, a reply-less workflow ABOVE the reply workflow (runs in the reply section, before it), a failed reply run
followed by an after-section run, regenerate. Validation: a workflow with only a State Write is valid; with no sink
it is not. Chat Input's `replies` and `turn`. The example pack's two workflows validate and seed once.
