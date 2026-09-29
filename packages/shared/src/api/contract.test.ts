import { expect, it } from 'vitest';
import { apiContract, errorEnvelopeSchema } from './index.js';

it('preserves existing entity defaults, including defaults on partial updates', () => {
  expect(apiContract.createCharacter.body.parse({ name: '  Alice  ' })).toMatchObject({
    name: 'Alice',
    description: '',
    tags: [],
    extensions: {},
  });
  expect(apiContract.updateCharacter.body.parse({ name: 'Alice' })).toMatchObject({
    name: 'Alice',
    description: '',
    tags: [],
  });
  expect(apiContract.updatePersona.body.parse({})).toEqual({ description: '' });
});

it('validates preset writes with the same cross-field rules as complete presets', () => {
  const body = { name: 'Preset', inputs: [], entries: [] };
  expect(apiContract.createPreset.body.parse(body)).toEqual(body);
  expect(
    apiContract.updatePreset.body.safeParse({
      ...body,
      entries: [{ id: 'slot', name: 'History', enabled: true, kind: 'slot', inputKey: 'missing' }],
    }).success,
  ).toBe(false);
});

it('describes clearable session context, trimmed messages and opaque error details', () => {
  expect(apiContract.updateSession.body.parse({ characterId: null, personaId: null })).toEqual({
    characterId: null,
    personaId: null,
  });
  expect(apiContract.sendMessage.body.parse({ content: ' hi ' })).toEqual({ content: 'hi' });
  expect(errorEnvelopeSchema.parse({ error: { code: 'FAILED', message: 'Failure', details: { node: 'n' } } })).toEqual({
    error: { code: 'FAILED', message: 'Failure', details: { node: 'n' } },
  });
});
