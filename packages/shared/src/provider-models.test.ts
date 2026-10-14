import { describe, expect, it } from 'vitest';
import { normalizeModels, providerModelListSchema } from './provider-models.js';

describe('normalizeModels', () => {
  it('reads the minimal OpenAI shape and leaves unknown facts out', () => {
    const models = normalizeModels({
      object: 'list',
      data: [{ id: 'gpt-4o', object: 'model', created: 1, owned_by: 'openai' }, { id: 'gpt-4o-mini' }],
    });
    expect(models).toEqual([{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]);
    expect(Object.keys(models![0]!)).toEqual(['id']);
  });

  it('reads the rich OpenRouter shape, converting string prices to numbers', () => {
    const [model] = normalizeModels({
      data: [
        {
          id: 'anthropic/claude-sonnet',
          name: 'Anthropic: Claude Sonnet',
          description: 'A model.',
          context_length: 200000,
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'], tokenizer: 'Claude' },
          top_provider: { context_length: 200000, max_completion_tokens: 64000 },
          pricing: { prompt: '0.0000025', completion: '0.00001', input_cache_read: '0.0000003' },
          supported_parameters: ['reasoning', 'tools', 'top_p'],
        },
      ],
    })!;
    expect(model).toEqual({
      id: 'anthropic/claude-sonnet',
      name: 'Anthropic: Claude Sonnet',
      description: 'A model.',
      contextLength: 200000,
      maxOutputTokens: 64000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportedParameters: ['reasoning', 'tools', 'top_p'],
      pricing: { prompt: 0.0000025, completion: 0.00001 },
    });
  });

  it('keeps zero prices (free models) and drops negative, blank and non-numeric ones', () => {
    const prices = (pricing: unknown) => normalizeModels({ data: [{ id: 'm', pricing }] })![0]!.pricing;
    expect(prices({ prompt: '0', completion: 0 })).toEqual({ prompt: 0, completion: 0 });
    expect(prices({ prompt: '-1', completion: '0.5' })).toEqual({ completion: 0.5 });
    expect(prices({ prompt: '', completion: 'free' })).toBeUndefined();
    expect(prices({ prompt: -1, completion: -1 })).toBeUndefined();
    expect(prices({ prompt: null, completion: {} })).toBeUndefined();
    expect(prices('cheap')).toBeUndefined();
  });

  it('drops unusable limits and keeps null top_provider fields from breaking anything', () => {
    const [model] = normalizeModels({
      data: [
        { id: 'm', context_length: 0, top_provider: { max_completion_tokens: null }, supported_parameters: 'tools' },
      ],
    })!;
    expect(model).toEqual({ id: 'm' });
    expect(normalizeModels({ data: [{ id: 'm', top_provider: null, architecture: 'x', pricing: null }] })).toEqual([
      { id: 'm' },
    ]);
  });

  it('skips entries without a string id, garbage entries and repeated ids', () => {
    expect(
      normalizeModels({
        data: [{ name: 'no id' }, { id: 7 }, { id: '' }, null, 'text', ['x'], { id: 'a' }, { id: 'a', name: 'dup' }],
      }),
    ).toEqual([{ id: 'a' }]);
  });

  it('answers undefined unless the payload has a data array, but accepts an empty one', () => {
    for (const payload of [null, undefined, 'models', 42, [], {}, { data: 'x' }, { data: {} }, [{ id: 'a' }]])
      expect(normalizeModels(payload)).toBeUndefined();
    expect(normalizeModels({ data: [] })).toEqual([]);
  });

  it('produces values the API response schema accepts', () => {
    const models = normalizeModels({ data: [{ id: 'a', pricing: { prompt: '0.1' }, context_length: 10 }] })!;
    expect(providerModelListSchema.parse({ models, fetchedAt: '2026-01-01T00:00:00.000Z' }).models).toEqual(models);
  });
});
