import { z } from 'zod';
import { threadAlone, weaveThread, type WeaveChatMessage, type WeaveItem } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { itemsOf, locateThread } from '../state-key.js';

/**
 * The thread items oldest first, ready for the shared helpers. The fold gives them newest first, and the items of one
 * turn in reverse write order, so reversing the list restores both. An item without a turn (a key switched from
 * collection to thread, hand-edited data) gets the one its turn number stands for, else the running turn's.
 */
function readItems(
  items: readonly Record<string, unknown>[],
  itemTurns: readonly number[] | undefined,
  turnIds: readonly string[],
  runningTurnId: string | undefined,
): WeaveItem[] {
  return items
    .map((item, index): WeaveItem => {
      const turn = itemTurns?.[index];
      return {
        ...(item as WeaveItem),
        text: typeof item.text === 'string' ? item.text : '',
        turnId:
          typeof item.turnId === 'string'
            ? item.turnId
            : ((turn === undefined ? undefined : turnIds[turn - 1]) ?? runningTurnId ?? ''),
        runId: typeof item.runId === 'string' ? item.runId : '',
      };
    })
    .reverse();
}

/**
 * Hands the exchanges stored in a thread key back as messages for a preset slot: the tool calls and tool results of
 * earlier turns that the chat itself does not show. Without a `history` input it is the thread alone (each exchange,
 * with its question when `withInputs`); with one it is that chat with the exchanges woven in, where `weaveThread`
 * (shared) puts them. This node only reads the key, orders the items oldest first and keeps the last `lastN`.
 */
export const thread: NodeDefinition = {
  type: 'thread',
  label: 'Thread',
  description:
    'Gives back the exchanges stored in a state thread key (what an LLM node said and the tools it called). Connect a chat history to weave them into it, tool calls right before the reply they led to.',
  category: 'History',
  inputs: [
    {
      name: 'history',
      label: 'History',
      dataType: 'messages',
      optional: true,
      neverSkips: true,
      description:
        "The chat to weave the exchanges into, for example Chat Input's history. Without it the output is the thread alone",
    },
  ],
  outputs: [
    {
      name: 'messages',
      label: 'Messages',
      dataType: 'messages',
      description: 'The thread alone, or the history with the thread woven in',
    },
  ],
  configSchema: z.object({
    definitionId: z.string().min(1, 'Select a state definition'),
    key: z.string().min(1, 'Select a key'),
    lastN: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Only the newest N exchanges; empty keeps everything the key holds'),
    withInputs: z
      .boolean()
      .default(true)
      .describe(
        'Without a history: put each exchange after the question it answered. Ignored when a history is connected',
      ),
  }),
  defaultConfig: { definitionId: '', key: '', withInputs: true },
  async execute(ctx) {
    // The ports are static: a missing or mistaken key is an error when the node runs.
    const found = await locateThread(ctx.config, (id) => ctx.state.definition(id));
    const { lastN, withInputs } = ctx.config as { lastN?: number; withInputs: boolean };
    const given = ctx.inputs.history;
    if (given !== undefined && !Array.isArray(given))
      throw new Error('Thread needs a list of messages on its History input');

    const view = ctx.state.read(found.definition.id, found.key);
    const all = readItems(
      itemsOf(found, ctx.state.read) as Record<string, unknown>[],
      view?.itemTurns,
      ctx.state.turnIds,
      ctx.trigger.turnId,
    );
    const items = lastN === undefined ? all : all.slice(-lastN);

    const messages = Array.isArray(given)
      ? weaveThread({
          history: given as WeaveChatMessage[],
          items,
          turnIds: ctx.state.turnIds,
          runningTurnId: ctx.trigger.turnId,
        })
      : threadAlone(items, { withInputs });
    ctx.log(
      `${found.label}: ${items.length} of ${all.length} exchanges, ${Array.isArray(given) ? 'woven into the history' : 'alone'}.`,
    );
    return { messages };
  },
};
