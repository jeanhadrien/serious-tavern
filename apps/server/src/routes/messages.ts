import type { FastifyInstance, FastifyReply } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { errorBody } from '../errors.js';
import { sendMessage, runTurn } from '../services/chat.js';
import type { TurnFrame } from '../services/turn-stream.js';
import { updateMessage, deleteMessage } from '../services/messages.js';
import type { ApiRoute } from './types.js';

type EventStream = { send(frame: TurnFrame): void; end(): void };

/**
 * Aborts when the client goes away before its response is done. It listens from the moment the request arrives,
 * not from the first turn event: a message waiting in the queue (behind another turn or an after-reply run) has
 * sent nothing yet, and its client leaving must still cancel it.
 */
function clientLifetime({ raw }: FastifyReply): AbortController {
  const lifetime = new AbortController();
  raw.on('close', () => {
    if (!raw.writableFinished) lifetime.abort();
  });
  return lifetime;
}

// Opened lazily, on the first turn event, so failures before the turn starts are plain JSON errors.
function openEventStream(reply: FastifyReply): EventStream {
  reply.hijack();
  const { raw } = reply;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return {
    send(frame) {
      if (!raw.writableEnded && !raw.destroyed) raw.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
    },
    end() {
      if (!raw.writableEnded) raw.end();
    },
  };
}

export function registerMessages(app: FastifyInstance, context: AppContext) {
  app.post<ApiRoute<'sendMessage'>>('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = apiContract.sendMessage.params.parse(request.params);
    const { content } = apiContract.sendMessage.body.parse(request.body);
    // The plain endpoint only cancels a message that has not started: once it runs, it finishes whoever waits.
    return reply.send(await sendMessage(context, id, content, clientLifetime(reply).signal));
  });
  app.post<ApiRoute<'streamTurn'>>('/api/sessions/:id/messages/stream', async (request, reply) => {
    const { id } = apiContract.streamTurn.params.parse(request.params);
    const { content } = apiContract.streamTurn.body.parse(request.body);
    const lifetime = clientLifetime(reply);
    const sse: { stream?: EventStream } = {};
    const emit = (frame: TurnFrame) => {
      sse.stream ??= openEventStream(reply);
      sse.stream.send(frame);
    };
    try {
      const result = await runTurn(context, id, content, { emit, signal: lifetime.signal });
      emit({ type: 'turn.complete', ...result });
    } catch (error) {
      if (!sse.stream) throw error;
      sse.stream.send({ type: 'turn.error', error: errorBody(error) });
    } finally {
      sse.stream?.end();
    }
  });
  app.post<ApiRoute<'stopTurn'>>('/api/sessions/:id/stop', async (request, reply) => {
    const { id } = apiContract.stopTurn.params.parse(request.params);
    context.turns.stop(id);
    return reply.code(204).send();
  });
  app.patch<ApiRoute<'updateMessage'>>('/api/sessions/:id/messages/:messageId', async (request) => {
    const { id, messageId } = apiContract.updateMessage.params.parse(request.params);
    const body = apiContract.updateMessage.body.parse(request.body);
    return updateMessage(context, id, messageId, body);
  });
  app.delete<ApiRoute<'deleteMessage'>>('/api/sessions/:id/messages/:messageId', async (request, reply) => {
    const { id, messageId } = apiContract.deleteMessage.params.parse(request.params);
    await deleteMessage(context, id, messageId);
    return reply.code(204).send();
  });
}
