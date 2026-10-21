import { describe, expect, it } from 'vitest';
import { validateWorkflow } from './executor.js';
import { edge, graph, node } from './test-collections.js';
import { SCENE_ID, newChat, playTurn, sceneDefinition } from './test-state.js';
import type { ExecutionContext } from './types.js';
import { stateless } from './test-state.js';
import { pickFields, pickedNames } from './nodes/pick-fields/index.js';

const run = (fields: string, value: unknown) => {
  const logs: string[] = [];
  const ctx: ExecutionContext = {
    nodeId: 'pick',
    ...stateless('pick'),
    inputs: { value },
    config: { fields },
    trigger: { message: '', sessionId: 's' },
    settings: {},
    history: [],
    secrets: { get: async () => undefined },
    resources: { presets: { get: async () => undefined } },
    signal: new AbortController().signal,
    log: (line) => logs.push(line),
    random: () => 0.5,
    recordWire: () => {},
    beginWire: () => {},
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

describe('Pick Fields in a workflow', () => {
  const picked = (fields: string) =>
    graph(
      [
        node('input', 'chat-input'),
        node('parse', 'parse-json', { expect: 'object' }),
        node('pick', 'pick-fields', { fields }),
        node('remember', 'state-write', { definitionId: SCENE_ID, key: 'injected', op: 'add' }),
        node('output', 'chat-output'),
      ],
      [
        edge('input', 'message', 'parse', 'text'),
        edge('parse', 'value', 'pick', 'value'),
        edge('pick', 'value', 'remember', 'value'),
        edge('input', 'message', 'output', 'value'),
      ],
    );
  const entry = JSON.stringify({ text: 'a bell', level: 2, tags: ['sound'], keywords: [], collectionId: 'c' });

  it('narrows an object to what the key declares, so State Write has nothing to leave out', async () => {
    const chat = newChat([sceneDefinition]);
    const workflow = picked('text, level');
    expect(await validateWorkflow(workflow, chat.resources)).toEqual([]);
    const result = await playTurn(chat, workflow, 'e1', entry);
    expect(result.execution.nodes.remember?.logs?.join('\n')).not.toContain('Left out');
    expect(result.writes).toMatchObject([{ op: 'add', item: { text: 'a bell', level: 2 } }]);
    // The same object without Pick Fields would have logged what it dropped.
    const direct = graph(
      [
        node('input', 'chat-input'),
        node('parse', 'parse-json', { expect: 'object' }),
        node('remember', 'state-write', { definitionId: SCENE_ID, key: 'injected', op: 'add' }),
        node('output', 'chat-output'),
      ],
      [
        edge('input', 'message', 'parse', 'text'),
        edge('parse', 'value', 'remember', 'value'),
        edge('input', 'message', 'output', 'value'),
      ],
    );
    const loud = await playTurn(newChat([sceneDefinition]), direct, 'e2', entry);
    expect(loud.execution.nodes.remember?.logs?.join('\n')).toContain('Left out fields');
  });

  it.each(['', ' , '])('is reported by validation, not by the first turn, when fields is %j', async (fields) => {
    const chat = newChat([sceneDefinition]);
    const issues = await validateWorkflow(picked(fields), chat.resources);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('List at least one field name');
    expect(issues[0]?.nodeIds).toEqual(['pick']);
  });
});
