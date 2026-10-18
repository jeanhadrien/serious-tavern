import { hashSeed } from '../hash.js';
import type { ChatMessage } from '../models.js';

/** The part of a message a link depends on. */
export type LinkMessage = Pick<ChatMessage, 'id' | 'role' | 'name' | 'content'>;

/**
 * A stable fingerprint of messages: their ids, roles, names and contents in order (32 hex characters, a pure-JS hash;
 * it must never change, stored links carry it). The input is JSON, so no choice of contents can read as another.
 */
export function fingerprintMessages(messages: readonly LinkMessage[]): string {
  const text = JSON.stringify(messages.map((m) => [m.id, m.role, m.name ?? '', m.content]));
  return hashSeed(text)
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/** The messages by id. */
export function indexById<M extends { id: string }>(messages: readonly M[]): Map<string, M> {
  return new Map(messages.map((message) => [message.id, message]));
}
