import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// Upload bodies and binary responses are bytes on the wire, not JSON.
export const binarySchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array);
export const noContentSchema = z.undefined();
const emptySchema = z.object({});
const noBodySchema = z.unknown();

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/**
 * Where an endpoint lives and what it is for. `path` is the full Fastify-style template, `/api` prefix included, with
 * `:name` for each path parameter (the keys of the `params` schema). `description` is plain language for API
 * consumers such as an MCP agent: what the call does and what to watch for, not how the server does it.
 */
export type EndpointInfo = { method: HttpMethod; path: `/api/${string}`; description?: string };

/** One API endpoint: its `info` and the schemas of its response, body, path params and query. Fastify and the clients read it all from here. */
export function endpoint<
  const I extends EndpointInfo,
  R extends z.ZodType,
  B extends z.ZodType = typeof noBodySchema,
  P extends z.ZodType = typeof emptySchema,
  Q extends z.ZodType = typeof emptySchema,
>(
  info: I,
  response: R,
  body = noBodySchema as unknown as B,
  params = emptySchema as unknown as P,
  query = emptySchema as unknown as Q,
) {
  return { ...info, response, body, params, query };
}
