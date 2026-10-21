import { z } from 'zod';
import { replyWindow, textStats } from '../../text-stats/index.js';
import type { NodeDefinition } from '../../types.js';

/**
 * The texts of the assistant replies in a `messages` value, oldest first. Messages ports carry more than one shape,
 * so `role` and `content` are read defensively; a stopped or still streaming row is never a comparison text (the
 * same rule as the chat view's window).
 */
function assistantTexts(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message): string[] => {
    if (typeof message !== 'object' || message === null) return [];
    const { role, content, status } = message as Record<string, unknown>;
    const stopped = status === 'partial' || status === 'streaming';
    return role === 'assistant' && typeof content === 'string' && !stopped ? [content] : [];
  });
}

/**
 * Measures a text (normally a reply about to be sent) with the same raw metrics the chat view shows under replies,
 * and hands them to the rest of the workflow, for example as Trigger signals. Compared with the last assistant
 * replies of `history`, or of the chat without this turn's own replies.
 */
export const textStatsNode: NodeDefinition = {
  type: 'text-stats',
  label: 'Text Stats',
  description: 'Word count, vocabulary diversity, overused words and repetition of a text against earlier replies',
  category: 'Chat',
  inputs: [
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      required: true,
      description:
        'The text to measure. A messages value connected here becomes a role-prefixed transcript ("assistant: ..."), and the role names are measured too: connect a single reply text, not a message list',
    },
    {
      name: 'history',
      label: 'History',
      dataType: 'messages',
      neverSkips: true,
      description:
        "The messages to compare against. When not connected, the chat's history without the replies of this turn",
    },
  ],
  outputs: [
    { name: 'words', label: 'Words', dataType: 'number', description: 'Number of words' },
    {
      name: 'mtld',
      label: 'MTLD',
      dataType: 'number',
      optional: true,
      description:
        'Vocabulary diversity (higher is more varied). Absent for a text too short to measure; an absent signal counts as 0 in a Trigger',
    },
    {
      name: 'slopWords',
      label: 'Slop words',
      dataType: 'number',
      description: 'How many words come from a list of words that language models overuse',
    },
    {
      name: 'ngramOverlap',
      label: '4-gram overlap',
      dataType: 'number',
      optional: true,
      description:
        'Share (0 to 1) of the text’s four-word sequences found in the last replies. Absent with no earlier reply or no four-word sequence; an absent signal counts as 0 in a Trigger',
    },
    {
      name: 'recycledSentences',
      label: 'Recycled sentences',
      dataType: 'number',
      description: 'Sentences repeated word for word from the last replies',
    },
    {
      name: 'stats',
      label: 'Stats',
      dataType: 'object',
      description: 'All of the above in one object; a metric that could not be measured is null',
    },
  ],
  configSchema: z.object({}),
  defaultConfig: {},
  async execute(ctx) {
    const text = String(ctx.inputs.text ?? '');
    const earlier =
      ctx.inputs.history !== undefined
        ? ctx.inputs.history
        : ctx.history.filter((message) => !ctx.replies.some((reply) => reply.id === message.id));
    const stats = textStats(text, replyWindow(assistantTexts(earlier)));
    const { mtld, ngramOverlap } = stats;
    if (mtld === null) ctx.log('MTLD is absent: the text is too short to measure.');
    if (ngramOverlap === null)
      ctx.log('4-gram overlap is absent: no earlier reply to compare with, or no 4-gram in the text.');
    return {
      words: stats.words,
      slopWords: stats.slopWords,
      recycledSentences: stats.recycledSentences,
      ...(mtld === null ? {} : { mtld }),
      ...(ngramOverlap === null ? {} : { ngramOverlap }),
      stats,
    };
  },
};
