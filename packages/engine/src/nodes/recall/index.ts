import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { candidates, entryOutput, loadCollections, type Candidate } from '../../collections.js';
import { toText } from '../../text.js';
import { anyMatch, keywordMatcher } from './match.js';

type RecallConfig = {
  collectionIds: string[];
  scanMessages: number;
  caseSensitive: boolean;
  wholeWords: boolean;
  maxEntries: number;
  maxChars: number;
  separator: string;
};

/** Keeps matched entries in order until `maxEntries`, or until the next one would push the text past `maxChars`. */
function limit(matched: Candidate[], { maxEntries, maxChars, separator }: RecallConfig): Candidate[] {
  const kept: Candidate[] = [];
  let length = 0;
  for (const candidate of matched) {
    if (kept.length >= maxEntries) break;
    const next = length + (kept.length ? separator.length : 0) + candidate.entry.text.length;
    // Stop at the first entry that doesn't fit: a later, shorter one would break the collection order.
    if (maxChars > 0 && next > maxChars) break;
    kept.push(candidate);
    length = next;
  }
  return kept;
}

export const recall: NodeDefinition = {
  type: 'recall',
  label: 'Recall',
  description: 'Entries of collections whose keywords appear in the recent chat',
  category: 'Lore',
  inputs: [
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      // An extra: when its source is skipped, Recall still scans the messages.
      neverSkips: true,
      description: 'Extra text to scan, besides the recent messages',
    },
  ],
  outputs: [
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      description: "Matched entries' text, joined; empty when nothing matched",
    },
    {
      name: 'entries',
      label: 'Entries',
      dataType: 'array',
      description: 'Matched entries: collectionId, entryId, title, text, keywords, tags, level',
    },
    { name: 'count', label: 'Count', dataType: 'number', description: 'How many entries matched (after the limits)' },
  ],
  configSchema: z
    .object({
      collectionIds: z.array(z.string().min(1)).default([]).describe('Collections to read, in this order'),
      scanMessages: z
        .number()
        .int()
        .min(0)
        .default(4)
        .describe('Recent history messages to scan, besides the current message'),
      caseSensitive: z.boolean().default(false),
      wholeWords: z.boolean().default(true).describe('Keywords only match whole words'),
      maxEntries: z.number().int().min(1).default(5),
      maxChars: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Stop adding entries past this many characters; 0 = no limit'),
      separator: z.string().default('\n\n').describe('Between the entries of the text output'),
    })
    // Object-level: zod returns a `.default()` value without running the array's own checks.
    .refine((config) => config.collectionIds.length > 0, {
      path: ['collectionIds'],
      message: 'Select at least one collection',
    }),
  defaultConfig: {
    collectionIds: [],
    scanMessages: 4,
    caseSensitive: false,
    wholeWords: true,
    maxEntries: 5,
    maxChars: 0,
    separator: '\n\n',
  },
  access: () => ({ reads: [{ kind: 'messages' }], writes: [] }),
  async execute(ctx) {
    const config = ctx.config as RecallConfig;
    const collections = await loadCollections(ctx, config.collectionIds);
    // Each text is searched on its own, so a keyword never matches across two messages.
    const texts = [
      ...(config.scanMessages > 0 ? ctx.history.slice(-config.scanMessages) : []).map((message) => message.content),
      ctx.trigger.message,
      ...(ctx.inputs.text != null ? [toText(ctx.inputs.text)] : []),
    ];
    const options = { caseSensitive: config.caseSensitive, wholeWords: config.wholeWords };
    const matched = candidates(collections).filter(({ entry }) => {
      const matchers = (entry.keywords ?? []).flatMap((keyword) => keywordMatcher(keyword, options) ?? []);
      return matchers.length > 0 && anyMatch(matchers, texts);
    });
    const kept = limit(matched, config);
    if (kept.length < matched.length)
      ctx.log(
        `Matched ${matched.length} entries; kept ${kept.length} (max entries ${config.maxEntries}${config.maxChars ? `, max characters ${config.maxChars}` : ''}).`,
      );
    return {
      text: kept.map(({ entry }) => entry.text).join(config.separator),
      entries: kept.map(entryOutput),
      count: kept.length,
    };
  },
};
