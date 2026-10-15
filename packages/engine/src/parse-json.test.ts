import { describe, expect, it } from 'vitest';
import type { ChatMessage, Edge, Workflow } from '@st/shared';
import { ExecutionFailure, executeWorkflow } from './executor.js';
import { z } from 'zod';
import { extractJson, type JsonExpect, jsonExpectTypes } from './nodes/parse-json/extract.js';
import { parseJson } from './nodes/parse-json/index.js';
import type { ExecutionContext } from './types.js';

const fence = '```';
const plainNumber = { error: 'Expected a number, but the text is not a plain number' };
const plainBoolean = { error: 'Expected true or false, but the text is not a plain true or false' };
const notFound = { error: 'No JSON value found in the text' };

describe('extractJson', () => {
  it.each<[string, JsonExpect, unknown]>([
    // Whole text
    ['{"a":1}', 'any', { a: 1 }],
    ['  [1, 2] \n', 'array', [1, 2]],
    ['"hello"', 'text', 'hello'],
    ['"hello"', 'any', 'hello'],
    ['null', 'any', null],
    ['42', 'any', 42],
    // Valid JSON is taken as it is, even with a code fence inside one of its strings
    [
      `{"reply": "Use ${fence}js\\nlet x\\n${fence} to declare", "mood": "calm"}`,
      'object',
      {
        reply: `Use ${fence}js\nlet x\n${fence} to declare`,
        mood: 'calm',
      },
    ],
    [
      `{"reply": "Here:\\n${fence}js\\ncode()\\n${fence}\\nDone"}`,
      'any',
      { reply: `Here:\n${fence}js\ncode()\n${fence}\nDone` },
    ],
    // Code fences
    [`${fence}json\n{"a":1}\n${fence}`, 'object', { a: 1 }],
    [`${fence}JSON\r\n{"a":1}\r\n${fence}`, 'object', { a: 1 }],
    [`${fence}\n[1]\n${fence}`, 'array', [1]],
    [`Sure!\n${fence}json\n{"a":1}\n${fence}\nHope that helps.`, 'object', { a: 1 }],
    [`${fence}{"a":1}${fence}`, 'object', { a: 1 }],
    [`${fence}json {"a":1}${fence}`, 'object', { a: 1 }],
    [`${fence}json\n{"a":1}`, 'object', { a: 1 }],
    [`${fence}json\n{"a":1}\n${fence}\n${fence}json\n{"b":2}\n${fence}`, 'object', { a: 1 }],
    [`${fence}json\nHere: {"a":1} ok\n${fence}`, 'object', { a: 1 }],
    // Prose around one value
    ['Here you go: {"a": {"b": [1, 2]}} done', 'object', { a: { b: [1, 2] } }],
    ['Answer: {"t": "a } brace, a \\" quote and a {"} end', 'object', { t: 'a } brace, a " quote and a {' }],
    ['{"t": "]"} trailing', 'object', { t: ']' }],
    ['Path: {"p": "C:\\\\"} done', 'object', { p: 'C:\\' }],
    ['{"p": "a\\\\", "q": "]"} done', 'object', { p: 'a\\', q: ']' }],
    ['[note] then {"a":1}', 'object', { a: 1 }],
    ['[note] then {"a":1}', 'any', { a: 1 }],
    ['list: [1, 2, 3].', 'array', [1, 2, 3]],
    ['{"a":1} and {"b":2}', 'object', { a: 1 }],
    ['Mismatched } then {"a": [1]}', 'object', { a: [1] }],
    ['{"a": [1}, then {"b": 2}', 'object', { b: 2 }],
    // The first top-level value of the expected type: a bracketed reference or range before it is passed over
    ['According to [1], the answer is {"a":1}', 'object', { a: 1 }],
    ['Scores are in [0, 1]. Here: {"score": 0.3}', 'object', { score: 0.3 }],
    ['See {"a":1}, then [2]', 'array', [2]],
    ['Ranges like [0, 1) are fine: {"a":1}', 'object', { a: 1 }],
    ['[sic then {"a":1}', 'object', { a: 1 }],
    // A bracket of prose that never closes is skipped, whatever follows it
    ['Use { carefully. {"a":1}', 'object', { a: 1 }],
    ['It starts with {. Here: {"a":1}', 'any', { a: 1 }],
    ['Mood: :{ sad. {"mood":"sad"}', 'object', { mood: 'sad' }],
    ['<think>Format is {score: n</think>\n{"score": 3}', 'object', { score: 3 }],
    ['He said "use {" then {"a":1}', 'object', { a: 1 }],
    ['Note: the "{" key. {"a":1}', 'object', { a: 1 }],
    ['See [1 for details: {"a":1}', 'object', { a: 1 }],
    // A prefilled ```json leaves only the closing fence after the value
    [`{"a":1}\n${fence}`, 'object', { a: 1 }],
    [`Sure: {"a":1}\n${fence}\n`, 'any', { a: 1 }],
    [`7\n${fence}`, 'number', 7],
    // Known limit: a value both malformed and cut off reads as prose, so the complete value inside it is found
    ['{mood: "happy", stats: {"hp": 3}', 'object', { hp: 3 }],
    // Numbers and booleans must be the whole text
    ['7', 'number', 7],
    [' -3.5e2 ', 'number', -350],
    [`${fence}\n7\n${fence}`, 'number', 7],
    [`${fence}7${fence}`, 'number', 7],
    ['true', 'boolean', true],
    ['false', 'boolean', false],
    [`${fence}json\ntrue\n${fence}`, 'boolean', true],
  ])('reads %j as %s', (text, type, value) => {
    expect(extractJson(text, type)).toEqual(value);
  });

  it.each<[string, JsonExpect, { error: string }]>([
    ['about 7/10', 'number', plainNumber],
    ['Rating: 7', 'number', plainNumber],
    ['7 out of 10', 'number', plainNumber],
    ['', 'number', plainNumber],
    ['"7"', 'number', { error: 'Expected a number, got text' }],
    ['{"rating": 7}', 'number', { error: 'Expected a number, got an object' }],
    ['1e999', 'number', { error: 'Expected a number, got an infinite number' }],
    [`${fence}\n-1e999\n${fence}`, 'number', { error: 'Expected a number, got an infinite number' }],
    ['Yes, true', 'boolean', plainBoolean],
    ['True', 'boolean', plainBoolean],
    ['"true"', 'boolean', { error: 'Expected true or false, got text' }],
    ['1', 'boolean', { error: 'Expected true or false, got a number' }],
    ['hello', 'text', notFound],
    ['{"a":1}', 'text', { error: 'Expected text, got an object' }],
    ['[1]', 'object', { error: 'Expected an object, got an array' }],
    ['{"a":1}', 'array', { error: 'Expected an array, got an object' }],
    ['null', 'object', { error: 'Expected an object, got null' }],
    ['false', 'array', { error: 'Expected an array, got false' }],
    ['', 'any', notFound],
    ['   ', 'object', notFound],
    ['no json here', 'any', notFound],
    ['{"a": 1', 'any', notFound],
    ["{'a': 1}", 'object', notFound],
    ['According to [1], nothing else', 'object', { error: 'Expected an object, got an array' }],
    ['Here: [{"a": 1}]', 'object', { error: 'Expected an object, got an array' }],
    // A malformed or cut-off top-level value fails instead of handing on a fragment nested inside it
    ['{"a": 1, "b": {"c": 2},}', 'object', notFound],
    ['{"mood": 3, "tags": ["a"],}', 'any', notFound],
    ['{"mood": 3, "tags": ["a"],}', 'array', notFound],
    ['Here: {"scores": [1, 2], "note": "x", }', 'array', notFound],
    ['[{"t":"a"},{"t":"b"},]', 'any', notFound],
    ["{'mood': 3, 'inner': {\"a\": 1}}", 'any', notFound],
    ['{mood: "happy", stats: {"hp": 3}}', 'object', notFound],
    ['{"a": [1, 2]', 'any', notFound],
    ['{"name": "Bob", "stats": {"hp": 3}, "inv', 'object', notFound],
    [`${fence}json\n{"mood": {"score": 3}, "reply": "Hel`, 'object', notFound],
    ['[{"t":"a"},{"t":"b"', 'any', notFound],
    ['["x", {"a":1}, {"b":', 'any', notFound],
    ['["first", {"mood": 3}, {"mood"', 'object', notFound],
    ['[\n  "a",\n  {"x": 1},\n  {"x"', 'object', notFound],
    ['[1, 2, {"a": 1}, ', 'object', notFound],
    ['Results: [3, {"a": 1}', 'any', notFound],
    ['Sure: [ "a", {"hp": 3}, ', 'any', notFound],
    ['[null, true, {"a": 1}, -2.5', 'object', notFound],
    ['{"a": "x", "b": {"c": 1}, "d": tr', 'object', notFound],
    [`${fence}`, 'any', notFound],
    [`${fence}python\nprint(1)\n${fence}\n{"a":1}`, 'object', notFound],
  ])('rejects %j as %s', (text, type, { error }) => {
    expect(() => extractJson(text, type)).toThrow(error);
  });

  it('gives up after 100 bracket starts in long prose', () => {
    expect(() => extractJson(`${'[x '.repeat(100)}{"a":1}`, 'object')).toThrow('No JSON value found in the text');
    expect(extractJson(`${'[x '.repeat(99)}{"a":1}`, 'object')).toEqual({ a: 1 });
  });
});

describe('Parse JSON node', () => {
  const run = (type: string, text: unknown) => {
    const logs: string[] = [];
    const ctx: ExecutionContext = {
      nodeId: 'parse',
      inputs: { text },
      config: parseJson.configSchema.parse({ expect: type }),
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
    return { result: parseJson.execute(ctx), logs };
  };

  it('defaults to any and offers the types as a dropdown', () => {
    expect(parseJson.configSchema.parse({})).toEqual(parseJson.defaultConfig);
    expect(parseJson.configSchema.safeParse({ expect: 'date' }).success).toBe(false);
    const schema = z.toJSONSchema(parseJson.configSchema) as { properties: Record<string, unknown> };
    expect(schema.properties.expect).toMatchObject({ enum: [...jsonExpectTypes], default: 'any' });
  });

  it.each(['any', 'object', 'array', 'number', 'boolean', 'text'])('types its value output as %s', async (type) => {
    const ports = await parseJson.resolvePorts!({ expect: type }, { presets: { get: async () => undefined } });
    expect(ports.inputs).toEqual([expect.objectContaining({ name: 'text', dataType: 'text', required: true })]);
    expect(ports.outputs).toEqual([expect.objectContaining({ name: 'value', dataType: type })]);
  });
  it('types the output as any before a type is chosen, and rejects an unknown type', async () => {
    const resources = { presets: { get: async () => undefined } };
    expect((await parseJson.resolvePorts!({}, resources)).outputs[0]?.dataType).toBe('any');
    await expect(parseJson.resolvePorts!({ expect: 'date' }, resources)).rejects.toThrow('Unknown type "date"');
  });

  it('parses text without logging', async () => {
    const { result, logs } = run('object', 'Result: {"mood": "calm"}');
    expect(await result).toEqual({ value: { mood: 'calm' } });
    expect(logs).toEqual([]);
  });

  it('type-checks a value an any source already parsed', async () => {
    expect(await run('object', { a: 1 }).result).toEqual({ value: { a: 1 } });
    expect(await run('number', 7).result).toEqual({ value: 7 });
    const wrong = run('array', { a: 1 });
    await expect(wrong.result).rejects.toThrow('Expected an array, got an object');
    expect(wrong.logs).toEqual(['Input: {"a":1}']);
  });

  it('treats a missing value as empty text', async () => {
    const missing = run('any', undefined);
    await expect(missing.result).rejects.toThrow('No JSON value found in the text');
    expect(missing.logs).toEqual(['Input: ']);
  });

  it('logs the raw input once when it fails, cut to 500 characters', async () => {
    const short = run('number', 'about 7/10');
    await expect(short.result).rejects.toThrow('Expected a number, but the text is not a plain number');
    expect(short.logs).toEqual(['Input: about 7/10']);
    const long = run('object', 'x'.repeat(600));
    await expect(long.result).rejects.toThrow('No JSON value found in the text');
    expect(long.logs).toEqual([`Input: ${'x'.repeat(500)}… (100 more characters)`]);
  });
});

describe('Parse JSON in a workflow', () => {
  const at = { x: 0, y: 0 };
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  });
  const workflow: Workflow = {
    id: 'w',
    name: 'W',
    createdAt: '',
    updatedAt: '',
    nodes: [
      { id: 'input', type: 'chat-input', config: {}, position: at },
      { id: 'parse', type: 'parse-json', config: { expect: 'object' }, position: at },
      { id: 'output', type: 'chat-output', config: {}, position: at },
    ],
    edges: [edge('input', 'message', 'parse', 'text'), edge('parse', 'value', 'output', 'value')],
  };
  const options = { sessionId: 's', history: [] as ChatMessage[], secrets: { get: async () => undefined } };

  it('fails the run with the raw input in the node log', async () => {
    const failure = await executeWorkflow(workflow, { ...options, message: 'nope' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ExecutionFailure);
    const { nodeType, execution } = failure as ExecutionFailure;
    expect(nodeType).toBe('parse-json');
    expect(execution.nodes.parse).toMatchObject({
      status: 'error',
      error: 'No JSON value found in the text',
      logs: ['Input: nope'],
    });
  });

  it('hands the parsed object on (shown as pretty JSON by a Chat Output)', async () => {
    const result = await executeWorkflow(workflow, { ...options, message: 'Sure: {"a":1}' });
    expect(result.execution.nodes.parse?.output).toEqual({ value: { a: 1 } });
    expect(result.execution.nodes.parse?.logs).toBeUndefined();
    expect(result.replies.map((reply) => reply.content)).toEqual(['{\n  "a": 1\n}']);
  });
});
