import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { currentChangeEvents, type ChangeEvent } from '../services/change-events.js';
import type { ApiRoute } from './types.js';

const HEARTBEAT_MS = 15_000;

/** `GET /api/events`: Server-Sent Events telling the web app that resources changed on disk. */
export function registerEvents(app: FastifyInstance, context: AppContext, options: { heartbeatMs?: number } = {}) {
  const open = new Set<() => void>();
  app.get<ApiRoute<'streamChanges'>>('/api/events', async (_request, reply) => {
    reply.hijack();
    const { raw } = reply;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: ChangeEvent) => {
      if (!raw.writableEnded && !raw.destroyed) raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    // Comment frames keep proxies and idle timeouts from closing a quiet stream.
    const heartbeat = setInterval(() => {
      if (!raw.writableEnded && !raw.destroyed) raw.write(': keepalive\n\n');
    }, options.heartbeatMs ?? HEARTBEAT_MS);
    // Live events wait behind the initial snapshot, so a newer event is never followed by an older state.
    const ready = currentChangeEvents(context).then(
      (events) => events.forEach(send),
      () => undefined,
    );
    const unsubscribe = context.changes.subscribe((event) => void ready.then(() => send(event)));
    const end = () => {
      // Runs for a client disconnect and for app shutdown, possibly both.
      if (!open.delete(end)) return;
      clearInterval(heartbeat);
      unsubscribe();
      if (!raw.writableEnded) raw.end();
    };
    open.add(end);
    raw.on('close', end);
    return reply;
  });
  // Open streams would otherwise keep `app.close()` waiting forever; preClose runs before the server stops.
  app.addHook('preClose', async () => {
    for (const end of [...open]) end();
  });
}
