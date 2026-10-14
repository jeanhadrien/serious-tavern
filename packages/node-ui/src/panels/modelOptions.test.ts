import { describe, expect, it } from 'vitest';
import type { ProviderModel } from '@st/shared';
import { filterModels, formatPricing, formatTokens, isListed, modelFacts } from './modelOptions.js';

const models: ProviderModel[] = [
  { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
  { id: 'anthropic/claude-sonnet', name: 'Anthropic: Claude Sonnet' },
  { id: 'meta/llama-3.1-8b-instruct:free' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
];

describe('filterModels', () => {
  const ids = (query: string, limit?: number) => filterModels(models, query, limit).shown.map((model) => model.id);

  it('keeps list order and shows everything for an empty query', () => {
    expect(ids('')).toEqual(models.map((model) => model.id));
    expect(ids('   ')).toHaveLength(4);
  });
  it('matches ids and names case-insensitively', () => {
    expect(ids('GPT')).toEqual(['openai/gpt-4o']);
    expect(ids('claude')).toEqual(['anthropic/claude-sonnet']);
    expect(ids('deepseek v3')).toEqual(['deepseek/deepseek-chat']);
  });
  it('requires every term, in any order', () => {
    expect(ids('free llama')).toEqual(['meta/llama-3.1-8b-instruct:free']);
    expect(ids('free gpt')).toEqual([]);
  });
  it('caps the shown models but reports the full match count', () => {
    expect(filterModels(models, '', 2)).toMatchObject({
      total: 4,
      shown: [{ id: 'openai/gpt-4o' }, { id: 'anthropic/claude-sonnet' }],
    });
    expect(filterModels(models, '', 2).shown).toHaveLength(2);
  });
});

it('tells listed ids from free text by exact match', () => {
  expect(isListed(models, 'openai/gpt-4o')).toBe(true);
  expect(isListed(models, 'openai/gpt-4o:online')).toBe(false);
  expect(isListed([], 'x')).toBe(false);
});

it('formats token counts compactly', () => {
  expect(formatTokens(512)).toBe('512');
  expect(formatTokens(4096)).toBe('4k');
  expect(formatTokens(131072)).toBe('131k');
  expect(formatTokens(200000)).toBe('200k');
  expect(formatTokens(1_000_000)).toBe('1M');
  expect(formatTokens(1_048_576)).toBe('1.05M');
  expect(formatTokens(2_000_000)).toBe('2M');
});

describe('formatPricing', () => {
  it('shows USD per million tokens from per-token prices', () => {
    expect(formatPricing({ prompt: 0.0000025, completion: 0.00001 })).toBe('$2.5 in / $10 out per 1M');
    expect(formatPricing({ prompt: 0.00000015, completion: 0.0000006 })).toBe('$0.15 in / $0.6 out per 1M');
  });
  it('says free only when both prices are zero, and shows a lone price', () => {
    expect(formatPricing({ prompt: 0, completion: 0 })).toBe('free');
    expect(formatPricing({ prompt: 0, completion: 0.000001 })).toBe('$0 in / $1 out per 1M');
    expect(formatPricing({ completion: 0.000002 })).toBe('$2 out per 1M');
  });
  it('is undefined when no price is known', () => {
    expect(formatPricing(undefined)).toBeUndefined();
    expect(formatPricing({})).toBeUndefined();
  });
});

it('joins the known facts of an option and leaves out unknown ones', () => {
  expect(modelFacts({ id: 'a' })).toBe('');
  expect(modelFacts({ id: 'a', contextLength: 128000 })).toBe('128k ctx');
  expect(modelFacts({ id: 'a', contextLength: 128000, pricing: { prompt: 0, completion: 0 } })).toBe('128k ctx · free');
});
