# Triggers, step 1: an ordered list of workflows per reply (run one after another)

Design: [docs/explorations/TRIGGERS-PROPOSAL-1.md](../../explorations/TRIGGERS-PROPOSAL-1.md) (phase 1). This step
replaces "a chat runs one workflow" with "a chat runs an ordered, toggleable list of workflows on each reply". The
workflows run **strictly one after another**; running independent ones at the same time is step 2, retiring After
Reply is step 3. Stored data rules of `AGENTS.md` apply in full: additive, backward compatible, stored sessions are
never rewritten on read.

The result must always equal running the enabled workflows top to bottom, each seeing what the ones above it wrote
and replied.

## Part A: shared, engine, server

### Data

- **Reply list.** `sessionSchema` gains `triggers?: { reply: ReplyEntry[] }` (passthrough), with
  `ReplyEntry = { workflowId: string, enabled: boolean }` (passthrough).
- **`replyWorkflows(session)`** (shared, new `packages/shared/src/triggers.ts`, table tests) is the only reader:
  the stored list when it is an array with at least one entry that parses (entries that don't parse are skipped; a
  repeated `workflowId` keeps its first entry), otherwise `[{ workflowId: session.workflowId, enabled: true }]`.
  Stored sessions are not parsed on read, so it takes the raw value.
- **`session.workflowId` stays** and mirrors the list's first entry: every write of the list writes it too, so
  older readers keep working. New code never reads it to decide what runs.
- **Messages** gain `runId?: string`: the execution log id of the run that wrote the reply. Every new assistant
  message gets it. Readers that open a message's log use `runId ?? executionId`.
- **Turn entries** gain `runs?: TurnRun[]`, in the order they ran:
  `TurnRun = { executionId, workflowId, part: 'reply' | 'post', status: 'running' | 'completed' | 'error' | 'stopped', error? }`
  (passthrough, `.catch` per field like the post fields, `error` cut to `POST_ERROR_LIMIT`). A new entry records
  every run; an entry without `runs` is a legacy entry and reads exactly as before.
- **New entries stop writing** `postExecutionId`/`postStatus`/`postError`. The state view still sends those three
  fields per turn, **derived** from the post runs for new entries (any `running` → running; else the first `error`
  with its text; else `stopped` if any; else `completed`; `postExecutionId` = the first post run), and as stored for
  legacy entries. The web keeps working unchanged until Part B.
- **Node-private state is scoped by workflow.** Node ids are only unique within a workflow (the example packs use
  fixed ids such as `draw` and `trigger`). The `node` target gains `workflowId?: string`; every new node write carries
  the writing run's workflow id. A node reads the writes whose target has its workflow id **or no workflow id**
  (legacy writes, made when a chat ran one workflow), so existing chats read exactly as before.

### API (contract first, `packages/shared/src/api/`)

- `updateSession`: `triggers?: { reply: ReplyEntry[] }`, a whole replace. At least one entry; a repeated
  `workflowId` is `400 TRIGGERS_INVALID`; an unknown workflow is `404` as today. A legacy `workflowId` in a patch
  replaces the list with `[{ workflowId, enabled: true }]`; both in one patch is `400 TRIGGERS_INVALID`. Like every
  metadata patch it never advances `updatedAt`.
- `createSession`: `workflowId` and `triggers` both optional, exactly one required (`400` otherwise).
- `sendMessageResult` (and so `turn.complete` and failure details) gains `executions?: ExecutionLog[]`: the log of
  every run of the streamed section, in order. `execution` stays: the first run's log on success, the failing run's
  log on failure.
- `turnEventSchema`: a new `run.start { type, runId, workflowId, workflowName }` before each run's node events; the
  node events gain an optional `runId`. `turn.start` keeps carrying the turn id.
- State view (`GET /api/sessions/:id/state`): each turn gains `runs` (the restart rule applied per run: a stored
  `running` the server does not hold reads as `error`, see `effectivePostRun`), each with the workflow's current name
  when it still exists. Node writes are labelled with their own workflow's node names.
- `DELETE /api/workflows/:id` is `409` while any session's `replyWorkflows` lists it (today: `session.workflowId`).

### Running a turn (`services/chat.ts` and friends)

- **Before anything is stored**, every **enabled** workflow is prepared (in list order). The first invalid one
  answers `WORKFLOW_INVALID` exactly as today. No enabled workflow answers `400 NO_ENABLED_WORKFLOW` and stores
  nothing.
- **The turn id** is the first run's execution id: it is the entry's `executionId`, the user message's and every
  reply's `executionId`, and `turn.start`'s id. So turn presence, alternatives, chips and message links need no
  change.
- **The streamed section** runs the reply part of each enabled workflow, in list order:
  - Run *k* starts from the turn-start state **plus the writes runs 1..k-1 already committed** in this turn (whether
    or not the entry would count yet), and from the turn-start history **plus the replies runs 1..k-1 saved**.
    `trigger.turn` and `trigger.message` are the same for every run.
  - Chat settings resolve per run against that run's workflow (`resolveChatSettings`).
  - Each run settles in its own `sessions.silent.update`: the first creates the entry (`settleTurn`), later ones
    update it through a new shared helper (`withRunSettled`, built like `withPostRun` on `withUpdatedTurnEntry`):
    its writes appended after everything earlier, `replies` added, `completed` true only if every reply run
    completed, `linkWarnings` appended (same limits), its `runs` record appended. The link check (`commitLinks`) runs
    per run, against the chat as it is then.
  - A run that fails keeps what it completed (as today) and **the later runs still run**. A stop ends the running run
    and the rest of the list does not run (not recorded).
  - The section ends with `turn.complete` when every run succeeded; otherwise with the existing error for the first
    failure or the stop (`WORKFLOW_EXECUTION_FAILED` naming the workflow, or `TURN_STOPPED`), after the remaining runs
    finished, with every saved message in the details.
  - One `sessions.changed` when the section settles (not per run).
- **The after-reply section** (the queue slot after `turn.complete`, as today's post run): the After Reply part of
  each enabled workflow that has one and whose reply run ran to the end, in list order, each its own run
  (`part: 'post'`, seed `postRunSeed` of that workflow's reply-run seed, After Reply's `replies` = that workflow's own
  replies). Each settles into the same entry like a reply run (writes appended after everything earlier) and
  publishes `sessions.changed` as today. Liveness (`TurnRegistry.hasPostRun`) works per run id. A stop ends the
  running one and skips the rest. After Reply work running after **all** reply parts (rather than after its own
  workflow's) is a deliberate exception kept until step 3 retires After Reply: it never delays a reply.
- **Regenerate** runs the whole enabled list again as one new alternative; every reply of every run carries
  `alternativeOf`, and the existing rules (no reply → entry not completed, no after-reply section) apply to the turn.
- **Chat settings**: `PATCH` checks values against the union of the declarations of every listed workflow (list
  order, `usableSettings`: first declaration wins); the preset preview with a session uses the same union.

### Tests

Table tests for `replyWorkflows`, `withRunSettled` and the node-key scoping in shared; server tests for: a two-workflow
turn (second sees the first's reply in history and its writes in `{{state.*}}`; replies in list order; one entry
with two runs; message `runId`s), disabled entries skipped, `NO_ENABLED_WORKFLOW`, a failing first run with a
succeeding second, stop mid-list, two workflows each with an After Reply part, regenerate over two workflows, the
PATCH rules, create with `triggers`, the workflow delete check, the union for settings, two workflows with a node of
the same id keeping separate node state, and a legacy session (no `triggers`, a legacy entry with post fields) reading
and running exactly as before. Contract coverage (`app.test.ts`) and response-schema checks as usual.

## Part B: web

- **"On reply" section** at the top of the chat panel (`ChatPanel`, above Settings), replacing the header's workflow
  select:
  - one row per entry: the workflow's name (a link that opens it in the editor; an unknown id shows
    `Unknown workflow (id)`), an on/off toggle, a remove button (not on the only row);
  - reordering through `SortableList` (up/down buttons and `Alt+↑/↓` included);
  - an "Add workflow" picker listing the workflows not in the list (no duplicates);
  - each change saves at once with `PATCH { triggers }` (one PATCH in flight, answers applied in order, only
    `triggers`/`workflowId` taken from the answer, like the settings saver), never gated by a running turn
    (it applies from the next turn).
- **New chat** copies the open chat's list (`replyWorkflows`), order and toggles included; with no chat open, the
  Default Assistant alone (as today).
- **Settings section** shows the union of the listed workflows' declarations (same rule as the server).
- **Streaming** keys rows by `runId` + node id, handles `run.start` and several runs in one stream, and settles from
  `executions`/`assistantMessages`.
- **Turn chip**: lists the turn's runs (workflow name, part, status, its log through `ExecutionDetails`); the
  after-reply status row keeps working from the derived post fields, and says which workflow is running when there
  are runs.
- Docs: README (user-facing "On reply"), `docs/FRONTEND-UX.md` where behaviour is new.
