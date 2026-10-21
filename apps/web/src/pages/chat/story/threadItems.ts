// Thread keys in the Story state section. The state view carries no key types, so a thread item is recognized by the
// shape the server gives it: `{ id, text, steps, toolCalls, turnId, runId }`, the item without its exchange
// (`viewThreadItem` in shared). No declared item field can look like that (a field is text, number or boolean), so the
// shape is unambiguous.

/** What the view says about one stored exchange; the exchange itself is in the execution log of `runId`. */
export type ThreadSummary = {
  /** Assistant messages the model took to answer. */
  steps: number;
  /** The names of the tool calls the model made, in order. */
  toolCalls: string[];
  /** The execution log that holds the whole exchange (the writing run's id). */
  runId?: string;
};

/** The properties of a thread summary, which are not item fields to list next to the text. */
const SUMMARY_FIELDS: ReadonlySet<string> = new Set(['steps', 'toolCalls', 'turnId', 'runId']);

/** The summary of a thread item as the view shows it, or undefined for any other item. */
export function threadSummaryOf(raw: Record<string, unknown>): ThreadSummary | undefined {
  const { steps, toolCalls, runId } = raw;
  if (typeof steps !== 'number' || !Array.isArray(toolCalls)) return undefined;
  return {
    steps,
    toolCalls: toolCalls.filter((name): name is string => typeof name === 'string'),
    ...(typeof runId === 'string' && runId !== '' && { runId }),
  };
}

/** Whether a property of an item is part of a thread item's summary (to leave out of its declared fields). */
export const isThreadSummaryField = (item: Record<string, unknown>, name: string): boolean =>
  SUMMARY_FIELDS.has(name) && threadSummaryOf(item) !== undefined;

const countText = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** "3 tool calls · 4 steps", or "no tool calls" for a plain answer: what an exchange did, in a few words. */
export function threadNote({ steps, toolCalls }: ThreadSummary): string {
  const parts = [toolCalls.length === 0 ? 'no tool calls' : countText(toolCalls.length, 'tool call')];
  if (steps > 1) parts.push(countText(steps, 'step'));
  return parts.join(' · ');
}

/** The tool names of an exchange, in call order, for a tooltip; empty when it made no calls. */
export const toolNames = ({ toolCalls }: ThreadSummary): string => toolCalls.join(', ');

/** The key's items as a count: "1 exchange" or "3 exchanges". */
export const exchangeCount = (count: number): string => countText(count, 'exchange');
