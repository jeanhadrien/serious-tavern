import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from './types.js';
import { stateless } from './test-state.js';
import { pickFields, pickedNames } from './nodes/pick-fields/index.js';

const run = (fields: string, value: unknown) => {
  const logs: string[] = [];
  const ctx: ExecutionContext = {
    nodeId: 'pick',
    ...stateless('pick'),
    inputs: { value },
    config: pickFields.configSchema.parse({ fields }),
    trigger: { message: '', sessionId: 's' },
    settings: {},
    history: [],
    secrets: { get: async () => undefined },
    resources: { presets: { get: async () => undefined } },
    signal: new AbortController().signal,
    log: (line) => logs.push(line),
    random: () => 0.5,
    recordWire: () => {},
    emit: () => {},
  };
  return { result: pickFields.execute(ctx), logs };
};

describe('pickedNames', () => {
  it.each([
    ['text, level', ['text', 'level']],
    [' text ,, level,text ', ['text', 'level']],
    ['', []],
    [' , ', []],
  ])('%j gives %j', (fields, names) => expect(pickedNames(fields)).toEqual(names));
});

describe('Pick Fields node', () => {
  const entry = { text: 'a bell', level: 2, entryId: 'entry-3', tags: ['sound'], keywords: [] };

  it('keeps only the listed fields, in the listed order', async () => {
    const { result, logs } = run('level, text', entry);
    expect(await result).toEqual({ value: { level: 2, text: 'a bell' } });
    expect(logs).toEqual([]);
  });

  it('leaves out a field the object lacks and says so', async () => {
    const { result, logs } = run('text, level, title', { text: 'a bell' });
    expect(await result).toEqual({ value: { text: 'a bell' } });
    expect(logs).toEqual(['Not in the object: level, title']);
  });

  it('picks own fields only', async () => {
    const { result } = run('toString, text', entry);
    expect(await result).toEqual({ value: { text: 'a bell' } });
  });

  it.each([
    ['', entry, 'Pick Fields needs at least one field name'],
    ['text', 'a bell', 'Pick Fields needs an object as input'],
    ['text', [1, 2], 'Pick Fields needs an object as input'],
    ['text', null, 'Pick Fields needs an object as input'],
  ])('fails for fields %j and input %j', async (fields, value, message) => {
    await expect(run(fields, value).result).rejects.toThrow(message);
  });
});
