import { afterEach, expect, it, vi } from 'vitest';
import { api, json } from './api.js';

afterEach(() => vi.restoreAllMocks());
it('only sends JSON content type when the request has a body', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  await api('/secrets/openrouter', json('DELETE'));
  await api('/sessions', json('POST', { workflowId: 'id' }));
  const emptyHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
  const bodyHeaders = new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers);
  expect(emptyHeaders.has('content-type')).toBe(false);
  expect(bodyHeaders.get('content-type')).toBe('application/json');
});
