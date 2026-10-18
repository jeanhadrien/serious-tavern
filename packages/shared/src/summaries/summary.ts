import { z } from 'zod';
import { hashSeed } from '../hash.js';
import type { ChatMessage } from '../models.js';

/**
 * Summaries of older history (a chat's `session.summaries`). A summary covers an ordered list of messages by id and
 * records a fingerprint of what those messages said; it is used only while they are all still in the chat, unchanged.
 * Summaries belong to the messages they cover, not to the turn that wrote them: deleting that turn's replies keeps
 * them (unlike story state), and an edit or delete only makes the summary invalid until it is replaced.
 */

/** The part of a message a summary depends on. */
export type SummaryMessage = Pick<ChatMessage, 'id' | 'role' | 'name' | 'content'>;

/** A summary set's name: short and key-like, so it can be used as a key or in a template later. */
export const SUMMARY_SET_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,39}$/;
export const summarySetNameSchema = z
  .string()
  .trim()
  .regex(SUMMARY_SET_PATTERN, 'Use 1-40 letters, digits, "_" or "-" (not starting with "-")');

export const summarySchema = z
  .object({
    id: z.string().min(1),
    /** The covered messages, in chat order. */
    messageIds: z.array(z.string()).min(1),
    fingerprint: z.string().min(1),
    text: z.string(),
    createdAt: z.string(),
    /** The run (reply or after-reply) that wrote it. */
    executionId: z.string(),
  })
  .passthrough();
export type Summary = z.infer<typeof summarySchema>;

/** Next Chunk's `chunk` output, and what Save Summary needs to store a summary of it. */
export const chunkRefSchema = z.object({
  set: summarySetNameSchema,
  messageIds: z.array(z.string()).min(1),
  fingerprint: z.string().min(1),
  /** The invalid summary this chunk re-plans: it is removed when the new one is stored. */
  replaces: z.string().optional(),
});
export type ChunkRef = z.infer<typeof chunkRefSchema>;

/** What a Save Summary node asked to store, as the run resolves it. The session adds `createdAt` and `executionId`. */
export type SummaryWrite = {
  /** `<execution>:<node>:<n>` */
  id: string;
  nodeId: string;
  set: string;
  messageIds: string[];
  fingerprint: string;
  text: string;
  replaces?: string;
};

/**
 * A stable fingerprint of messages: their ids, roles, names and contents in order (32 hex characters, a pure-JS hash;
 * it must never change, stored summaries carry it). The input is JSON, so no choice of contents can read as another.
 */
export function fingerprintMessages(messages: readonly SummaryMessage[]): string {
  const text = JSON.stringify(messages.map((m) => [m.id, m.role, m.name ?? '', m.content]));
  return hashSeed(text)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/** The messages by id, for the checks below. */
export function indexById<M extends { id: string }>(messages: readonly M[]): Map<string, M> {
  return new Map(messages.map((message) => [message.id, message]));
}

/** The covered messages that are still in the chat, in the summary's order; undefined when one is gone. */
function coveredMessages(ids: readonly string[], byId: ReadonlyMap<string, SummaryMessage>) {
  const found: SummaryMessage[] = [];
  for (const id of ids) {
    const message = byId.get(id);
    if (!message) return undefined;
    found.push(message);
  }
  return found;
}

/**
 * Whether the summary still describes the chat: every covered id is among `byId` (the history messages) and the
 * fingerprint of those messages equals the stored one.
 */
export function summaryIsValid(
  summary: Pick<Summary, 'messageIds' | 'fingerprint'>,
  byId: ReadonlyMap<string, SummaryMessage>,
): boolean {
  const found = coveredMessages(summary.messageIds, byId);
  return !!found && fingerprintMessages(found) === summary.fingerprint;
}

/**
 * The readable summaries of a stored `session.summaries`, by set. Stored sessions are never parsed on read, so this is
 * the only way to read them: anything malformed (a set that is not a list, an item that is not a summary) is skipped
 * and nothing is repaired or rewritten. Sets with no readable summary are left out.
 */
export function readSummaries(raw: unknown): Record<string, Summary[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const sets: [string, Summary[]][] = [];
  for (const [set, items] of Object.entries(raw)) {
    if (!Array.isArray(items)) continue;
    const readable = items.flatMap((item) => {
      const parsed = summarySchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    if (readable.length) sets.push([set, readable]);
  }
  return Object.fromEntries(sets);
}
