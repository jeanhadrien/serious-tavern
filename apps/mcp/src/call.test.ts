import { describe, expect, it } from 'vitest';
import { callEndpoint } from './call.js';
import { buildEndpointTools } from './tools.js';

const tools = buildEndpointTools();
const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;

type Seen = { url: string; init: RequestInit };

/** A fetch that records the request and answers with the given response. */
function fakeFetch(response: Response | (() => never)) {
  const seen: Seen[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return typeof response === 'function' ? response() : response.clone();
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const baseUrl = 'http://app.test:3001/';
const id = '6f1c7a0e-2f4d-4a3c-9a55-1b9c2f0d7e11';

describe('building the request', () => {
  it('fills the path template from the arguments', async () => {
    const { fetch, seen } = fakeFetch(json({ id }));
    await callEndpoint(tool('get_preset'), { id }, { baseUrl, fetch });
    expect(seen[0]!.url).toBe(`http://app.test:3001/api/presets/${id}`);
    expect(seen[0]!.init.method).toBe('GET');
    expect(seen[0]!.init.body).toBeUndefined();
  });

  it('encodes path values', async () => {
    const { fetch, seen } = fakeFetch(json({}));
    await callEndpoint(tool('get_node_type'), { type: 'a b/c' }, { baseUrl, fetch });
    expect(seen[0]!.url).toBe('http://app.test:3001/api/node-types/a%20b%2Fc');
  });

  it('adds query fields, and nothing for the ones left out', async () => {
    const { fetch, seen } = fakeFetch(json({ models: [], fetchedAt: 'now' }));
    await callEndpoint(tool('list_provider_models'), { id: 'openrouter', refresh: 'true' }, { baseUrl, fetch });
    await callEndpoint(tool('list_provider_models'), { id: 'openrouter' }, { baseUrl, fetch });
    expect(seen[0]!.url).toBe('http://app.test:3001/api/providers/openrouter/models?refresh=true');
    expect(seen[1]!.url).toBe('http://app.test:3001/api/providers/openrouter/models');
  });

  it('sends the body as JSON', async () => {
    const { fetch, seen } = fakeFetch(json({ id }, 201));
    await callEndpoint(tool('update_persona'), { id, body: { description: 'Tall' } }, { baseUrl, fetch });
    expect(seen[0]!.init.method).toBe('PUT');
    expect(seen[0]!.init.body).toBe('{"description":"Tall"}');
    expect(seen[0]!.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('accepts a body sent as a JSON string, as some clients do', async () => {
    const { fetch, seen } = fakeFetch(json({ id }));
    await callEndpoint(tool('create_persona'), { body: '{"name":"Ann"}' }, { baseUrl, fetch });
    expect(seen[0]!.init.body).toBe('{"name":"Ann"}');
  });

  it('treats missing arguments as none', async () => {
    const { fetch, seen } = fakeFetch(json([]));
    const output = await callEndpoint(tool('list_presets'), undefined, { baseUrl, fetch });
    expect(output).toEqual({ text: '[]', isError: false });
    expect(seen[0]!.url).toBe('http://app.test:3001/api/presets');
  });

  it('refuses unknown or missing arguments without sending anything', async () => {
    const { fetch, seen } = fakeFetch(json({}));
    const flat = await callEndpoint(tool('create_persona'), { name: 'Ann' }, { baseUrl, fetch });
    expect(flat.isError).toBe(true);
    expect(flat.text).toContain('Unknown argument(s): name');
    expect(flat.text).toContain('"body"');
    const noId = await callEndpoint(tool('get_preset'), {}, { baseUrl, fetch });
    expect(noId).toEqual({ text: 'Missing required argument(s): id.', isError: true });
    expect((await callEndpoint(tool('get_preset'), [], { baseUrl, fetch })).isError).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe('reading the answer', () => {
  it('returns the JSON, trimmed for a list', async () => {
    const { fetch } = fakeFetch(json([{ id: 'a', name: 'A', entries: [1, 2] }]));
    expect(await callEndpoint(tool('list_presets'), {}, { baseUrl, fetch })).toEqual({
      text: '[{"id":"a","name":"A"}]',
      isError: false,
    });
  });

  it('returns a single record in full', async () => {
    const { fetch } = fakeFetch(json({ id: 'a', name: 'A', entries: [1, 2] }));
    const output = await callEndpoint(tool('get_preset'), { id }, { baseUrl, fetch });
    expect(JSON.parse(output.text)).toEqual({ id: 'a', name: 'A', entries: [1, 2] });
  });

  it('says so when there is no content', async () => {
    const { fetch } = fakeFetch(new Response(null, { status: 204 }));
    const output = await callEndpoint(tool('get_preset'), { id }, { baseUrl, fetch });
    expect(output.isError).toBe(false);
    expect(output.text).toContain('no content');
  });
});

describe('errors', () => {
  it('keep the code, message and details of the API envelope', async () => {
    const issues = [{ message: 'Needs a Chat Output', nodeIds: ['a'] }];
    const { fetch } = fakeFetch(
      json({ error: { code: 'WORKFLOW_INVALID', message: 'Workflow is invalid', details: { issues } } }, 422),
    );
    const output = await callEndpoint(tool('validate_workflow'), { id }, { baseUrl, fetch });
    expect(output.isError).toBe(true);
    expect(output.text).toBe(`Error 422 WORKFLOW_INVALID: Workflow is invalid\nDetails: ${JSON.stringify({ issues })}`);
  });

  it('omit the details line when there are none', async () => {
    const { fetch } = fakeFetch(json({ error: { code: 'NOT_FOUND', message: 'Preset not found' } }, 404));
    expect(await callEndpoint(tool('get_preset'), { id }, { baseUrl, fetch })).toEqual({
      text: 'Error 404 NOT_FOUND: Preset not found',
      isError: true,
    });
  });

  it('survive an answer that is not the envelope', async () => {
    const { fetch } = fakeFetch(new Response('Bad gateway', { status: 502 }));
    expect(await callEndpoint(tool('get_preset'), { id }, { baseUrl, fetch })).toEqual({
      text: 'HTTP 502: Bad gateway',
      isError: true,
    });
  });

  it('say how to start the app when it cannot be reached', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:3001') });
    });
    const output = await callEndpoint(tool('list_presets'), {}, { baseUrl: 'http://127.0.0.1:3001', fetch });
    expect(output.isError).toBe(true);
    expect(output.text).toContain('Could not reach the app at http://127.0.0.1:3001');
    expect(output.text).toContain('ECONNREFUSED');
    expect(output.text).toContain('SERIOUS_TAVERN_URL');
  });
});
