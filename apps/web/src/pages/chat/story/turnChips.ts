import type { ChatMessage, SessionStateView } from '@st/shared';
import { describeWrite, itemTexts } from './describeWrite.js';

/** What the chip on a turn's last reply shows. */
export type StoryChip = {
  turnNumber: number;
  /** One plain-words line per write, in write order. */
  lines: string[];
  /** A reply of the turn was edited after the turn stored its state: the values came from the original text. */
  editedAfter: boolean;
};

/** The turns of a view that still count and stored something, by execution id, described once per view. */
export type DescribedTurns = ReadonlyMap<string, { turnNumber: number; lines: string[] }>;

export function describeTurns(view: SessionStateView | undefined): DescribedTurns {
  const described = new Map<string, { turnNumber: number; lines: string[] }>();
  if (!view) return described;
  const texts = itemTexts(view);
  for (const turn of view.turns)
    if (turn.turnNumber !== null && turn.writes.length)
      described.set(turn.executionId, {
        turnNumber: turn.turnNumber,
        lines: turn.writes.map((write) => describeWrite(write, texts)),
      });
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
