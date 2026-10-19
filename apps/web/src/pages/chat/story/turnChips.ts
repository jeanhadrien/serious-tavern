import type { ChatMessage, PostStatus, SessionStateView } from '@st/shared';
import { describeWrite, itemTexts } from './describeWrite.js';
import { postRunOf } from './postRuns.js';

/** A turn's after-reply run once it ended: the chip says how and links to its log (a running one has none yet). */
type PostNote = { status: Exclude<PostStatus, 'running'>; message?: string; executionId?: string };

/** One run of a turn that ran several, as the card lists it. `workflowName` is absent when the workflow was deleted. */
export type RunNote = {
  executionId: string;
  workflowName?: string;
  part: 'reply' | 'post';
  status: 'running' | 'completed' | 'error' | 'stopped';
  error?: string;
};

type TurnView = SessionStateView['turns'][number];

type DescribedTurn = {
  turnNumber: number;
  lines: string[];
  post?: PostNote;
  /** The turn's runs, in the order they ran: only for a turn that ran more than one (a chat with a list of workflows). */
  runs?: RunNote[];
  /** Items the turn's runs lost at commit time (a linked message changed meanwhile). */
  warnings?: string[];
};

/** What the chip on a turn's last reply shows. */
export type StoryChip = DescribedTurn & {
  /** A reply of the turn was edited after the turn stored its state: the values came from the original text. */
  editedAfter: boolean;
};

/**
 * The turns of a view that still count and stored something, or whose after-reply run has ended (the chip is how
 * its log is reached, whatever came of it), or that lost an item at commit time, by execution id, described once per view. `lines` is one plain-words line per
 * write, in write order.
 */
export type DescribedTurns = ReadonlyMap<string, DescribedTurn>;

const runNote = (run: NonNullable<TurnView['runs']>[number]): RunNote => ({
  executionId: run.executionId,
  part: run.part,
  status: run.status,
  ...(run.workflowName !== undefined && { workflowName: run.workflowName }),
  ...(run.error !== undefined && { error: run.error }),
});

export function describeTurns(view: SessionStateView | undefined): DescribedTurns {
  const described = new Map<string, DescribedTurn>();
  if (!view) return described;
  const texts = itemTexts(view);
  for (const turn of view.turns) {
    if (turn.turnNumber === null) continue;
    const run = postRunOf(turn);
    const post: PostNote | undefined =
      run && run.status !== 'running'
        ? {
            status: run.status,
            ...(run.error !== undefined && { message: run.error }),
            ...(run.executionId !== undefined && { executionId: run.executionId }),
          }
        : undefined;
    const warnings = turn.linkWarnings ?? [];
    // A turn of one run has nothing more to list: its reply carries the log. Several runs, each with its own log and
    // possibly no reply at all, are only reached through the chip.
    const runs = (turn.runs?.length ?? 0) > 1 ? turn.runs?.map(runNote) : undefined;
    if (turn.writes.length || post || warnings.length || runs)
      described.set(turn.executionId, {
        turnNumber: turn.turnNumber,
        lines: turn.writes.map((write) => describeWrite(write, texts)),
        ...(post && { post }),
        ...(runs && { runs }),
        ...(warnings.length && { warnings }),
      });
  }
  return described;
}

/**
 * Which message carries which turn's chip: the LAST reply of the turn that is in the chat (a stopped reply counts,
 * one still streaming does not), so a turn with several replies shows one chip. User messages never get one, and
 * neither does a turn whose replies are all gone. Cheap enough to run on every render of the thread (it is one
 * pass over the messages); the described lines are made once per view.
 */
export function chipsFor(turns: DescribedTurns, messages: readonly ChatMessage[]): Map<string, StoryChip> {
  const chips = new Map<string, StoryChip>();
  if (!turns.size) return chips;
  const last = new Map<string, string>();
  const edited = new Set<string>();
  for (const message of messages) {
    const { executionId } = message;
    if (message.role !== 'assistant' || message.status === 'streaming' || !executionId || !turns.has(executionId))
      continue;
    last.set(executionId, message.id);
    if (message.editedAt) edited.add(executionId);
  }
  for (const [executionId, messageId] of last) {
    const turn = turns.get(executionId);
    if (turn) chips.set(messageId, { ...turn, editedAfter: edited.has(executionId) });
  }
  return chips;
}
