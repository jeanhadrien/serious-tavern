import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ProviderModel } from '@st/shared';
import type { NodePanelContext } from './types.js';
import { filterModels, isListed, modelFacts } from './modelOptions.js';
import { useModelList } from './useModelList.js';

type ModelPickerProps = {
  providerId: string;
  value: string;
  onChange(model: string): void;
  loadModels: NodePanelContext['loadModels'];
};

/**
 * A model id input with a searchable list of what the provider serves. The input is the config value:
 * every keystroke is saved as typed, so any id works whether or not the list knows it. The list only helps.
 */
export function ModelPicker({ providerId, value, onChange, loadModels }: ModelPickerProps) {
  const { state, refresh } = useModelList(providerId, loadModels);
  const [open, setOpen] = useState(false);
  // What was typed since the field got focus; `null` shows the whole list instead of filtering by the saved id.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const id = useId();
  const optionId = (index: number) => `${id}-option-${index}`;
  const { shown, total } = useMemo(() => filterModels(state.models, query ?? ''), [state.models, query]);
  const expanded = open && shown.length > 0;

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  };
  const choose = (model: ProviderModel) => {
    onChange(model.id);
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(Math.max(active + step, -1), shown.length - 1));
    } else if (event.key === 'Enter' && expanded && active >= 0) {
      event.preventDefault();
      const model = shown[active];
      if (model) choose(model);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="model-picker">
      <label htmlFor={`${id}-input`}>Model</label>
      <div className="model-picker-field">
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        {state.status !== 'unavailable' && (
          <button
            type="button"
            className="model-picker-refresh"
            aria-label="Refresh model list"
            title="Refresh model list"
            disabled={state.status === 'loading'}
            onClick={refresh}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded && (
        <div id={`${id}-list`} role="listbox" aria-label="Models" className="model-picker-list">
          {shown.map((model, index) => (
            // Mouse down must not blur the input, or the list closes before the click lands.
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled on the combobox input
            <div
              key={model.id}
              id={optionId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={model.id === value ? 'model-option current' : 'model-option'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(model)}
            >
              <span className="model-name">{model.name ?? model.id}</span>
              {model.name && model.name !== model.id && <span className="model-id">{model.id}</span>}
              <span className="model-facts">{modelFacts(model)}</span>
            </div>
          ))}
        </div>
      )}
      {expanded && total > shown.length && (
        <small className="hint">{total - shown.length} more, keep typing to narrow down</small>
      )}
      <ModelStatus state={state} value={value} />
    </div>
  );
}

/** One quiet line under the field: loading, the failure, the unlisted-id hint, or the list size. */
function ModelStatus({ state, value }: { state: ReturnType<typeof useModelList>['state']; value: string }) {
  if (state.status === 'unavailable') return null;
  let text: string | undefined;
  if (state.status === 'loading') text = 'Loading models…';
  else if (state.status === 'error')
    text = `Could not load the model list: ${state.error}. You can still type any model id.`;
  else if (state.models.length === 0) text = 'This provider returned no models. The id is used as typed.';
  else if (value.trim() && !isListed(state.models, value)) text = "Not in this provider's list. It is used as typed.";
  else text = `${state.models.length} models available`;
  return (
    <small className="hint" role="status">
      {text}
    </small>
  );
}
