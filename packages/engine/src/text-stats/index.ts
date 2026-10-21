import { countSlop, fourGrams, MIN_SENTENCE_WORDS, mtld } from './metrics.js';
import { sentences, tokenize } from './tokenize.js';

/**
 * Raw statistics on one assistant reply, uninterpreted. A metric that is undefined for this text is `null`: MTLD on a
 * short text, the overlap with no earlier reply (or no 4-gram in the reply).
 */
export interface TextStats {
  words: number;
  mtld: number | null;
  /** Words found in the slop word list: a count, not a rate. */
  slopWords: number;
  /** Share (0..1) of the reply's 4-grams that also occur in the window. */
  ngramOverlap: number | null;
  /** Sentences of the reply (at least 4 words) that match a sentence of the window exactly, ignoring case and punctuation. */
  recycledSentences: number;
}

/** How many earlier assistant replies the cross-message metrics compare a reply with. */
export const WINDOW_SIZE = 5;

/** A message as the chat stats read it. */
export interface StatsMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'final' | 'streaming' | 'partial';
}

/** What the cross-message metrics need of one text, computed once however many replies compare against it. */
interface TextFeatures {
  tokens: string[];
  fourGrams: string[];
  fourGramSet: Set<string>;
  sentences: string[];
  sentenceSet: Set<string>;
}

function featuresOf(text: string): TextFeatures {
  const tokens = tokenize(text);
  const grams = fourGrams(tokens);
  const own = sentences(text, MIN_SENTENCE_WORDS);
  return { tokens, fourGrams: grams, fourGramSet: new Set(grams), sentences: own, sentenceSet: new Set(own) };
}

function statsOf(reply: TextFeatures, window: TextFeatures[]): TextStats {
  const overlapping = reply.fourGrams.filter((gram) => window.some((earlier) => earlier.fourGramSet.has(gram)));
  return {
    words: reply.tokens.length,
    mtld: mtld(reply.tokens),
    slopWords: countSlop(reply.tokens),
    ngramOverlap: window.length > 0 && reply.fourGrams.length > 0 ? overlapping.length / reply.fourGrams.length : null,
    recycledSentences: reply.sentences.filter((sentence) => window.some((earlier) => earlier.sentenceSet.has(sentence)))
      .length,
  };
}

/**
 * The window a reply is compared with: the last `WINDOW_SIZE` of the assistant replies that come before it. `replies`
 * are the chat history's assistant replies up to the reply (the reply itself excluded), oldest first. The one rule
 * shared by the chat view and the Text Stats node.
 */
export function replyWindow<Reply>(replies: Reply[]): Reply[] {
  return replies.slice(-WINDOW_SIZE);
}

/** The stats of one text against the texts of its window (see `replyWindow`). */
export function textStats(text: string, window: string[]): TextStats {
  return statsOf(featuresOf(text), window.map(featuresOf));
}

/**
 * The stats of every assistant reply of a chat, by message id (user messages and streaming rows get none).
 * `messages` is the chat as shown (the active messages); `history` is the part of it that counts as history (no
 * partial rows). A reply's window is the history replies before it, so a stopped reply gets stats of its own but
 * never enters another reply's window. Each message is analyzed once, so the cost stays roughly linear in the chat.
 */
export function chatStats(messages: StatsMessage[], history: StatsMessage[]): Record<string, TextStats> {
  const historyIds = new Set(history.map((message) => message.id));
  const features = new Map<string, TextFeatures>();
  const featuresFor = (message: StatsMessage) => {
    const known = features.get(message.id) ?? featuresOf(message.content);
    features.set(message.id, known);
    return known;
  };
  const stats: Record<string, TextStats> = {};
  const earlierReplies: StatsMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || message.status === 'streaming') continue;
    stats[message.id] = statsOf(featuresFor(message), replyWindow(earlierReplies).map(featuresFor));
    if (historyIds.has(message.id)) earlierReplies.push(message);
  }
  return stats;
}
