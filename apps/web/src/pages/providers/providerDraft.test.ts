import { expect, it } from 'vitest';
import { builtInProviders, type ProviderView } from '@st/shared';
import { classifyProviderChange, draftChanged, draftToBody, toDraft } from './providerDraft.js';

const provider = (extra: Partial<ProviderView> = {}): ProviderView => ({
  id: '4c8f7d0e-34a3-4c7b-9b1f-6a3f0f2bb0a1',
  name: 'Local',
  kind: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  headers: { 'X-One': '1' },
  messageName: 'name',
  reasoningFields: ['reasoning', 'reasoning_content'],
  replayFields: [],
  reasoningReplayField: null,
  extraBody: {},
  overrides: [{ match: 'deepseek/*', messageName: null }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  builtIn: false,
  ...extra,
});

it('round-trips a provider through the draft', () => {
  const draft = toDraft(provider({ secret: 'local' }));
  expect(draft.advanced).toContain('X-One: "1"');
  const result = draftToBody(draft, 'openai-compatible');
  expect(result).toEqual({
    ok: true,
    body: {
      name: 'Local',
      kind: 'openai-compatible',
      baseUrl: 'http://localhost:8080/v1',
      secret: 'local',
      messageName: 'name',
      reasoningFields: ['reasoning', 'reasoning_content'],
      replayFields: [],
      reasoningReplayField: null,
      headers: { 'X-One': '1' },
      extraBody: {},
      overrides: [{ match: 'deepseek/*', messageName: null }],
    },
  });
  expect(draftChanged(draft, provider({ secret: 'local' }))).toBe(false);
});

it('omits a blank secret, keeps "don\'t send names" as null and drops blank reasoning fields', () => {
  const draft = { ...toDraft(provider()), secret: '  ', messageName: null, reasoningFields: ['b', ' ', 'a '] };
  const result = draftToBody(draft, 'openai-compatible');
  if (!result.ok) throw new Error(result.errors.join());
  expect(result.body).not.toHaveProperty('secret');
  expect(result.body.messageName).toBeNull();
  expect(result.body.reasoningFields).toEqual(['b', 'a']);
});

it('sends empty values for YAML keys that are missing or empty, so saving clears them', () => {
  for (const advanced of ['', 'headers:\nextraBody: ~']) {
    const result = draftToBody({ ...toDraft(provider()), advanced }, 'openai-compatible');
    expect(result.ok && [result.body.headers, result.body.extraBody, result.body.overrides]).toEqual([{}, {}, []]);
  }
});

it('reports YAML and validation problems in plain language', () => {
  const errors = (changes: object) => {
    const result = draftToBody({ ...toDraft(provider()), ...changes }, 'openai-compatible');
    return result.ok ? [] : result.errors;
  };
  expect(errors({ advanced: 'headers: [unclosed' })[0]).toMatch(/^YAML: /);
  expect(errors({ advanced: '- just a list' })).toEqual([
    'YAML: must be a mapping with replayFields, reasoningReplayField, headers, extraBody and overrides',
  ]);
  expect(errors({ advanced: 'headers: {}\nbaseUrl: x' })[0]).toContain('unknown key "baseUrl"');
  expect(errors({ advanced: 'overrides:\n  - messageName: null' })[0]).toMatch(/^YAML overrides\.0\.match: /);
  expect(errors({ advanced: 'headers:\n  X-Count: 3' })[0]).toMatch(/^YAML headers\.X-Count: /);
  expect(errors({ baseUrl: 'ftp://host' })[0]).toMatch(/^Base URL: /);
  expect(errors({ secret: 'has space' })[0]).toMatch(/^Secret: /);
  expect(errors({ messageName: ' ' })[0]).toMatch(/^Message name field: /);
  expect(errors({ name: ' ' })[0]).toMatch(/^Name: /);
});

it('tells disk changes from the editor echo of its own save', () => {
  const saved = provider();
  const clean = { provider: saved, draft: toDraft(saved) };
  // Read back from YAML: other key order and a new timestamp, same content.
  const echo = { ...structuredClone(saved), headers: { 'X-One': '1' }, updatedAt: 'later' };
  expect(classifyProviderChange(clean, [echo])).toEqual({ kind: 'unchanged' });

  const edited = provider({ baseUrl: 'http://localhost:9000/v1' });
  expect(classifyProviderChange(clean, [edited])).toEqual({ kind: 'reload', item: edited });
  expect(classifyProviderChange(clean, [])).toEqual({ kind: 'removed' });
  // The editor's own delete, announced before its response: not reported as removed from disk.
  expect(classifyProviderChange({ ...clean, deleting: true }, [])).toEqual({ kind: 'unchanged' });

  const dirty = { provider: saved, draft: { ...toDraft(saved), name: 'Mine' } };
  expect(classifyProviderChange(dirty, [edited])).toMatchObject({ kind: 'conflict', removed: false });
  expect(classifyProviderChange(dirty, [])).toMatchObject({ kind: 'conflict', removed: true });
  expect(classifyProviderChange(dirty, [echo])).toEqual({ kind: 'unchanged' });
  // The disk already holds the draft (its own save, announced before the response arrived): no conflict.
  const ownSave = provider({ name: 'Mine', updatedAt: 'later' });
  const unsaved = {
    provider: saved,
    draft: {
      ...toDraft(saved),
      name: ' Mine ',
      advanced: 'headers: { X-One: "1" }\noverrides:\n  - { match: "deepseek/*", messageName: null }',
    },
  };
  expect(classifyProviderChange(unsaved, [ownSave])).toEqual({ kind: 'reload', item: ownSave });
});

it('builds a valid body from the built-in provider (its duplicate starts from the same fields)', () => {
  const builtIn = { ...builtInProviders[0]!, builtIn: true };
  expect(draftToBody(toDraft(builtIn), builtIn.kind).ok).toBe(true);
});
