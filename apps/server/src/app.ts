import Fastify from 'fastify';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workflowSchema, type Workflow, type Session, type ExecutionLog } from '@st/shared';
import { descriptors, executeWorkflow, ExecutionFailure, validateWorkflow } from '@st/engine';
import { JsonRepository } from './storage/repository.js';
import { SecretStore } from './secrets/store.js';
import { seed } from './seed.js';

const idParam = z.object({ id: z.string().uuid() });
const nameParam = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/) });
const now = () => new Date().toISOString();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function createApp(dataDir = join(process.cwd(), 'data'), options: { seed?: boolean } = {}) {
  const app = Fastify({ logger: false });
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (body.length === 0) return done(null, {});
    parseJson(request, typeof body === 'string' ? body : body.toString('utf8'), done);
  });
  const workflows = new JsonRepository<Workflow>(join(dataDir, 'workflows'));
  const sessions = new JsonRepository<Session>(join(dataDir, 'sessions'));
  const executions = new JsonRepository<ExecutionLog>(join(dataDir, 'executions'));
  const secrets = new SecretStore(dataDir);
  await secrets.init();
  if (options.seed !== false) await seed(workflows);

  app.get('/api/node-types', async () => descriptors());
  app.get('/api/workflows', async () => workflows.list());
  app.post('/api/workflows', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(1) }).parse(request.body);
    const date = now();
    const workflow: Workflow = { id: randomUUID(), name: body.name, nodes: [], edges: [], createdAt: date, updatedAt: date };
    await workflows.save(workflow);
    return reply.code(201).send(workflow);
  });
  app.get('/api/workflows/:id', async (request, reply) =>
    await workflows.get(idParam.parse(request.params).id) ?? reply.code(404).send({ error: 'Workflow not found' }));
  app.put('/api/workflows/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const old = await workflows.get(id);
    if (!old) return reply.code(404).send({ error: 'Workflow not found' });
    const body = workflowSchema.pick({ name: true, nodes: true, edges: true }).parse(request.body);
    const workflow = { ...old, ...body, updatedAt: now() };
    await workflows.save(workflow);
    return workflow;
  });
  app.delete('/api/workflows/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if ((await sessions.list()).some(s => s.workflowId === id))
      return reply.code(409).send({ error: 'Workflow is used by a session' });
    await workflows.delete(id);
    return reply.code(204).send();
  });
  app.post('/api/workflows/:id/validate', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const workflow = await workflows.get(id);
    if (!workflow) return reply.code(404).send({ error: 'Workflow not found' });
    const errors = validateWorkflow(workflow);
    return { valid: errors.length === 0, errors };
  });

  app.get('/api/sessions', async () => (await sessions.list()).map(({ messages, ...session }) =>
    ({ ...session, messageCount: messages.length })));
  app.post('/api/sessions', async (request, reply) => {
    const body = z.object({ workflowId: z.string().uuid(), title: z.string().trim().min(1).optional() }).parse(request.body);
    if (!await workflows.get(body.workflowId)) return reply.code(404).send({ error: 'Workflow not found' });
    const date = now();
    const session: Session = { id: randomUUID(), title: body.title ?? 'New chat', workflowId: body.workflowId,
      messages: [], createdAt: date, updatedAt: date };
    await sessions.save(session);
    return reply.code(201).send(session);
  });
  app.get('/api/sessions/:id', async (request, reply) =>
    await sessions.get(idParam.parse(request.params).id) ?? reply.code(404).send({ error: 'Session not found' }));
  app.patch('/api/sessions/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ title: z.string().trim().min(1).optional(), workflowId: z.string().uuid().optional() }).parse(request.body);
    const session = await sessions.get(id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    if (body.workflowId && !await workflows.get(body.workflowId)) return reply.code(404).send({ error: 'Workflow not found' });
    Object.assign(session, body, { updatedAt: now() });
    await sessions.save(session);
    return session;
  });
  app.delete('/api/sessions/:id', async (request, reply) => {
    await sessions.delete(idParam.parse(request.params).id);
    return reply.code(204).send();
  });
  app.post('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { content } = z.object({ content: z.string().trim().min(1) }).parse(request.body);
    const session = await sessions.get(id);
    if (!session) return reply.code(404).send({ error: 'Session not found' });
    const workflow = await workflows.get(session.workflowId);
    if (!workflow) return reply.code(404).send({ error: 'Workflow not found' });
    const errors = validateWorkflow(workflow);
    if (errors.length) return reply.code(400).send({ error: `Invalid workflow: ${errors.join('; ')}` });
    const history = [...session.messages];
    const userMessage = { id: randomUUID(), role: 'user' as const, content, createdAt: now() };
    session.messages.push(userMessage);
    session.updatedAt = now();
    await sessions.save(session);
    try {
      const { reply: text, execution } = await executeWorkflow(workflow, {
        message: content, sessionId: id, history, secrets
      });
      const assistantMessage = { id: randomUUID(), role: 'assistant' as const, content: text, createdAt: now(), executionId: execution.id };
      session.messages.push(assistantMessage);
      session.updatedAt = now();
      await Promise.all([sessions.save(session), executions.save(execution)]);
      return { userMessage, assistantMessage, execution };
    } catch (error) {
      if (error instanceof ExecutionFailure) {
        await executions.save(error.execution);
        return reply.code(500).send({ error: error.message, execution: error.execution, userMessage });
      }
      throw error;
    }
  });
  app.get('/api/executions/:id', async (request, reply) =>
    await executions.get(idParam.parse(request.params).id) ?? reply.code(404).send({ error: 'Execution not found' }));
  app.get('/api/secrets', async () => secrets.list());
  app.put('/api/secrets/:name', async (request, reply) => {
    const { name } = nameParam.parse(request.params);
    const { value } = z.object({ value: z.string().min(1) }).parse(request.body);
    await secrets.set(name, value);
    return reply.code(204).send();
  });
  app.delete('/api/secrets/:name', async (request, reply) => {
    await secrets.delete(nameParam.parse(request.params).name);
    return reply.code(204).send();
  });
  app.setErrorHandler((error, _request, reply) => {
    const invalid = error instanceof z.ZodError;
    const code = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
    const status = invalid ? 400 : typeof code === 'number' && code >= 400 && code < 500 ? code : 500;
    reply.code(status).send({ error: invalid ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : errorMessage(error) });
  });
  return app;
}
