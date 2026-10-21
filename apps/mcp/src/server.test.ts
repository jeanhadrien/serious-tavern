import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app.js';
import { createMcpServer } from './server.js';

// End to end: an MCP client over an in-memory transport, our server, and the real app listening on a free port.
type App = Awaited<ReturnType<typeof createApp>>;
let app: App;
let dataDir: string;
let client: Client;
let baseUrl: string;

async function connect(url: string) {
  const server = await createMcpServer({ baseUrl: url });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const connected = new Client({ name: 'test-client', version: '0.0.0' });
  await connected.connect(clientTransport);
  return connected;
}

/** Calls a tool the way an agent would and returns its text, parsed when it is JSON. */
async function call(name: string, args?: Record<string, unknown>, which = client) {
  const result = await which.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  const text = content[0]!.text;
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { isError: result.isError === true, text, json };
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mcp-test-'));
  app = await createApp(dataDir, { seed: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  client = await connect(baseUrl);
});

afterAll(async () => {
  await client.close();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('the server', () => {
  it('lists the generated tools and read_guide, each with an object input schema', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['create_workflow', 'update_character', 'list_node_types', 'read_guide']),
    );
    for (const tool of tools) expect(tool.inputSchema.type, tool.name).toBe('object');
    expect(tools.find((tool) => tool.name === 'get_preset')!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'create_preset')!.annotations?.readOnlyHint).toBe(false);
    expect(client.getInstructions()).toContain('get_node_type');
  });

  it('reports an unknown tool as a tool error', async () => {
    expect((await call('delete_workflow')).isError).toBe(true);
  });
});

describe('presets', () => {
  it('creates, trims in lists, reads, previews and updates', async () => {
    const entries = [
      { id: 'a', displayName: 'Main', enabled: true, kind: 'message', role: 'system', content: 'You are {{char}}.' },
    ];
    const created = await call('create_preset', {
      body: { name: 'Via MCP', description: 'Made by an agent', inputs: [], entries },
    });
    expect(created.isError).toBe(false);
    expect(created.json.id).toEqual(expect.any(String));
    expect(created.json.entries).toHaveLength(1);

    const listed = await call('list_presets');
    expect(listed.json).toEqual([{ id: created.json.id, name: 'Via MCP', description: 'Made by an agent' }]);

    const fetched = await call('get_preset', { id: created.json.id });
    expect(fetched.json).toEqual(created.json);

    const preview = await call('preview_preset', { body: { preset: fetched.json } });
    expect(preview.json.messages[0]).toMatchObject({ role: 'system' });

    const updated = await call('update_preset', {
      id: created.json.id,
      body: { name: 'Renamed', inputs: [], entries },
    });
    expect(updated.json.name).toBe('Renamed');
  });

  it('explains a rejected body in plain text with its details', async () => {
    const result = await call('create_preset', { body: { inputs: [], entries: [] } });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Error 400 VALIDATION_ERROR: /);
    expect(result.text).toContain('Details: ');
  });
});

describe('workflows', () => {
  it('creates a draft without positions and reports what it dropped', async () => {
    const nodes = [
      { id: 'input', type: 'chat-input', config: {} },
      { id: 'output', type: 'chat-output', config: {} },
    ];
    const edges = [
      { id: 'reply', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' },
      { id: 'dud', source: 'input', sourceHandle: 'no-such-port', target: 'output', targetHandle: 'value' },
    ];
    const created = await call('create_workflow', { body: { name: 'Echo', nodes, edges } });
    expect(created.isError).toBe(false);
    expect(created.json.droppedEdgeIds).toEqual(['dud']);
    expect(created.json.issues).toEqual([]);
    for (const node of created.json.nodes)
      expect(node.position).toEqual({ x: expect.any(Number), y: expect.any(Number) });

    expect((await call('validate_workflow', { id: created.json.id })).json).toMatchObject({ valid: true });
    expect((await call('list_workflows')).json).toEqual([{ id: created.json.id, name: 'Echo' }]);

    // Dropping the output makes the draft invalid, which is reported and still saved.
    const updated = await call('update_workflow', {
      id: created.json.id,
      body: { name: 'Echo', nodes: nodes.slice(0, 1), edges: [] },
    });
    expect(updated.isError).toBe(false);
    expect(updated.json.issues.length).toBeGreaterThan(0);
    const invalid = await call('validate_workflow', { id: created.json.id });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain('Error 422 WORKFLOW_INVALID');
  });

  it('describes node types one at a time', async () => {
    const summary = (await call('list_node_types')).json as Record<string, unknown>[];
    expect(summary.length).toBeGreaterThan(5);
    expect(Object.keys(summary[0]!).sort()).toEqual(['description', 'label', 'type']);

    const llm = await call('get_node_type', { type: 'llm' });
    expect(llm.json.configSchema).toBeDefined();
    expect((await call('get_node_type', { type: 'nope' })).text).toContain('Error 404 NOT_FOUND');

    const ports = await call('resolve_ports', { type: 'chat-output', body: { config: {} } });
    expect(ports.json.inputs.map((port: { name: string }) => port.name)).toContain('value');
  });
});

describe('characters', () => {
  it('keeps the fields an update leaves out', async () => {
    const created = await call('create_character', {
      body: { name: 'Mira', description: 'A smuggler', personality: 'Wry' },
    });
    const updated = await call('update_character', { id: created.json.id, body: { scenario: 'On a dock' } });
    expect(updated.json).toMatchObject({
      name: 'Mira',
      description: 'A smuggler',
      personality: 'Wry',
      scenario: 'On a dock',
    });
    expect((await call('get_character', { id: created.json.id })).json).toEqual(updated.json);
  });

  it('creates and lists personas', async () => {
    const created = await call('create_persona', { body: { name: 'Traveller' } });
    expect((await call('list_personas')).json).toEqual([{ id: created.json.id, name: 'Traveller', description: '' }]);
  });
});

describe('read-only resources', () => {
  it('lists providers, state definitions and collections', async () => {
    expect((await call('list_providers')).json.length).toBeGreaterThan(0);
    expect((await call('list_state_definitions')).isError).toBe(false);
    expect((await call('list_collections')).json).toEqual([]);
  });
});

describe('guides', () => {
  it('reads a guide by topic and refuses an unknown one', async () => {
    const guide = await call('read_guide', { topic: 'workflows' });
    expect(guide.text).toContain('# Workflows and nodes');
    const { tools } = await client.listTools();
    const schema = tools.find((tool) => tool.name === 'read_guide')!.inputSchema.properties as any;
    expect(schema.topic.enum).toEqual(expect.arrayContaining(['workflows', 'presets', 'templating']));
    expect((await call('read_guide', { topic: 'nope' })).isError).toBe(true);
  });
});

describe('when the app is not running', () => {
  it('says so instead of failing', async () => {
    const offline = await connect('http://127.0.0.1:1');
    const result = await call('list_presets', {}, offline);
    await offline.close();
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Could not reach the app at http://127.0.0.1:1');
  });
});
