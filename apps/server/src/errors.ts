export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (resource: string) => new HttpError(404, 'NOT_FOUND', `${resource} not found`);
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function requireEntity<T extends { id: string }>(repository: Repository<T>, id: string, resource: string) {
  const item = await repository.get(id);
  if (!item) throw notFound(resource);
  return item;
}

export function registerErrors(app: FastifyInstance) {
  app.setNotFoundHandler(() => {
    throw notFound('Route');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      const body: ErrorEnvelope = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      };
      return reply.code(400).send(body);
    }
    if (error instanceof HttpError) {
      const body: ErrorEnvelope = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      };
      return reply.code(error.statusCode).send(body);
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const body: ErrorEnvelope = {
        error: {
          code:
            typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
              ? error.code
              : 'BAD_REQUEST',
          message: errorMessage(error),
        },
      };
      return reply.code(statusCode).send(body);
    }
    console.error(`Unexpected API error on ${request.method} ${request.url}:`, error);
    const body: ErrorEnvelope = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return reply.code(500).send(body);
  });
}
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ErrorEnvelope } from '@st/shared';
import type { Repository } from './storage/repository.js';
