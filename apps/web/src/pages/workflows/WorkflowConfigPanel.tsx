import { Link } from 'react-router-dom';
import { NodeConfigPanel } from '@st/node-ui';
import type { Character, NodeInstance, Preset, ApiResponse } from '@st/shared';
import type { CanvasNode } from './model.js';

export function WorkflowConfigPanel({
  current,
  presets,
  characters,
  providersList,
  updateConfig,
  onClose,
}: {
  current: CanvasNode;
  presets: Preset[];
  characters: Character[];
  providersList: ApiResponse<'listProviders'>;
  updateConfig: (config: NodeInstance['config']) => void;
  onClose: () => void;
}) {
  const currentDescriptor = current.data.descriptor;
  const selectedPreset = presets.find((preset) => preset.id === current.data.config.presetId);
  return (
    <aside className="config-panel">
      <div className="toolbar">
        <h3>{currentDescriptor.label}</h3>
        <button onClick={onClose}>×</button>
      </div>
      <p className="hint">{currentDescriptor.description}</p>
      {current.data.unknown ? (
        <pre className="unknown-config">{JSON.stringify(current.data.config, null, 2)}</pre>
      ) : currentDescriptor.type === 'llm' ? (
        <div className="config-fields">
          <label>
            Provider
            <select
              value={String(current.data.config.provider ?? 'openrouter')}
              onChange={(e) => updateConfig({ ...current.data.config, provider: e.target.value })}
            >
              {providersList.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <input
              value={String(current.data.config.model ?? '')}
              onChange={(e) => updateConfig({ ...current.data.config, model: e.target.value })}
            />
          </label>
          <label>
            Preset
            <select
              value={String(current.data.config.presetId ?? '')}
              onChange={(e) => updateConfig({ ...current.data.config, presetId: e.target.value })}
            >
              <option value="">Choose a preset</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          {selectedPreset && (
            <div className="preset-port-summary">
              <small>LLM input ports from this preset</small>
              {selectedPreset.inputs.map((input) => (
                <span key={input.id}>
                  {input.key} : {input.dataType}
                </span>
              ))}
            </div>
          )}
          {Boolean(current.data.config.presetId) && (
            <Link to={`/presets?id=${current.data.config.presetId}`}>Edit preset ↗</Link>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={current.data.config.mergeSystemMessages === true}
              onChange={(e) => updateConfig({ ...current.data.config, mergeSystemMessages: e.target.checked })}
            />
            Merge consecutive system messages
          </label>
          <p className="hint">
            Joins adjacent unnamed system messages with a blank line. Named messages stay separate.
          </p>
          {(['temperature', 'maxTokens', 'topP', 'frequencyPenalty', 'presencePenalty'] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                type="number"
                step={key === 'maxTokens' ? 1 : 0.1}
                value={String(current.data.config[key] ?? '')}
                onChange={(e) => {
                  const config = { ...current.data.config };
                  if (e.target.value === '') delete config[key];
                  else config[key] = Number(e.target.value);
                  updateConfig(config);
                }}
              />
            </label>
          ))}
          <label>
            Stop sequences (one per line)
            <textarea
              value={Array.isArray(current.data.config.stop) ? current.data.config.stop.join('\n') : ''}
              onChange={(e) =>
                updateConfig({
                  ...current.data.config,
                  stop: e.target.value ? e.target.value.split('\n').filter(Boolean) : undefined,
                })
              }
            />
          </label>
        </div>
      ) : (
        <NodeConfigPanel
          descriptor={currentDescriptor}
          config={current.data.config}
          onChange={updateConfig}
          characters={characters}
        />
      )}
    </aside>
  );
}
