import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiContract, replyWorkflows, type WorkflowDraft, type WorkflowInvalidDetails } from '@st/shared';
import { validateWorkflow } from '@st/engine';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';
import { nodeResources } from '../services/node-resources.js';
import {
  checkWorkflowForSave,
  withStoredPositions,
  withoutSaveReport,
  type WorkflowSaveReport,
} from '../services/workflow-save.js';
import { route } from './route.js';

export function registerWorkflows(app: FastifyInstance, context: AppContext) {
  const { workflows, sessions } = context;
  route(app, 'listWorkflows', async () => workflows.list());
  route(app, 'createWorkflow', async (request, reply) => {
    const body = apiContract.createWorkflow.body.parse(request.body);
    const date = now();
    const draft: WorkflowDraft = {
      id: randomUUID(),
      name: body.name,
      nodes: body.nodes ?? [],
      edges: body.edges ?? [],
      ...(body.settings ? { settings: body.settings } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
      createdAt: date,
      updatedAt: date,
    };
    const { workflow, report } = await checkWorkflowForSave(draft, nodeResources(context));
    await workflows.save(workflow);
    return reply.code(201).send({ ...workflow, ...report });
  });
  route(app, 'getWorkflow', async (request) =>
    requireEntity(workflows, apiContract.getWorkflow.params.parse(request.params).id, 'Workflow'),
  );
  route(app, 'updateWorkflow', async (request) => {
    const { id } = apiContract.updateWorkflow.params.parse(request.params);
    const body = withoutSaveReport(apiContract.updateWorkflow.body.parse(request.body));
    let report: WorkflowSaveReport | undefined;
    // The body is passthrough, so it may carry any key: `id` and `createdAt` are pinned. Spreading `old` first keeps
    // unknown fields from newer versions (migrate-on-write).
    const workflow = await workflows.update(id, async (old) => {
      const checked = await checkWorkflowForSave(
        { ...old, ...body, nodes: withStoredPositions(body.nodes, old.nodes), id, createdAt: old.createdAt },
        nodeResources(context),
      );
      report = checked.report;
      return { ...checked.workflow, updatedAt: now() };
    });
    if (!workflow || !report) throw notFound('Workflow');
    return { ...workflow, ...report };
  });
  route(app, 'deleteWorkflow', async (request, reply) => {
    const { id } = apiContract.deleteWorkflow.params.parse(request.params);
    // Used by a chat when its reply list names it (`replyWorkflows`: the legacy `workflowId` for a chat without a list).
    if ((await sessions.list()).some((s) => replyWorkflows(s).some((entry) => entry.workflowId === id)))
      throw new HttpError(409, 'WORKFLOW_IN_USE', 'Workflow is used by a session');
    await workflows.delete(id);
    return reply.code(204).send();
  });
  // A draft the editor holds, judged as sent and never stored; its problems are the answer, not an error.
  route(app, 'validateWorkflowDraft', async (request) => {
    const draft = apiContract.validateWorkflowDraft.body.parse(request.body);
    return { issues: await validateWorkflow(draft, nodeResources(context)) };
  });
  route(app, 'validateWorkflow', async (request) => {
    const { id } = apiContract.validateWorkflow.params.parse(request.params);
    const workflow = await requireEntity(workflows, id, 'Workflow');
    const errors = await validateWorkflow(workflow, nodeResources(context));
    if (errors.length)
      throw new HttpError(422, 'WORKFLOW_INVALID', `Workflow "${workflow.name}" is invalid`, {
        workflowId: workflow.id,
        workflowName: workflow.name,
        issues: errors,
      } satisfies WorkflowInvalidDetails);
    return { valid: true as const, errors: [] };
  });
}
