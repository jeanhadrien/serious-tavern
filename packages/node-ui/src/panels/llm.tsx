import { reasoningEfforts } from '@st/shared';
import type { NodeConfigPanelProps } from './types.js';
import { parseStopSequences, updateNumericOption } from './llmConfig.js';

export function LlmPanel({ config, onChange, context }: NodeConfigPanelProps) {
  const presets = context?.presets ?? [];
  const providers = context?.providers ?? [];
  const selectedPreset = presets.find((preset) => preset.id === config.presetId);
  const presetPath = `/presets?id=${config.presetId}`;
  return (
    <div className="config-fields">
      <label>
        Provider
        <select
          value={String(config.provider ?? 'openrouter')}
          onChange={(e) => onChange({ ...config, provider: e.target.value })}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <input value={String(config.model ?? '')} onChange={(e) => onChange({ ...config, model: e.target.value })} />
      </label>
      <label>
        Preset
        <select
          value={String(config.presetId ?? '')}
          onChange={(e) => onChange({ ...config, presetId: e.target.value })}
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
      {Boolean(config.presetId) &&
        (context?.renderLink ? (
          context.renderLink(presetPath, 'Edit preset ↗')
        ) : (
          <a href={presetPath}>Edit preset ↗</a>
        ))}
      <label className="check">
        <input
          type="checkbox"
          checked={config.mergeSystemMessages === true}
          onChange={(e) => onChange({ ...config, mergeSystemMessages: e.target.checked })}
        />
        Merge consecutive system messages
      </label>
      <p className="hint">Joins adjacent unnamed system messages with a blank line. Named messages stay separate.</p>
      {(['temperature', 'maxTokens', 'topP', 'frequencyPenalty', 'presencePenalty'] as const).map((key) => (
        <label key={key}>
          {key}
          <input
            type="number"
            step={key === 'maxTokens' ? 1 : 0.1}
            value={String(config[key] ?? '')}
            onChange={(e) => onChange(updateNumericOption(config, key, e.target.value))}
          />
        </label>
      ))}
      <label>
        Reasoning effort
        <select
          value={String(config.reasoningEffort ?? 'off')}
          onChange={(e) => onChange({ ...config, reasoningEffort: e.target.value })}
        >
          {reasoningEfforts.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reasoning max tokens
        <input
          type="number"
          step={1}
          min={1}
          value={String(config.reasoningMaxTokens ?? '')}
          onChange={(e) => onChange(updateNumericOption(config, 'reasoningMaxTokens', e.target.value))}
        />
      </label>
      <p className="hint">
        Effort is "off" by default, which leaves the model's own behaviour. Reasoning tokens count against max tokens,
        so keep that comfortably higher.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={config.reasoningExclude === true}
          onChange={(e) => onChange({ ...config, reasoningExclude: e.target.checked })}
        />
        Hide reasoning from the response
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={config.streaming !== false}
          onChange={(e) => onChange({ ...config, streaming: e.target.checked })}
        />
        Stream the response
      </label>
      <label>
        Stop sequences (one per line)
        <textarea
          value={Array.isArray(config.stop) ? config.stop.join('\n') : ''}
          onChange={(e) => onChange({ ...config, stop: parseStopSequences(e.target.value) })}
        />
      </label>
    </div>
  );
}
