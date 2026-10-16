import type { NodePanelContext } from './types.js';
import { definitionOptions, keyOptions, pickDefinition, pickKey } from './stateConfig.js';

interface StateKeyPickerProps {
  /** State Write also fits its operation to the key and drops its fixed value when the target changes. */
  kind: 'read' | 'write';
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  context?: NodePanelContext;
}

/** The state definition and key a State Read or State Write node targets, picked from the catalog. */
export function StateKeyPicker({ kind, config, onChange, context }: StateKeyPickerProps) {
  const catalog = context?.stateDefinitions ?? [];
  const definitionId = typeof config.definitionId === 'string' ? config.definitionId : '';
  const key = typeof config.key === 'string' ? config.key : '';
  const definition = catalog.find((item) => item.id === definitionId);
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
          {keyOptions(definition, key).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {!catalog.length && (
        <small className="hint">Create a state definition in the State definitions list first.</small>
      )}
    </div>
  );
}
