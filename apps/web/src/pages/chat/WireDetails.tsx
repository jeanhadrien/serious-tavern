import type { WireExchange } from '@st/shared';

const json = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** One LLM node's HTTP exchange as it went over the wire: URL, redacted headers, body and response. */
export function WireDetails({ wire }: { wire: WireExchange }) {
  const streamed = (wire.body as { stream?: unknown } | undefined)?.stream === true;
  return (
    <details className="wire">
      <summary>
        LLM call · {wire.method} {wire.url}
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

/** The canonical request that executions logged before the wire log existed. */
export function LegacyRequestDetails({ request }: { request: unknown }) {
  return (
    <details>
      <summary>LLM request (older log, before provider mapping)</summary>
      <pre>{json(request)}</pre>
    </details>
  );
}
