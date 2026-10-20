import { describe, expect, it } from 'vitest';
import type { StateDefinition, StateWrite } from '@st/shared';
import { uniqueToolName } from './names.js';
import { buildStateTools } from './state-tools.js';
import { scene, target, toolContext } from './test-tools.js';
import type { EngineTool } from './types.js';

// The state tools: generated schemas, State Write's rules, handles and reading one's own writes.

const everyKey = Object.keys(scene.keys).map((key) => target(key));

/** The tools for `read` and `write` keys, by name, with the context they run in. */
async function toolsFor(read: ReturnType<typeof target>[], write: ReturnType<typeof target>[], withFold = true) {
  const context = toolContext({ withFold });
  const tools = await buildStateTools(context.ctx, { read, write });
  const byName = new Map(tools.map((tool) => [tool.definition.function.name, tool]));
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.run(args, context.ctx);
  };
  return { ...context, tools, byName, call };
}
const parametersOf = (tool: EngineTool | undefined) => tool?.definition.function.parameters as Record<string, any>;
const descriptionOf = (tool: EngineTool | undefined) => tool?.definition.function.description ?? '';

describe('which tools exist', () => {
  it('offers nothing unless keys are listed', async () => {
    expect((await toolsFor([], [])).tools).toEqual([]);
  });

  it('offers read_state only with readable keys, and one write tool per writable key', async () => {
    const { tools } = await toolsFor([target('tension')], [target('tension'), target('mood')]);
    expect(tools.map((tool) => tool.definition.function.name)).toEqual([
      'read_state',
      'write_scene_tension',
      'write_scene_mood',
    ]);
    expect((await toolsFor([], [target('tension')])).tools.map((tool) => tool.definition.function.name)).toEqual([
      'write_scene_tension',
    ]);
  });

  it('lists a key once, and leaves out unknown definitions and keys with a log line', async () => {
    const { tools, logs } = await toolsFor(
      [target('tension'), target('tension')],
      [target('gone'), target('tension', '99999999-9999-4999-8999-999999999999'), { definitionId: '', key: '' }],
    );
    expect(tools.map((tool) => tool.definition.function.name)).toEqual(['read_state']);
    expect(logs).toHaveLength(3);
    expect(logs[0]).toContain('Left out a write tool');
    expect(logs[0]).toContain('no key "gone"');
    expect(logs[1]).toContain('not found');
    expect(logs[2]).toContain('Select a state definition');
  });

  it('cuts long names and numbers repeated ones', () => {
    expect(uniqueToolName('write_a_b', new Set())).toBe('write_a_b');
    const long = `write_scene_${'k'.repeat(80)}`;
    const first = uniqueToolName(long, new Set());
    expect(first).toHaveLength(64);
    expect(uniqueToolName(long, new Set([first]))).toBe(`${first.slice(0, 62)}_2`);
    expect(uniqueToolName('write_a_b', new Set(['write_a_b', 'write_a_b_2']))).toBe('write_a_b_3');
  });

  it('keeps two keys apart whose names are the same after cutting', async () => {
    const keys = {
      [`${'k'.repeat(60)}a`]: { type: 'text' as const },
      [`${'k'.repeat(60)}b`]: { type: 'text' as const },
    };
    const wide: StateDefinition = { ...scene, keys };
    const context = toolContext();
    const run = { ...context.ctx, state: { ...context.ctx.state, definition: () => wide } };
    const tools = await buildStateTools(run, { read: [], write: Object.keys(keys).map((key) => target(key)) });
    const names = tools.map((tool) => tool.definition.function.name);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => name.length <= 64)).toBe(true);
  });
});

describe('the schemas', () => {
  it('describes the readable keys and enumerates their names', async () => {
    const { byName } = await toolsFor(everyKey, []);
    const read = byName.get('read_state');
    expect(parametersOf(read).properties.keys.items.enum).toEqual(everyKey.map((key) => `scene.${key.key}`));
    expect(parametersOf(read).required).toEqual(['keys']);
    expect(descriptionOf(read)).toContain('scene.tension: a number from 0 to 10');
    expect(descriptionOf(read)).toContain('How tense the scene is');
    expect(descriptionOf(read)).toContain('The scene so far');
  });

  it('writes a number with set, increment and reset, and says the bounds', async () => {
    const tool = (await toolsFor([], [target('tension')])).byName.get('write_scene_tension');
    expect(parametersOf(tool)).toMatchObject({
      type: 'object',
      properties: { op: { enum: ['set', 'increment', 'reset'] }, value: { type: 'number' } },
      required: ['op'],
    });
    expect(descriptionOf(tool)).toContain('from 0 to 10');
    expect(descriptionOf(tool)).toContain('How tense the scene is');
  });

  it('writes an enum with its options as a JSON Schema enum', async () => {
    const tool = (await toolsFor([], [target('mood')])).byName.get('write_scene_mood');
    expect(parametersOf(tool).properties.value).toMatchObject({ type: 'string', enum: ['calm', 'uneasy', 'tense'] });
    expect(parametersOf(tool).properties.op.enum).toEqual(['set', 'reset']);
    expect(parametersOf(tool).required).toBeUndefined();
  });

  it.each([
    ['alarm', { type: 'boolean' }],
    ['note', { type: 'string' }],
    ['data', { type: 'object' }],
  ])('writes %s as a flat value', async (key, value) => {
    const tool = (await toolsFor([], [target(key)])).byName.get(`write_scene_${key}`);
    expect(parametersOf(tool).properties.value).toMatchObject(value);
    expect(parametersOf(tool).properties.op.enum).toEqual(['set', 'reset']);
  });

  it('writes a collection with add, remove and reset, the declared fields flat', async () => {
    const tool = (await toolsFor([], [target('log')])).byName.get('write_scene_log');
    expect(parametersOf(tool)).toMatchObject({
      type: 'object',
      properties: {
        op: { enum: ['add', 'remove', 'reset'] },
        text: { type: 'string' },
        handle: { type: 'string' },
        level: { type: 'number' },
      },
      required: ['op'],
    });
  });
});

describe('write tools follow State Write', () => {
  it('sets a number, clamping it to the bounds', async () => {
    const { call, logs } = await toolsFor([], [target('tension')]);
    expect(await call('write_scene_tension', { op: 'set', value: 15 })).toBe(10);
    expect(logs.at(-1)).toContain('clamped');
  });

  it('increments by the amount, or by 1 without one', async () => {
    const { call } = await toolsFor([], [target('tension')]);
    expect(await call('write_scene_tension', { op: 'increment', value: 2 })).toBe(5);
    expect(await call('write_scene_tension', { op: 'increment' })).toBe(6);
  });

  it('resets any type to its default', async () => {
    const { call } = await toolsFor([], [target('tension'), target('note')]);
    await call('write_scene_tension', { op: 'set', value: 9 });
    expect(await call('write_scene_tension', { op: 'reset' })).toBe(3);
    await call('write_scene_note', { value: 'changed' });
    expect(await call('write_scene_note', { op: 'reset' })).toBe('none');
  });

  it('refuses what State Write refuses, with its words', async () => {
    const { call } = await toolsFor([], everyKey);
    await expect(call('write_scene_mood', { value: 'furious' })).rejects.toThrow(
      'scene.mood must be one of: calm, uneasy, tense; got "furious"',
    );
    await expect(call('write_scene_tension', { op: 'set', value: 'high' })).rejects.toThrow(
      'scene.tension needs a number, got text',
    );
    await expect(call('write_scene_tension', { op: 'set' })).rejects.toThrow('got nothing');
    await expect(call('write_scene_alarm', { value: 'yes' })).rejects.toThrow('needs true or false');
    await expect(call('write_scene_data', { value: [1] })).rejects.toThrow('needs an object');
    await expect(call('write_scene_log', { op: 'add' })).rejects.toThrow('can only add text');
    await expect(call('write_scene_log', { op: 'add', text: 'x', level: 'high' })).rejects.toThrow(
      'field "level" must be a number',
    );
  });

  it('refuses an operation the key type does not have', async () => {
    const { call } = await toolsFor([], everyKey);
    await expect(call('write_scene_tension', {})).rejects.toThrow('"op" must be one of: set, increment, reset');
    await expect(call('write_scene_note', { op: 'increment', value: 1 })).rejects.toThrow(
      '"op" must be one of: set, reset',
    );
    await expect(call('write_scene_log', { op: 'set', value: 'x' })).rejects.toThrow('add, remove, reset');
  });

  it('adds an item with its declared fields and logs the fields it leaves out', async () => {
    const { call, logs } = await toolsFor([], [target('log')]);
    const items = (await call('write_scene_log', { op: 'add', text: 'A storm', level: 2, mood: 'grim' })) as any[];
    expect(items).toEqual([{ handle: '#1', text: 'A storm', level: 2 }]);
    expect(logs.some((line) => line.includes("Left out fields the key doesn't declare: mood"))).toBe(true);
  });

  it('buffers the writes like State Write: they count only when the node completes', async () => {
    const { call, run } = await toolsFor([], everyKey);
    await call('write_scene_tension', { op: 'increment', value: 2 });
    await call('write_scene_mood', { value: 'tense' });
    await call('write_scene_log', { op: 'add', text: 'A storm', level: 2 });
    const uncommitted = run.finish();
    expect(uncommitted).toEqual([]);
  });

  it('stores the same writes State Write would', async () => {
    const { call, run } = await toolsFor([], everyKey);
    await call('write_scene_tension', { op: 'increment', value: 2 });
    await call('write_scene_mood', { value: 'tense' });
    await call('write_scene_log', { op: 'add', text: 'A storm', level: 2 });
    await call('write_scene_note', { op: 'reset' });
    run.commit('llm', 1);
    const writes: StateWrite[] = run.finish();
    expect(writes.map((write) => [write.op, (write.target as { key: string }).key])).toEqual([
      ['set', 'tension'],
      ['set', 'mood'],
      ['add', 'log'],
      ['delete', 'note'],
    ]);
    expect(writes[0]).toMatchObject({ value: 5, nodeId: 'llm' });
    expect(writes[2]).toMatchObject({ item: { text: 'A storm', level: 2 } });
  });
});

describe('reading', () => {
  it('returns the values by name, collections as items with handles', async () => {
    const { call } = await toolsFor(everyKey, [target('log')]);
    await call('write_scene_log', { op: 'add', text: 'One', level: 1 });
    await call('write_scene_log', { op: 'add', text: 'Two' });
    const read = (await call('read_state', { keys: ['scene.tension', 'scene.log', 'scene.mood'] })) as any;
    expect(read['scene.tension']).toBe(3);
    expect(read['scene.mood']).toBe('calm');
    // Newest first, like every collection; handles were given in the order the items were first shown.
    expect(read['scene.log']).toEqual([
      { handle: '#2', text: 'Two' },
      { handle: '#1', text: 'One', level: 1 },
    ]);
  });

  it('keeps a handle for the rest of the loop', async () => {
    const { call } = await toolsFor([target('log')], [target('log')]);
    await call('write_scene_log', { op: 'add', text: 'One' });
    await call('write_scene_log', { op: 'add', text: 'Two' });
    const read = (await call('read_state', { keys: ['scene.log'] })) as any;
    expect(read['scene.log'].map((item: { handle: string }) => item.handle)).toEqual(['#2', '#1']);
  });

  it('refuses a key it was not given, or a bad list', async () => {
    const { call } = await toolsFor([target('tension')], []);
    await expect(call('read_state', { keys: ['scene.mood'] })).rejects.toThrow(
      '"scene.mood" cannot be read. Readable keys: scene.tension',
    );
    await expect(call('read_state', {})).rejects.toThrow('"keys" must be a list');
    await expect(call('read_state', { keys: [1] })).rejects.toThrow('"keys" must be a list');
  });

  it('sees its own writes, from the caller’s fold', async () => {
    const { call } = await toolsFor([target('tension')], [target('tension')]);
    expect(((await call('read_state', { keys: ['scene.tension'] })) as any)['scene.tension']).toBe(3);
    await call('write_scene_tension', { op: 'set', value: 8 });
    expect(((await call('read_state', { keys: ['scene.tension'] })) as any)['scene.tension']).toBe(8);
  });

  it('only sees the turn-start snapshot when the caller gave no fold', async () => {
    const { call } = await toolsFor([target('tension')], [target('tension')], false);
    await call('write_scene_tension', { op: 'set', value: 8 });
    expect(((await call('read_state', { keys: ['scene.tension'] })) as any)['scene.tension']).toBe(3);
  });
});

describe('handles', () => {
  it('removes an item by the handle it was shown with', async () => {
    const { call } = await toolsFor([target('log')], [target('log')]);
    await call('write_scene_log', { op: 'add', text: 'One' });
    await call('write_scene_log', { op: 'add', text: 'Two' });
    const left = (await call('write_scene_log', { op: 'remove', handle: '#1' })) as any[];
    expect(left).toEqual([{ handle: '#2', text: 'Two' }]);
    // Also without the #.
    expect(await call('write_scene_log', { op: 'remove', handle: '2' })).toEqual([]);
  });

  it('removes with the real id behind the handle', async () => {
    const { call, run } = await toolsFor([], [target('log')]);
    await call('write_scene_log', { op: 'add', text: 'One' });
    await call('write_scene_log', { op: 'remove', handle: '#1' });
    run.commit('llm', 1);
    const writes = run.finish();
    expect(writes.map((write) => write.op)).toEqual(['add', 'remove']);
    const added = writes[0] as { item: { id: string } };
    expect(writes[1]).toMatchObject({ itemId: added.item.id });
    expect(added.item.id).toBe('run:llm:1');
  });

  it('refuses a handle the loop never showed, or none', async () => {
    const { call } = await toolsFor([], [target('log')]);
    await expect(call('write_scene_log', { op: 'remove', handle: '#9' })).rejects.toThrow(
      'No item has the handle "#9"',
    );
    await expect(call('write_scene_log', { op: 'remove' })).rejects.toThrow('"handle" must be the handle');
    await expect(call('write_scene_log', { op: 'remove', handle: 3 })).rejects.toThrow('"handle" must be the handle');
  });

  it('says so when the item is already gone', async () => {
    const { call } = await toolsFor([], [target('log')]);
    await call('write_scene_log', { op: 'add', text: 'One' });
    await call('write_scene_log', { op: 'remove', handle: '#1' });
    await expect(call('write_scene_log', { op: 'remove', handle: '#1' })).rejects.toThrow('nothing removed');
  });
});
