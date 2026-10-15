import { useEffect, useState } from 'react';
import type { ExecutionLog } from '@st/shared';
import { executionsApi } from '../../api.js';
import { LegacyRequestDetails, WireDetails } from './WireDetails.js';

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
              <strong>{node.name ?? nodeId}</strong> · {node.status} · {node.durationMs ?? 0}ms
              {node.error && <p className="error">{node.error}</p>}
              {node.logs?.map((line, index) => (
                <pre key={index}>{line}</pre>
              ))}
              {node.wire ? (
                <WireDetails wire={node.wire} />
              ) : (
                node.request !== undefined && <LegacyRequestDetails request={node.request} />
              )}
              {node.output !== undefined && <pre>{JSON.stringify(node.output, null, 2)}</pre>}
            </div>
          ))}
        </>
      )}
    </details>
  );
}
