import { chatStats } from '@st/engine';
import { activeMessages, type ApiResponse } from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { historyMessages } from './settle-turn.js';

/**
 * The text stats of a chat's assistant replies, computed on read (nothing is stored). Gated by the `showMessageStats`
 * app setting: off, nothing is computed. The comparison window of a reply is the chat history (`historyMessages`)
 * before it, so a stopped reply gets stats but never feeds another reply's.
 */
export async function sessionStats(
  { sessions, appSettings }: Pick<AppContext, 'sessions' | 'appSettings'>,
  id: string,
): Promise<ApiResponse<'getSessionStats'>> {
  const { showMessageStats } = await appSettings.get();
  const session = await requireEntity(sessions, id, 'Session');
  if (!showMessageStats) return { enabled: false, messages: {} };
  return { enabled: true, messages: chatStats(activeMessages(session.messages), historyMessages(session.messages)) };
}
