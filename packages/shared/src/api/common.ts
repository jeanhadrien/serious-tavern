import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().uuid() });
export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// Upload bodies and binary responses are bytes on the wire, not JSON.
export const binarySchema = z.instanceof(Uint8Array);
export const noContentSchema = z.undefined();
const emptySchema = z.object({});
const noBodySchema = z.unknown();

export function endpoint<
  R extends z.ZodType,
  B extends z.ZodType = typeof noBodySchema,
  P extends z.ZodType = typeof emptySchema,
  Q extends z.ZodType = typeof emptySchema,
>(
  response: R,
  body = noBodySchema as unknown as B,
  params = emptySchema as unknown as P,
  query = emptySchema as unknown as Q,
) {
  return { response, body, params, query };
}
