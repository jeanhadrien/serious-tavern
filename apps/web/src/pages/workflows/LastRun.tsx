import { skipReasonText } from '@st/shared';
import { previewValue, type LastRunIO } from './lastRunIO.js';

function Value({ value }: { value: unknown }) {
  const { text, truncated } = previewValue(value);
  if (!truncated) return <pre>{text}</pre>;
  return (
    <>
      <pre>{text}</pre>
      <details>
        <summary>Show all</summary>
        <pre>{previewValue(value, Number.POSITIVE_INFINITY).text}</pre>
      </details>
    </>
  );
}

/**
 * A node's inputs and output from the open chat's last run of the workflow, collapsed. `stale` greys it with a note: the
 * workflow changed since the run (or has unsaved edits), so the rebuilt inputs may not be what the node received.
 */
export function LastRun({
  io,
  stale,
  nameOf,
}: {
  /** Undefined when the chat has no run of this workflow, or the run never reached the node. */
  io: LastRunIO | undefined;
  stale: boolean;
  nameOf: (nodeId: string) => string | undefined;
}) {
  return (
    <details className={`last-run${stale ? ' stale' : ''}`}>
      <summary>Last run{io ? ` · ${io.status}` : ''}</summary>
      {!io ? (
        <p className="hint">The open chat has no run of this workflow that reached this node.</p>
      ) : (
        <>
          {stale && (
            <p className="hint">
              The workflow changed since this run, so the inputs below may differ from what the node got.
            </p>
          )}
          {io.skip && <p className="hint">{skipReasonText(io.skip, nameOf)}</p>}
          {io.error && <p className="error">{io.error}</p>}
          {io.inputs.map((input) => (
            <div key={input.port} className="last-run-value">
              <small>{input.label}</small>
              {input.arrived ? <Value value={input.value} /> : <p className="hint">Nothing arrived.</p>}
            </div>
          ))}
          {io.output !== undefined && (
            <div className="last-run-value">
              <small>Output</small>
              <Value value={io.output} />
            </div>
          )}
        </>
      )}
    </details>
  );
}
