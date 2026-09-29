import { randomUUID } from 'node:crypto';
import type { ApiResponse } from '@st/shared';
import { executeWorkflow, ExecutionFailure, registry, validateWorkflow } from '@st/engine';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';

export async function sendMessage(
  { workflows, presets, sessions, executions, characters, personas, secrets }: AppContext,
  id: string,
  content: string,
): Promise<ApiResponse<'sendMessage'>> {
  let result: ApiResponse<'sendMessage'> | undefined;
  let failure: unknown;
  // Hold the repository's session lock until execution and both writes settle.
  const session = await sessions.update(id, async (current) => {
    const workflow = await requireEntity(workflows, current.workflowId, 'Workflow');
    const errors = await validateWorkflow(workflow, { presets });
    if (errors.length) throw new HttpError(400, 'WORKFLOW_INVALID', 'Invalid workflow', errors);
    const history = [...current.messages];
    const character = current.characterId ? await characters.get(current.characterId) : undefined;
    const persona = current.personaId ? await personas.get(current.personaId) : undefined;
    const userMessage = { id: randomUUID(), role: 'user' as const, content, createdAt: now() };
    current.messages.push(userMessage);
    current.updatedAt = now();
    await sessions.save(current);
    try {
      const { reply: text, execution } = await executeWorkflow(workflow, {
        message: content,
        sessionId: id,
        history,
        secrets,
        resources: { presets },
        character,
        persona,
      });
      const assistantMessage = {
        id: randomUUID(),
        role: 'assistant' as const,
        content: text,
        createdAt: now(),
        executionId: execution.id,
      };
      current.messages.push(assistantMessage);
      current.updatedAt = now();
      await executions.save(execution);
      result = { userMessage, assistantMessage, execution };
    } catch (error) {
      if (error instanceof ExecutionFailure) {
        await executions.save(error.execution);
        const failedId = /^Node ([^ ]+) \(/.exec(error.message)?.[1];
        const failedNode = workflow.nodes.find((node) => node.id === failedId);
        const label = failedNode && registry.get(failedNode.type)?.label;
        const message =
          label && failedId
            ? `${label} (${failedId}): ${error.execution.nodes[failedId]?.error ?? error.message}`
            : error.message;
        failure = new HttpError(500, 'WORKFLOW_EXECUTION_FAILED', message, {
          execution: error.execution,
          userMessage,
        });
      } else failure = error;
    }
    return current;
  });
  if (!session) throw notFound('Session');
  if (failure) throw failure;
  return result!;
}
