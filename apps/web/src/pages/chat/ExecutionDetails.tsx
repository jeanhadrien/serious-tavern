import { useEffect, useState } from 'react';
import type { ExecutionLog } from '@st/shared';
import { executionsApi } from '../../api.js';
import { POST_NO_LOG } from './story/postRunText.js';
import { LegacyRequestDetails, WireDetails, WireList } from './WireDetails.js';

/**
 * A run's log in a disclosure. `optional` is for a run that may have no log (a run after the reply cut short by a
 * restart): the fetch is silent, and a missing log is said in words instead of toasted.
 */
export function ExecutionDetails({
  id,
  cached,
  label = 'Execution details',
  optional = false,
  defaultOpen = false,
}: {
  id: string;
  cached?: ExecutionLog;
  label?: string;
  optional?: boolean;
  /** Starts expanded, for a log the user just asked for. */
  defaultOpen?: boolean;
}) {
  const [execution, setExecution] = useState(cached);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!execution)
      void executionsApi
        .get(id, optional ? { silent: true } : undefined)
        .then(setExecution)
        .catch(() => setMissing(optional));
  }, [id]);
  return (
    <details className="execution" open={defaultOpen || undefined}>
      <summary>{label}</summary>
      {missing && <p className="hint">{POST_NO_LOG}</p>}
      {execution && (
        <>
          <small>
            {execution.status} · {execution.id}
          </small>
          {execution.settings && Object.keys(execution.settings).length > 0 && (
            <small className="execution-settings">
              Chat settings:{' '}
              {Object.entries(execution.settings)
                .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                .join(', ')}
            </small>
          )}
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
              {node.wires?.length ? (
                <WireList wires={node.wires} />
              ) : node.wire ? (
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
