import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, replyWorkflows, type ApiResponse, type WorkflowInvalidDetails } from '@st/shared';
import { pruneInvalidEdges, validateWorkflow } from '@st/engine';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';
import { nodeResources } from '../services/node-resources.js';
import type { ApiRoute } from './types.js';

export function registerWorkflows(app: FastifyInstance, context: AppContext) {
  const { workflows, sessions } = context;
  app.get<ApiRoute<'listWorkflows'>>('/api/workflows', async () => workflows.list());
  app.post<ApiRoute<'createWorkflow'>>('/api/workflows', async (request, reply) => {
    const body = apiContract.createWorkflow.body.parse(request.body);
    const date = now();
    const workflow: ApiResponse<'createWorkflow'> = {
      id: randomUUID(),
      name: body.name,
      nodes: body.nodes ?? [],
      edges: body.edges ?? [],
      ...(body.settings ? { settings: body.settings } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
      createdAt: date,
      updatedAt: date,
    };
    await workflows.save(workflow);
    return reply.code(201).send(workflow);
  });
  app.get<ApiRoute<'getWorkflow'>>('/api/workflows/:id', async (request) =>
    requireEntity(workflows, apiContract.getWorkflow.params.parse(request.params).id, 'Workflow'),
  );
  app.put<ApiRoute<'updateWorkflow'>>('/api/workflows/:id', async (request) => {
    const { id } = apiContract.updateWorkflow.params.parse(request.params);
    const body = apiContract.updateWorkflow.body.parse(request.body);
    const existing = await requireEntity(workflows, id, 'Workflow');
    const pruned = await pruneInvalidEdges({ ...existing, ...body }, nodeResources(context));
    const workflow = await workflows.update(id, (old) => ({ ...old, ...body, edges: pruned.edges, updatedAt: now() }));
    if (!workflow) throw notFound('Workflow');
    return workflow;
  });
  app.delete<ApiRoute<'deleteWorkflow'>>('/api/workflows/:id', async (request, reply) => {
    const { id } = apiContract.deleteWorkflow.params.parse(request.params);
    // Used by a chat when its reply list names it (`replyWorkflows`: the legacy `workflowId` for a chat without a list).
    if ((await sessions.list()).some((s) => replyWorkflows(s).some((entry) => entry.workflowId === id)))
      throw new HttpError(409, 'WORKFLOW_IN_USE', 'Workflow is used by a session');
    await workflows.delete(id);
    return reply.code(204).send();
  });
  app.post<ApiRoute<'validateWorkflowDraft'>>('/api/workflows/validate', async (request) => {
    const draft = apiContract.validateWorkflowDraft.body.parse(request.body);
    return { issues: await validateWorkflow(draft, nodeResources(context)) };
  });
  app.post<ApiRoute<'validateWorkflow'>>('/api/workflows/:id/validate', async (request) => {
    const { id } = apiContract.validateWorkflow.params.parse(request.params);
    const workflow = await requireEntity(workflows, id, 'Workflow');
    const errors = await validateWorkflow(workflow, nodeResources(context));
    if (errors.length)
      throw new HttpError(422, 'WORKFLOW_INVALID', `Workflow "${workflow.name}" is invalid`, {
        workflowId: workflow.id,
        workflowName: workflow.name,
        issues: errors,
      } satisfies WorkflowInvalidDetails);
    return { valid: true, errors: [] };
  });
}
