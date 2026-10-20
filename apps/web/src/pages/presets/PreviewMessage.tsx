import { Brain, Wrench } from 'lucide-react';
import { callsOf, type PromptMessage } from '@st/shared';
import { displayArguments } from './previewToolNames.js';

/**
 * One rendered prompt message: role, text, the tool calls of an assistant message, which call a tool result
 * answers, and a collapsed reasoning view when the message carries any.
 */
export function PreviewMessage(props: { message: PromptMessage; toolName?: string }) {
  const { message, toolName } = props;
  const calls = callsOf(message);
  return (
    <div className="preview-message">
      <strong>
        {message.role}
        {message.name && <span> · {message.name}</span>}
        {message.role === 'tool' && (
          <span className="preview-tool-ref">
            {' '}
            · {toolName ? `answers ${toolName}` : `call ${message.tool_call_id ?? '?'}`}
          </span>
        )}
      </strong>
      {(message.content || calls.length === 0) && <p>{message.content}</p>}
      {calls.map((call) => (
        <div className="preview-tool-call" key={call.id}>
          <span>
            <Wrench size={12} aria-hidden /> {call.function.name}
          </span>
          <pre>{displayArguments(call.function.arguments)}</pre>
        </div>
      ))}
      {message.reasoning && (
        <details className="preview-reasoning">
          <summary>
            <Brain size={12} aria-hidden /> reasoning
          </summary>
          <p>{message.reasoning}</p>
        </details>
      )}
    </div>
  );
}
