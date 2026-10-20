import type { WireExchange } from '@st/shared';

const json = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** One HTTP call of an LLM node as it went over the wire: URL, redacted headers, body and response. */
export function WireDetails({ wire, call }: { wire: WireExchange; call?: string }) {
  const streamed = (wire.body as { stream?: unknown } | undefined)?.stream === true;
  return (
    <details className="wire">
      <summary>
        {call ?? 'LLM call'} · {wire.method} {wire.url}
        {wire.status === undefined ? ' · no response' : ` · ${wire.status}`}
      </summary>
      <details>
        <summary>Headers (secrets redacted)</summary>
        <pre>{json(wire.headers)}</pre>
      </details>
      <details>
        <summary>Request body</summary>
        <pre>{json(wire.body)}</pre>
      </details>
      {wire.response !== undefined && (
        <details>
          <summary>Response{streamed ? ' (stream chunks folded into one object)' : ''}</summary>
          <pre>{json(wire.response)}</pre>
        </details>
      )}
    </details>
  );
}

/** All HTTP calls of an LLM node, in order: numbered when there is more than one (a tool loop makes several). */
export function WireList({ wires }: { wires: readonly WireExchange[] }) {
  return (
    <>
      {wires.map((wire, index) => (
        <WireDetails
          key={index}
          wire={wire}
          call={wires.length > 1 ? `LLM call ${index + 1} of ${wires.length}` : undefined}
        />
      ))}
    </>
  );
}

/** The canonical request that executions logged before the wire log existed. */
export function LegacyRequestDetails({ request }: { request: unknown }) {
  return (
    <details>
      <summary>LLM request (older log, before provider mapping)</summary>
      <pre>{json(request)}</pre>
    </details>
  );
}
