import { fingerprintMessages, indexById, type LinkMessage } from './fingerprint.js';
import type { StateWrite } from '../state/writes.js';

const EXCERPT = 40;

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat;
};

/**
 * The check a run's linked writes pass when the server stores them (at settle time, under the session lock), against
 * the chat as it is THEN: `history` is the history messages now, including the turn's own. For every `add` whose item
 * has a link:
 * - a linked id that is not among the history messages drops the write (the message was deleted while the run went on);
 * - a `fingerprint` that does not match the linked messages drops it (they were edited meanwhile: the node took it when
 *   it planned);
 * - no `fingerprint` (a node linked by id alone, e.g. to a reply) takes it from the messages now.
 * Everything else is kept as it is, in order. `label` names the key a write goes to for the warnings. Pure.
 */
export function commitItemLinks(
  writes: readonly StateWrite[],
  history: readonly LinkMessage[],
  label: (write: StateWrite) => string,
): { writes: StateWrite[]; warnings: string[] } {
  const byId = indexById(history);
  const kept: StateWrite[] = [];
  const warnings: string[] = [];
  for (const write of writes) {
    const link = write.op === 'add' ? write.item.messages : undefined;
    if (write.op !== 'add' || !link) {
      kept.push(write);
      continue;
    }
    const drop = (why: string) =>
      warnings.push(`${label(write)}: the item "${excerpt(write.item.text)}" was not saved: ${why}.`);
    const messages = link.ids.map((id) => byId.get(id));
    if (messages.some((message) => !message)) {
      drop('a message it links to is not in the chat any more');
      continue;
    }
    const fingerprint = fingerprintMessages(messages as LinkMessage[]);
    if (link.fingerprint !== undefined && link.fingerprint !== fingerprint) {
      drop('a message it links to was edited while it was being written');
      continue;
    }
    kept.push({ ...write, item: { ...write.item, messages: { ...link, fingerprint } } });
  }
  return { writes: kept, warnings };
}
