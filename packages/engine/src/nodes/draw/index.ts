import { z } from 'zod';
import { DRAW_STATE_KEY } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { candidates, entryOutput, loadCollections, type Candidate } from '../../collections.js';
import { describeValue } from '../../text.js';
import { entryKey, memoryText, recentEntryKeys } from './recent.js';
import { describeDraw, drawEntries, type DrawFilters } from './select.js';

type DrawConfig = DrawFilters & {
  collectionIds: string[];
  count: number;
  useWeights: boolean;
  avoidRecent: number;
};

const level = z.number().int().min(1, 'Levels go from 1 to 5').max(5, 'Levels go from 1 to 5');

/** The `maxLevel` input: a finite number, or text holding one (enum chat settings store text). */
function levelInput(value: unknown): number {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof number === 'number' && Number.isFinite(number)) return number;
  throw new Error(
    `Max level must be a number, got ${typeof value === 'string' ? `"${value.slice(0, 40)}"` : describeValue(value)}`,
  );
}

/** The `tags` input: a list of text, or comma-separated text. */
function tagsInput(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',');
  if (!Array.isArray(value))
    throw new Error(`Tags must be a list or comma-separated text, got ${describeValue(value)}`);
  for (const item of value)
    if (typeof item !== 'string') throw new Error(`Tags must be text, got ${describeValue(item)}`);
  return value as string[];
}

export const draw: NodeDefinition = {
  type: 'draw',
  label: 'Draw',
  description: 'A weighted random pick among collection entries that pass filters',
  category: 'Lore',
  inputs: [
    {
      name: 'maxLevel',
      label: 'Max level',
      dataType: 'number',
      requiredIfConnected: true,
      description: 'Overrides Max level; a number or numeric text',
    },
    {
      name: 'tags',
      label: 'Tags',
      dataType: 'any',
      requiredIfConnected: true,
      description: 'Replaces Require tags: a list of tags or comma-separated text',
    },
  ],
  outputs: [
    {
      name: 'entry',
      label: 'Entry',
      dataType: 'object',
      optional: true,
      description: 'The first drawn entry; absent when nothing is eligible',
    },
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      optional: true,
      description:
        "The drawn entry's text (all drawn texts, one per line, when Count > 1); absent when nothing is eligible",
    },
    {
      name: 'level',
      label: 'Level',
      dataType: 'number',
      optional: true,
      description: "The first drawn entry's level; absent when nothing is drawn or it has no level",
    },
    {
      name: 'entries',
      label: 'Entries',
      dataType: 'array',
      description: 'Every drawn entry; empty when nothing is eligible',
    },
    { name: 'reason', label: 'Reason', dataType: 'text', description: 'Why these entries, or why none' },
  ],
  configSchema: z
    .object({
      collectionIds: z.array(z.string().min(1)).default([]).describe('Collections to draw from'),
      count: z.number().int().min(1).default(1).describe('Entries to draw, never the same one twice'),
      requireTags: z.array(z.string()).default([]).describe('Entries must have all of these tags'),
      anyTags: z.array(z.string()).default([]).describe('Entries must have at least one of these tags'),
      excludeTags: z.array(z.string()).default([]).describe('Entries must have none of these tags'),
      minLevel: level.optional(),
      maxLevel: level.optional(),
      useWeights: z.boolean().default(true).describe('Off: every eligible entry has the same chance'),
      avoidRecent: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Skip entries drawn in the last N turns of this chat; 0 = off'),
    })
    .superRefine((config, issues) => {
      // Object-level: zod returns a `.default()` value without running the array's own checks.
      if (!config.collectionIds.length)
        issues.addIssue({ code: 'custom', path: ['collectionIds'], message: 'Select at least one collection' });
      if (config.minLevel !== undefined && config.maxLevel !== undefined && config.minLevel > config.maxLevel)
        issues.addIssue({ code: 'custom', path: ['maxLevel'], message: 'Max level must be at least min level' });
    }),
  defaultConfig: {
    collectionIds: [],
    count: 1,
    requireTags: [],
    anyTags: [],
    excludeTags: [],
    useWeights: true,
    avoidRecent: 0,
  },
  async execute(ctx) {
    const config = ctx.config as DrawConfig;
    // Both inputs are requiredIfConnected: present here means connected, so a skipped source skips the node.
    const filters: DrawFilters = {
      requireTags: Object.hasOwn(ctx.inputs, 'tags') ? tagsInput(ctx.inputs.tags) : config.requireTags,
      anyTags: config.anyTags,
      excludeTags: config.excludeTags,
      minLevel: config.minLevel,
      maxLevel: Object.hasOwn(ctx.inputs, 'maxLevel') ? levelInput(ctx.inputs.maxLevel) : config.maxLevel,
    };
    const collections = await loadCollections(ctx, config.collectionIds);
    // Off (0): nothing is read or remembered. On: what this node drew in the last N turns of the chat is left
    // out, and what it draws now is remembered under its own `draws` key (undone with the reply).
    const recent =
      config.avoidRecent > 0
        ? recentEntryKeys(ctx.state.own(DRAW_STATE_KEY), ctx.state.turn, config.avoidRecent)
        : undefined;
    const options = {
      count: config.count,
      useWeights: config.useWeights,
      ...(recent && { isExcluded: (candidate: Candidate) => recent.has(entryKey(candidate)) }),
    };
    const result = drawEntries(candidates(collections), filters, options, ctx.random);
    const reason = describeDraw(result, filters, options);
    // Nothing eligible: `entry`, `text` and `level` are absent (a node that requires them is skipped).
    if (!result.drawn.length) return { entries: [], reason };
    if (recent)
      for (const candidate of result.drawn)
        ctx.writeState({
          target: { kind: 'node', key: DRAW_STATE_KEY },
          op: 'add',
          item: { text: memoryText(candidate.entry.text), entryKey: entryKey(candidate) },
        });
    const entries = result.drawn.map(entryOutput);
    const first = entries[0]!;
    return {
      entry: first,
      text: entries.map((entry) => entry.text).join('\n'),
      // A number, so a preset can word the entry by level: `{{#if (eq input.level "1")}}`.
      ...(first.level !== undefined && { level: first.level }),
      entries,
      reason,
    };
  },
};
