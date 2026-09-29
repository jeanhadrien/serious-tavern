import { useEffect, useState } from 'react';
import type { ExecutionLog } from '@st/shared';
import { executionsApi } from '../../api.js';

export function ExecutionDetails({ id, cached }: { id: string; cached?: ExecutionLog }) {
  const [execution, setExecution] = useState(cached);
  useEffect(() => {
    if (!execution)
      void executionsApi
        .get(id)
        .then(setExecution)
        .catch(() => {});
  }, [id]);
  return (
    <details className="execution">
      <summary>Execution details</summary>
      {execution && (
        <>
          <small>
            {execution.status} · {execution.id}
          </small>
          {execution.warnings?.map((warning) => (
            <p className="hint" key={warning}>
              {warning}
            </p>
          ))}
          {Object.entries(execution.nodes).map(([nodeId, node]) => (
            <div className="execution-node" key={nodeId}>
              <strong>{nodeId}</strong> · {node.status} · {node.durationMs ?? 0}ms
              {node.error && <p className="error">{node.error}</p>}
              {node.request !== undefined && (
                <details>
                  <summary>LLM request (no secrets)</summary>
                  <pre>{JSON.stringify(node.request, null, 2)}</pre>
                </details>
              )}
              {node.output !== undefined && <pre>{JSON.stringify(node.output, null, 2)}</pre>}
            </div>
          ))}
        </>
      )}
    </details>
  );
}
