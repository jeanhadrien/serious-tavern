import { workflowInvalidDetailsSchema, type ExecutionLog, type ErrorEnvelope } from '@st/shared';
import { alerts } from '../alerts/store.js';
type ApiOptions = RequestInit & { silent?: boolean };
export type RequestOptions = Omit<ApiOptions, 'method' | 'body'>;
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
function detailText(details: unknown): string | undefined {
  if (details == null) return undefined;
  if (typeof details === 'string') return details;
  if (Array.isArray(details) && details.every((item) => typeof item === 'string')) return details.join('\n');
  if (Array.isArray(details) && details.every((item) => item && typeof item === 'object' && 'message' in item))
    return details.map((item) => `${item.path ? `${item.path}: ` : ''}${item.message}`).join('\n');
  const invalid = workflowInvalidDetailsSchema.safeParse(details);
  if (invalid.success) return invalid.data.issues.map((issue) => issue.message).join('\n');
  if (typeof details === 'object' && 'execution' in details) {
    const execution = (details as { execution: ExecutionLog }).execution;
    return (
      Object.entries(execution.nodes)
        .filter(([, node]) => node.status === 'error')
        .map(([nodeId, node]) => `${nodeId}: ${node.error ?? 'Failed'}`)
        .join('\n') || undefined
    );
  }
  return JSON.stringify(details, null, 2);
}
/** Toasts an API failure the way `api()` does; used by callers that handle their own request, e.g. the turn stream. */
export function notifyError(error: ApiError) {
  if (error.code === 'WORKFLOW_INVALID') {
    const invalid = workflowInvalidDetailsSchema.safeParse(error.details);
    if (invalid.success) {
      const edgeId = invalid.data.issues.find((issue) => issue.edgeId)?.edgeId;
      alerts.error(error.message, {
        title: 'Workflow is invalid',
        details: detailText(error.details),
        action: {
          label: 'Open workflow',
          to: `/workflows?workflow=${invalid.data.workflowId}${edgeId ? `&edge=${edgeId}` : ''}`,
        },
      });
      return;
    }
  }
  alerts.error(error.message, {
    title: error.code === 'WORKFLOW_EXECUTION_FAILED' ? 'Workflow failed' : 'Request failed',
    details: detailText(error.details),
  });
}
/** Builds an ApiError from a non-2xx status and its (possibly missing) JSON error envelope. */
export function apiErrorFrom(status: number, statusText: string, body: unknown): ApiError {
  const data = body as Partial<ErrorEnvelope> | undefined;
  return new ApiError(
    status,
    data?.error?.code ?? 'HTTP_ERROR',
    data?.error?.message || statusText || `HTTP ${status}`,
    data?.error?.details,
  );
}
export function networkError(cause: unknown): ApiError {
  return new ApiError(
    0,
    'NETWORK_ERROR',
    'Could not reach the server',
    cause instanceof Error ? cause.message : String(cause),
  );
}
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { silent = false, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body != null && !(requestOptions.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...requestOptions, headers });
  } catch (cause) {
    const error = networkError(cause);
    if (!silent) notifyError(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = apiErrorFrom(response.status, response.statusText, body);
    if (!silent) notifyError(error);
    throw error;
  }
  return body as T;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
