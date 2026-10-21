import type { NodePanelContext } from './types.js';
import { definitionOptions, keyOptions, pickDefinition, pickKey, pickerHint, type PickerKind } from './stateConfig.js';

interface StateKeyPickerProps {
  /**
   * State Write also fits its operation to the key and drops its fixed value when the target changes; a node that
   * works on a list (`collection`) only offers collection keys, and the Thread node (`thread`) only thread keys.
   */
  kind: PickerKind;
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  context?: NodePanelContext;
}

/** The state definition and key a State Read, State Write, Next Chunk, Unlinked Messages or Thread node targets. */
export function StateKeyPicker({ kind, config, onChange, context }: StateKeyPickerProps) {
  const catalog = context?.stateDefinitions ?? [];
  const definitionId = typeof config.definitionId === 'string' ? config.definitionId : '';
  const key = typeof config.key === 'string' ? config.key : '';
  const definition = catalog.find((item) => item.id === definitionId);
  const hint = pickerHint(config, catalog, kind);
  const link = () => {
    const to = `/state-definitions?id=${encodeURIComponent(definitionId)}`;
    return context?.renderLink ? context.renderLink(to, 'Edit definition ↗') : <a href={to}>Edit definition ↗</a>;
  };
  return (
    <div className="config-field state-picker">
      <label>
        State definition
        <select
          value={definitionId}
          disabled={!catalog.length && !definitionId}
          onChange={(event) => onChange(pickDefinition(config, event.target.value, catalog, kind))}
        >
          <option value="">Choose a definition</option>
          {definitionOptions(definitionId, catalog).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {definition && link()}
      <label>
        Key
        <select
          value={key}
          disabled={!definition}
          onChange={(event) => onChange(pickKey(config, event.target.value, catalog, kind))}
        >
          <option value="">Choose a key</option>
          {keyOptions(definition, key, kind).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}
