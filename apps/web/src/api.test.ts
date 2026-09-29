import { afterEach, expect, it, vi } from 'vitest';
import { alerts } from './alerts/store.js';
import { ApiError, api, json } from './api.js';

afterEach(() => { vi.restoreAllMocks(); alerts.clear(); });
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
it('turns backend errors into typed ApiErrors and toasts unless silent', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    error: { code: 'WORKFLOW_INVALID', message: 'Invalid workflow', details: ['Missing chat output'] }
  }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  await expect(api('/workflows/id/validate', json('POST'))).rejects.toMatchObject({
    name: 'ApiError', status: 400, code: 'WORKFLOW_INVALID', message: 'Invalid workflow', details: ['Missing chat output']
  } satisfies Partial<ApiError>);
  expect(alerts.getSnapshot()).toMatchObject([{ level: 'error', message: 'Invalid workflow', details: 'Missing chat output' }]);
  alerts.clear();
  await expect(api('/workflows/id/validate', { ...json('POST'), silent: true })).rejects.toBeInstanceOf(ApiError);
  expect(alerts.getSnapshot()).toHaveLength(0);
  expect((fetchMock.mock.calls[1]?.[1] as Record<string, unknown>).silent).toBeUndefined();
});
it('reports network failures as toasts', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(api('/sessions')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  expect(alerts.getSnapshot()[0]?.message).toBe('Could not reach the server');
});
