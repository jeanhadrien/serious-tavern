import { describe, expect, it } from 'vitest';
import { canConnect, type PortDef } from '@st/shared';
import { afterReply } from './nodes/after-reply/index.js';
import { descriptors, registry } from './registry.js';
import type { ExecutionContext } from './types.js';

describe('the After Reply node', () => {
  const find = () => descriptors().find((item) => item.type === 'after-reply');

  it('is registered in the Chat category with no inputs and three typed outputs, and is not a sink', () => {
    expect(find()).toMatchObject({
      label: 'After Reply',
      category: 'Chat',
      dynamicPorts: false,
      sink: false,
      inputs: [],
      outputs: [
        { name: 'replies', dataType: 'messages' },
        { name: 'text', dataType: 'text' },
        { name: 'turn', dataType: 'number' },
      ],
      defaultConfig: {},
    });
    expect(registry.get('after-reply')).toBe(afterReply);
  });

  it('says what it is for and how to use it', () => {
    expect(find()?.description).toMatch(/after the reply is saved/);
    expect(find()?.description).toMatch(/runs twice/);
  });

  const out = (name: string) => afterReply.outputs.find((port) => port.name === name)!;
  const target = (dataType: PortDef['dataType']): PortDef => ({ name: 't', label: 'T', dataType });
  it.each([
    ['replies', 'messages', { ok: true }],
    ['replies', 'array', { ok: true }],
    ['replies', 'any', { ok: true }],
    ['replies', 'text', { ok: true, coerce: 'messages-to-text' }],
    ['replies', 'number', { ok: false }],
    ['text', 'text', { ok: true }],
    ['text', 'any', { ok: true }],
    ['text', 'number', { ok: false }],
    ['turn', 'number', { ok: true }],
    ['turn', 'text', { ok: true, coerce: 'to-text' }],
    ['turn', 'any', { ok: true }],
    ['turn', 'boolean', { ok: false }],
  ])('connects %s to a %s port: %j', (port, to, expected) => {
    expect(canConnect(out(port), target(to as PortDef['dataType']))).toMatchObject(expected);
  });

  it('outputs the turn it follows, as copies', async () => {
    const replies = [{ id: 'm1', role: 'assistant' as const, content: 'one', createdAt: '' }];
    const payload = { replies, text: 'one', turn: 4 };
    const result = await afterReply.execute({ afterReply: payload } as ExecutionContext);
    expect(result).toEqual({ replies, text: 'one', turn: 4 });
    expect(result.replies).not.toBe(replies);
    (result.replies as typeof replies)[0]!.content = 'changed';
    expect(replies[0]!.content).toBe('one');
  });

  it('says it has no values outside the after-reply run', async () => {
    await expect(afterReply.execute({} as ExecutionContext)).rejects.toThrow(
      'After Reply only has values in the after-reply run.',
    );
  });
});
