import { randomUUID } from 'node:crypto';
import type { ApiResponse, ChatMessage } from '@st/shared';
import { executeWorkflow, ExecutionFailure, registry, validateWorkflow } from '@st/engine';
import type { ChatReply } from '@st/engine';
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
    const errors = await validateWorkflow(workflow, { presets, characters });
    if (errors.length) throw new HttpError(400, 'WORKFLOW_INVALID', 'Invalid workflow', errors);
    const history = [...current.messages];
    const character = current.characterId ? await characters.get(current.characterId) : undefined;
    const persona = current.personaId ? await personas.get(current.personaId) : undefined;
    const userMessage: ChatMessage = { id: randomUUID(), role: 'user', content, createdAt: now() };
    current.messages.push(userMessage);
    current.updatedAt = now();
    await sessions.save(current);
    const keepReplies = (replies: ChatReply[], executionId: string) => {
      userMessage.executionId = executionId;
      const messages = replies.map(({ content, name, characterId }) => ({
        id: randomUUID(),
        role: 'assistant' as const,
        content,
        ...(name === undefined ? {} : { name }),
        ...(characterId === undefined ? {} : { characterId }),
        createdAt: now(),
        executionId,
      }));
      current.messages.push(...messages);
      current.updatedAt = now();
      return messages;
    };
    try {
      const { replies, execution } = await executeWorkflow(workflow, {
        message: content,
        sessionId: id,
        history,
        secrets,
        resources: { presets, characters },
        character,
        persona,
      });
      const assistantMessages = keepReplies(replies, execution.id);
      await executions.save(execution);
      result = { userMessage, assistantMessages, execution };
    } catch (error) {
      if (error instanceof ExecutionFailure) {
        const assistantMessages = keepReplies(error.replies, error.execution.id);
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
          assistantMessages,
        });
      } else failure = error;
    }
    return current;
  });
  if (!session) throw notFound('Session');
  if (failure) throw failure;
  return result!;
}
