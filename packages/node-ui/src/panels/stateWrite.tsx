import { stateOpsFor, type StateKeyDef, type StateNodeOp } from '@st/shared';
import type { NodeConfigPanelProps } from './types.js';
import { StateKeyPicker } from './StateKeyPicker.js';
import { StateValueEditor } from './StateValueEditor.js';
import { pickOp, withFixedValue } from './stateValue.js';

/** How each operation reads in the select; `delete` means a different thing for a list. */
function opLabel(op: string, def: StateKeyDef | undefined): string {
  switch (op) {
    case 'set':
      return 'Set to a value';
    case 'increment':
      return 'Add to the number';
    case 'add':
      return 'Add an item';
    case 'remove':
      return 'Remove an item by id';
    case 'delete':
      return def?.type === 'collection' ? 'Empty the list' : 'Reset to the default';
    default:
      return op;
  }
}

/** State Write: the key, the operation its type allows, and the fixed value to store. */
export function StateWritePanel({ descriptor, config, onChange, context }: NodeConfigPanelProps) {
  const catalog = context?.stateDefinitions ?? [];
  const definition = catalog.find((item) => item.id === config.definitionId);
  const keyName = typeof config.key === 'string' ? config.key : '';
  const def = definition && Object.hasOwn(definition.keys, keyName) ? definition.keys[keyName] : undefined;
  const op = String(config.op ?? descriptor.defaultConfig.op ?? 'set');
  const allowed: readonly string[] = def ? stateOpsFor(def.type) : [];
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
      {def && allowed.includes(op) && (
        <StateValueEditor
          def={def}
          op={op as StateNodeOp}
          value={config.value ?? undefined}
          onChange={(next) => onChange(withFixedValue(config, next))}
        />
      )}
      <p className="hint">Fixed value: stored when nothing is connected to Value; a connected input wins.</p>
      <p className="hint">
        Run when (optional input): connect a Condition branch or a Random chance output to write only on that branch.
        Not connected, it writes every turn.
      </p>
    </div>
  );
}
