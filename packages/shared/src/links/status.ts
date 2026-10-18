import { fingerprintMessages, type LinkMessage } from './fingerprint.js';
import type { ItemLink } from '../state/writes.js';

/**
 * How a link stands against the chat as it is now: `intact` (every linked message exists and the fingerprint matches),
 * `changed` (all exist, at least one was edited), `partial` (some were deleted, the rest may be edited) or `gone`
 * (all deleted).
 */
export const linkStatuses = ['intact', 'changed', 'partial', 'gone'] as const;
export type LinkStatus = (typeof linkStatuses)[number];

/**
 * The status of a link against the history messages, indexed by id (`indexById`). Computed on read, never stored. A
 * link with no fingerprint cannot be verified, so it is never `intact`.
 */
export function linkStatus(link: ItemLink, byId: ReadonlyMap<string, LinkMessage>): LinkStatus {
  const found = link.ids.flatMap((id) => byId.get(id) ?? []);
  if (!found.length) return 'gone';
  if (found.length < link.ids.length) return 'partial';
  return link.fingerprint !== undefined && fingerprintMessages(found) === link.fingerprint ? 'intact' : 'changed';
}
