import type { Workflow, Session, ExecutionLog, NodeTypeDescriptor, Preset, PortDef, Character, Persona } from '@st/shared';
import { alerts } from './alerts/store.js';
export type SessionSummary = Omit<Session, 'messages'> & { messageCount: number };
export type SecretSummary = { name: string; hint: string };
export type ApiOptions = RequestInit & { silent?: boolean };
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) { super(message); this.name = 'ApiError'; }
}
function detailText(details: unknown): string | undefined {
  if (details == null) return undefined;
  if (typeof details === 'string') return details;
  if (Array.isArray(details) && details.every(item => typeof item === 'string')) return details.join('\n');
  if (Array.isArray(details) && details.every(item => item && typeof item === 'object' && 'message' in item))
    return details.map(item => `${item.path ? `${item.path}: ` : ''}${item.message}`).join('\n');
  if (typeof details === 'object' && 'execution' in details) {
    const execution = (details as { execution: ExecutionLog }).execution;
    return Object.entries(execution.nodes).filter(([, node]) => node.status === 'error')
      .map(([nodeId, node]) => `${nodeId}: ${node.error ?? 'Failed'}`).join('\n') || undefined;
  }
  return JSON.stringify(details, null, 2);
}
function notify(error: ApiError, silent: boolean) {
  if (!silent) alerts.error(error.message, {
    title: error.code === 'WORKFLOW_EXECUTION_FAILED' ? 'Workflow failed' : 'Request failed',
    details: detailText(error.details)
  });
}
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { silent = false, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body != null && !(requestOptions.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...requestOptions, headers }); }
  catch (cause) {
    const error = new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server', cause instanceof Error ? cause.message : String(cause));
    notify(error, silent);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const data = body as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
    const error = new ApiError(response.status, data?.error?.code ?? 'HTTP_ERROR',
      data?.error?.message || response.statusText || `HTTP ${response.status}`, data?.error?.details);
    notify(error, silent);
    throw error;
  }
  return body as T;
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
export const getWorkflows = () => api<Workflow[]>('/workflows');
export const getNodeTypes = () => api<NodeTypeDescriptor[]>('/node-types');
export const getPresets = () => api<Preset[]>('/presets');
export const getProviders = () => api<{ id: string; label: string; secretName: string }[]>('/providers');
export const getCharacters = () => api<Character[]>('/characters');
export const getPersonas = () => api<Persona[]>('/personas');
export const resolvePorts = (type: string, config: Record<string, unknown>) =>
  api<{ inputs: PortDef[]; outputs: PortDef[] }>(`/node-types/${type}/ports`, json('POST', { config }));
