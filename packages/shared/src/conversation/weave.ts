import type { ConversationMessage } from './message.js';

/** What the weave reads of a chat message. Any other field is left alone: the messages come back as they went in. */
export type WeaveChatMessage = {
  role: string;
  content: string;
  /** The turn (a thread item's `turnId`). Absent in older chats. */
  executionId?: string;
  /** An assistant message: the run that wrote it. Absent in older chats (then `executionId` is the first run's). */
  runId?: string;
  /** The LLM node whose text the reply is, for the replies of passthrough Chat Outputs only. */
  sourceNodeId?: string;
};

/** What the weave reads of a thread item (a stored item has more). */
export type WeaveItem = {
  text: string;
  /** The messages one LLM node run produced. Absent on a plain item (a key switched from collection to thread). */
  exchange?: readonly ConversationMessage[];
  /** The question of the exchange: used by `threadAlone`, never by the weave (the chat is the user side). */
  input?: ConversationMessage;
  turnId: string;
  runId: string;
};

// A plain item has no exchange: its text is one assistant message (nothing for empty text).
function itemMessages(item: WeaveItem): readonly ConversationMessage[] {
  if (item.exchange?.length) return item.exchange;
  return item.text ? [{ role: 'assistant', content: item.text }] : [];
}

/**
 * The thread on its own, for a prompt: for each item (oldest first) its `input` as a message when `withInputs` and
 * present, then its exchange; a plain item (no exchange) is one assistant message holding its text.
 */
export function threadAlone(
  items: readonly WeaveItem[],
  { withInputs }: { withInputs: boolean },
): ConversationMessage[] {
  return items.flatMap((item) => [...(withInputs && item.input ? [item.input] : []), ...itemMessages(item)]);
}

/** What `weaveThread` reads. */
export type WeaveInput<M extends WeaveChatMessage> = {
  /** The chat as the node received it (Chat Input's or Memory's `history`: active messages, maybe cut). */
  history: readonly M[];
  /** The thread's items, oldest first; items added in the same turn in the order they were written. */
  items: readonly WeaveItem[];
  /** The present turns' ids, oldest first (`StateSnapshot.turnIds`). */
  turnIds: readonly string[];
  /** The turn being run (`ctx.trigger.turnId`): its items belong after the chat when none of its messages is in it. */
  runningTurnId?: string;
};

// The exchange's answer is its last message when that is an assistant message that calls no tool.
const isAnswer = (message: ConversationMessage | undefined): boolean =>
  message?.role === 'assistant' && !message.tool_calls?.length;

/**
 * Weaves a thread into the chat history. The one place that decides where an exchange goes; callers only order and slice
 * the items. Placement is structural, by ids: a chat message's `executionId` is the turn of an item's `turnId`, and the
 * item's answer is the reply with the item's `runId` whose `sourceNodeId` is the LLM node that produced the exchange
 * (`provenance.nodeId` of its assistant messages). Never by message positions, parsed ids or text.
 *
 * - The answer is in the chat: the exchange's messages before its final answer go right before that reply, and the final
 *   answer is dropped (the chat wins, edited or not).
 * - Otherwise (no such reply: a templated output, a run without a reply, an older chat) the whole exchange goes after
 *   the turn's last chat message.
 * - A turn with no chat message in the history goes after the last message of the nearest earlier turn that has one
 *   (`turnIds` gives the order); the running turn's goes after the history's last message; items older than the whole
 *   history are left out, the history was cut on purpose.
 * - Messages without a turn stay where they are; nothing is reordered. The returned list holds the history's own
 *   message objects and the exchange's (not copies).
 * - A plain item (no exchange) is one assistant message with its text, placed after the turn's last chat message.
 *
 * The running turn is treated like any other turn that has messages in the history (an earlier run of it may have
 * replied, and its answer is then in the chat); only when it has none is it placed after the history's last message.
 */
export function weaveThread<M extends WeaveChatMessage>({
  history,
  items,
  turnIds,
  runningTurnId,
}: WeaveInput<M>): (M | ConversationMessage)[] {
  const lastOfTurn = new Map<string, number>();
  history.forEach((message, index) => {
    if (message.executionId) lastOfTurn.set(message.executionId, index);
  });
  // Inserted before / after the history message at an index (-1: before everything), in item order.
  const before = new Map<number, ConversationMessage[]>();
  const after = new Map<number, ConversationMessage[]>();
  const put = (slots: Map<number, ConversationMessage[]>, index: number, messages: readonly ConversationMessage[]) =>
    slots.set(index, [...(slots.get(index) ?? []), ...messages]);

  // Where a turn with no message in the history goes: after the nearest earlier turn that has one.
  const placeByTurnOrder = (turnId: string): number | undefined => {
    if (turnId === runningTurnId) return history.length - 1;
    for (let at = turnIds.indexOf(turnId) - 1; at >= 0; at -= 1) {
      const anchor = lastOfTurn.get(turnIds[at] as string);
      if (anchor !== undefined) return anchor;
    }
    return undefined;
  };

  for (const item of items) {
    const messages = itemMessages(item);
    if (!messages.length) continue;
    const producer = item.exchange?.find((message) => message.provenance)?.provenance?.nodeId;
    const answer =
      producer === undefined
        ? -1
        : history.findIndex(
            (message) =>
              message.role === 'assistant' && message.runId === item.runId && message.sourceNodeId === producer,
          );
    if (answer !== -1) {
      put(before, answer, isAnswer(messages.at(-1)) ? messages.slice(0, -1) : messages);
      continue;
    }
    const anchor = lastOfTurn.get(item.turnId) ?? placeByTurnOrder(item.turnId);
    if (anchor !== undefined) put(after, anchor, messages);
  }

  return [
    ...(after.get(-1) ?? []),
    ...history.flatMap((message, index) => [...(before.get(index) ?? []), message, ...(after.get(index) ?? [])]),
  ];
}
