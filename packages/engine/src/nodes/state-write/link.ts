import { isPlainObject, type ItemLink } from '@st/shared';
import { describeValue } from '../../text.js';

const isMessage = (value: unknown): value is { id: string } =>
  isPlainObject(value) && typeof value.id === 'string' && !!value.id && typeof value.role === 'string';

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * The link a State Write `messages` input stands for: a link (`{ ids, fingerprint? }`, Next Chunk's `link`), a message,
 * or a non-empty list of messages (their ids in order, repeats dropped; Chat Input's `replies`). Anything else is an
 * error naming what arrived. Whether the ids are really messages of the chat is checked when the run settles.
 */
export function messageLink(label: string, value: unknown): ItemLink {
  if (isPlainObject(value) && 'ids' in value) {
    const { ids, fingerprint } = value;
    if (!Array.isArray(ids) || !ids.length || !ids.every(isId))
      throw new Error(`${label}: the link on Messages needs a list of message ids, got ${describeValue(ids)}`);
    if (fingerprint !== undefined && !isId(fingerprint))
      throw new Error(
        `${label}: the link on Messages has a fingerprint that is not text, got ${describeValue(fingerprint)}`,
      );
    return { ids: [...ids], ...(fingerprint === undefined ? {} : { fingerprint }) };
  }
  if (isMessage(value)) return { ids: [value.id] };
  if (Array.isArray(value)) {
    if (!value.length) throw new Error(`${label}: Messages is an empty list, so there is nothing to link to`);
    const wrong = value.find((entry) => !isMessage(entry));
    if (wrong !== undefined)
      throw new Error(`${label}: Messages can only hold messages, got ${describeValue(wrong)} in the list`);
    return { ids: [...new Set((value as { id: string }[]).map((message) => message.id))] };
  }
  throw new Error(
    `${label}: Messages needs a link (ids), a message or a list of messages, got ${describeValue(value)}`,
  );
}
