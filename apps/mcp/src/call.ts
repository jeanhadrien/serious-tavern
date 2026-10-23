import { errorEnvelopeSchema } from '@st/shared';
import type { EndpointTool } from './tools.js';
import { trimResponse } from './trim.js';

export type CallOptions = {
  /** Where the running app listens, e.g. `http://127.0.0.1:3001`. */
  baseUrl: string;
  /** Injected by tests; the global `fetch` otherwise. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** What a tool answers: plain text, flagged when it describes a failure. */
export type ToolOutput = { text: string; isError: boolean };

const DEFAULT_TIMEOUT_MS = 60_000;

const ok = (text: string): ToolOutput => ({ text, isError: false });
const failure = (text: string): ToolOutput => ({ text, isError: true });

/** A mistake in the tool's arguments, caught before anything is sent. */
class ArgumentError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Some clients send a nested object argument as a JSON string.
function parseBody(body: unknown) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/** Fills `/api/presets/:id` from the arguments. */
function fillPath(tool: EndpointTool, args: Record<string, unknown>) {
  return tool.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => encodeURIComponent(String(args[name])));
}

function queryString(tool: EndpointTool, args: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const name of tool.queryParams) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(name, String(item));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Rejects arguments the tool does not take, with a hint for the likeliest mistake (body fields placed at top level). */
function checkArguments(tool: EndpointTool, args: Record<string, unknown>) {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  const unknown = Object.keys(args).filter((name) => !(name in properties));
  if (unknown.length > 0) {
    const hint = tool.hasBody ? ' The request body goes in the "body" argument.' : '';
    throw new ArgumentError(`Unknown argument(s): ${unknown.join(', ')}.${hint}`);
  }
  const required = (tool.inputSchema.required ?? []) as string[];
  const missing = required.filter((name) => args[name] === undefined);
  if (missing.length > 0) throw new ArgumentError(`Missing required argument(s): ${missing.join(', ')}.`);
}

function unreachable(baseUrl: string, error: unknown): ToolOutput {
  if (error instanceof Error && error.name === 'TimeoutError')
    return failure(`The app at ${baseUrl} did not answer in time.`);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
  return failure(
    `Could not reach the app at ${baseUrl} (${cause}). Start the app first (npm run dev in its repository), ` +
      'or set SERIOUS_TAVERN_URL to the address it listens on.',
  );
}

/** Turns the API's error envelope into text that keeps its code, message and details. */
function describeFailure(status: number, text: string): ToolOutput {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const envelope = errorEnvelopeSchema.safeParse(json);
  if (!envelope.success) return failure(`HTTP ${status}: ${text.slice(0, 500) || 'no details'}`);
  const { code, message, details } = envelope.data.error;
  const lines = [`Error ${status} ${code}: ${message}`];
  if (details !== undefined) lines.push(`Details: ${JSON.stringify(details)}`);
  return failure(lines.join('\n'));
}

/**
 * Calls the endpoint behind a tool: the one piece of code between an agent and the API, the same for every tool. A
 * failure of any kind comes back as an error output, never as an exception.
 */
export async function callEndpoint(tool: EndpointTool, rawArgs: unknown, options: CallOptions): Promise<ToolOutput> {
  const args = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
  if (!isRecord(args)) return failure('The arguments must be a JSON object.');
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  let response: Response;
  try {
    checkArguments(tool, args);
    const body = tool.hasBody ? parseBody(args.body) : undefined;
    response = await (options.fetch ?? fetch)(`${baseUrl}${fillPath(tool, args)}${queryString(tool, args)}`, {
      method: tool.method,
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    return error instanceof ArgumentError ? failure(error.message) : unreachable(baseUrl, error);
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) return describeFailure(response.status, text);
  if (text === '') return ok('Done (no content).');
  try {
    return ok(JSON.stringify(trimResponse(tool.endpoint, JSON.parse(text))));
  } catch {
    return ok(text);
  }
}
