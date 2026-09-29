import type { Workflow, Session, ExecutionLog, NodeTypeDescriptor } from '@st/shared';
export type SessionSummary = Omit<Session, 'messages'> & { messageCount: number };
export type SecretSummary = { name: string; hint: string };
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json();
  if (!response.ok) {
    const data = body as { error?: string; execution?: ExecutionLog };
    throw Object.assign(new Error(data.error ?? `HTTP ${response.status}`), { execution: data.execution });
  }
  return body as T;
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
export const getWorkflows = () => api<Workflow[]>('/workflows');
export const getNodeTypes = () => api<NodeTypeDescriptor[]>('/node-types');
