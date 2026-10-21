import { useState } from 'react';
import { X } from 'lucide-react';
import { replayPolicies } from '@st/shared';
import type { NodePanelContext } from './types.js';
import { StateKeyPicker } from './StateKeyPicker.js';
import {
  addTarget,
  canAddTarget,
  describeTarget,
  parallelChoice,
  removeTarget,
  setMaxSteps,
  setParallel,
  toolTargets,
  type ToolList,
  type ToolTarget,
} from './toolsConfig.js';

interface LlmToolsProps {
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  context?: NodePanelContext;
}

const replayLabels: Record<(typeof replayPolicies)[number], string> = {
  never: 'Never',
  sinceLastUser: 'Since the last user message',
  always: 'Always',
};

const noKey: ToolTarget = { definitionId: '', key: '' };

/** One list of state keys (readable or writable): the keys so far, and a picker to add another. */
function ToolKeys({ title, list, config, onChange, context }: LlmToolsProps & { title: string; list: ToolList }) {
  const [draft, setDraft] = useState<ToolTarget>(noKey);
  const catalog = context?.stateDefinitions ?? [];
  const targets = toolTargets(config, list);
  return (
    <div className="config-field collection-picker">
      <span>{title}</span>
      {targets.length > 0 && (
        <ul className="collection-picker-rows">
          {targets.map((target, index) => {
            const { label, known } = describeTarget(target, catalog);
            return (
              <li key={`${target.definitionId}/${target.key}`} className={known ? undefined : 'unknown'}>
                <span className="collection-picker-name" title={label}>
                  {label}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  title="Remove"
                  onClick={() => onChange(removeTarget(config, list, index))}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <StateKeyPicker
        kind="target"
        config={draft}
        onChange={(next) => setDraft({ definitionId: String(next.definitionId ?? ''), key: String(next.key ?? '') })}
        context={context}
      />
      <button
        type="button"
        disabled={!canAddTarget(config, list, draft)}
        onClick={() => {
          onChange(addTarget(config, list, draft));
          setDraft(noKey);
        }}
      >
        Add key
      </button>
    </div>
  );
}

/** The LLM node's tools: the state keys the model may read and write, and how its tool loop behaves. */
export function LlmTools({ config, onChange, context }: LlmToolsProps) {
  return (
    <>
      <h4>Tools</h4>
      <p className="hint">
        Lets the model read and change story state while it answers. Nothing is offered unless listed. A key the model
        may write can always be read too. Writes follow the same rules as State Write. A node that can write state runs
        even when no Chat Output needs it.
      </p>
      <ToolKeys title="Keys the model may read" list="read" config={config} onChange={onChange} context={context} />
      <ToolKeys title="Keys the model may write" list="write" config={config} onChange={onChange} context={context} />
      <label>
        Step limit
        <input
          type="number"
          step={1}
          min={1}
          placeholder="5"
          value={String(config.maxSteps ?? '')}
          onChange={(e) => onChange(setMaxSteps(config, e.target.value))}
        />
      </label>
      <p className="hint">
        Model calls it gets while it uses tools; after that it is asked for a final answer without them.
      </p>
      <label>
        Tool choice
        <select
          value={config.toolChoice === 'required' ? 'required' : 'auto'}
          onChange={(e) => onChange({ ...config, toolChoice: e.target.value })}
        >
          <option value="auto">The model chooses</option>
          <option value="required">Must use a tool first</option>
        </select>
      </label>
      <label>
        Parallel tool calls
        <select value={parallelChoice(config)} onChange={(e) => onChange(setParallel(config, e.target.value))}>
          <option value="default">Backend default</option>
          <option value="on">Allowed</option>
          <option value="off">One at a time</option>
        </select>
      </label>
      <label>
        Send earlier reasoning back
        <select
          value={String(config.replayReasoning ?? 'never')}
          onChange={(e) => onChange({ ...config, replayReasoning: e.target.value })}
        >
          {replayPolicies.map((policy) => (
            <option key={policy} value={policy}>
              {replayLabels[policy]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Only reasoning written by this same provider and model is sent. The reasoning of the current tool loop is always
        kept.
      </p>
    </>
  );
}
