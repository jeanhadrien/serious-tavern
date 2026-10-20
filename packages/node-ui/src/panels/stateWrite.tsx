import { stateOpsFor, type StateKeyDef, type StateNodeOp } from '@st/shared';
import type { NodeConfigPanelProps } from './types.js';
import { StateKeyPicker } from './StateKeyPicker.js';
import { StateValueEditor } from './StateValueEditor.js';
import { withKeepReasoning } from './stateConfig.js';
import { pickOp, withFixedValue } from './stateValue.js';

/** How each operation reads in the select; `add` and `delete` mean different things for a list and a thread. */
function opLabel(op: string, def: StateKeyDef | undefined): string {
  const thread = def?.type === 'thread';
  switch (op) {
    case 'set':
      return 'Set to a value';
    case 'increment':
      return 'Add to the number';
    case 'add':
      return thread ? 'Add an exchange' : 'Add an item';
    case 'remove':
      return thread ? 'Remove an exchange by id' : 'Remove an item by id';
    case 'delete':
      if (thread) return 'Empty the thread';
      return def?.type === 'collection' ? 'Empty the list' : 'Reset to the default';
    default:
      return op;
  }
}

/** What a thread key takes: no fixed value, an LLM node's exchange, and whether to keep its reasoning. */
function ThreadOptions({
  op,
  config,
  onChange,
}: {
  op: string;
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
}) {
  if (op !== 'add')
    return (
      <p className="hint">
        {op === 'remove'
          ? 'Connect the id of the exchange to remove to Item id (a thread has no fixed value).'
          : 'This operation needs no value.'}
      </p>
    );
  return (
    <>
      <p className="hint">
        Connect an LLM node's Exchange output to Exchange; it is stored as one item with the tool calls the model made.
        Input is optional: what the exchange answers (text or a message), stored with it as its user side.
      </p>
      <div className="config-field">
        <label className="check">
          <input
            type="checkbox"
            checked={config.keepReasoning === true}
            onChange={(event) => onChange(withKeepReasoning(config, event.target.checked))}
          />
          Keep reasoning
        </label>
        <small className="hint">
          Also stores the exchange's reasoning and the data a backend needs to continue it. Off by default: it is rarely
          needed and can be large; the run's log keeps it either way.
        </small>
      </div>
    </>
  );
}

/** State Write: the key, the operation its type allows, and the fixed value to store (a thread has its own options). */
export function StateWritePanel({ descriptor, config, onChange, context }: NodeConfigPanelProps) {
  const catalog = context?.stateDefinitions ?? [];
  const definition = catalog.find((item) => item.id === config.definitionId);
  const keyName = typeof config.key === 'string' ? config.key : '';
  const def = definition && Object.hasOwn(definition.keys, keyName) ? definition.keys[keyName] : undefined;
  const op = String(config.op ?? descriptor.defaultConfig.op ?? 'set');
  const allowed: readonly string[] = def ? stateOpsFor(def.type) : [];
  const thread = def?.type === 'thread';
  return (
    <div className="config-fields">
      <StateKeyPicker kind="write" config={config} onChange={onChange} context={context} />
      <label className="state-field">
        Operation
        <select value={op} disabled={!def} onChange={(event) => onChange(pickOp(config, event.target.value))}>
          {!allowed.includes(op) && (
            <option value={op}>{def ? `Not allowed for this key (${op})` : opLabel(op, undefined)}</option>
          )}
          {allowed.map((allowedOp) => (
            <option key={allowedOp} value={allowedOp}>
              {opLabel(allowedOp, def)}
            </option>
          ))}
        </select>
      </label>
      {thread && allowed.includes(op) && <ThreadOptions op={op} config={config} onChange={onChange} />}
      {def && !thread && allowed.includes(op) && (
        <StateValueEditor
          def={def}
          op={op as StateNodeOp}
          value={config.value ?? undefined}
          onChange={(next) => onChange(withFixedValue(config, next))}
        />
      )}
      {!thread && (
        <p className="hint">Fixed value: stored when nothing is connected to Value; a connected input wins.</p>
      )}
      <p className="hint">
        Run when (optional input): connect a Condition branch or a Random chance output to write only on that branch.
        Not connected, it writes every turn.
      </p>
    </div>
  );
}
