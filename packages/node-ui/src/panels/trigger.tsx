import { Fragment, useEffect, useState } from 'react';
import { parseDecimal } from '@st/shared';
import type { NodeConfigPanelProps } from './types.js';
import { DraftInput } from './DraftInput.js';
import {
  TRIGGER_LEVELS,
  addSignal,
  changeSignal,
  levelSetting,
  numberSetting,
  parseAtLeast,
  parseTurns,
  parseUnit,
  removeSignal,
  signalNameHint,
  signalRows,
  withLevel,
  withSignals,
  type LevelField,
} from './triggerConfig.js';

/** A number box that keeps what is typed and commits only valid values (see `DraftInput`, which adds a label). */
function NumberCell({
  label,
  value,
  parse,
  onCommit,
}: {
  label: string;
  value: number;
  parse(text: string): number | undefined;
  onCommit(value: number): void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : String(value)));
  }, [value]);
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parse(event.target.value);
        if (parsed !== undefined && parsed !== value) onCommit(parsed);
      }}
      onBlur={() => parse(text) === undefined && setText(String(value))}
    />
  );
}

/** A signal's name becomes an input (renaming drops the connections to the old name), so it commits on blur. */
function NameCell({ value, onCommit, label }: { value: string; onCommit(value: string): void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <input
      aria-label={label}
      placeholder="Name"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
    />
  );
}

export function TriggerPanel({ descriptor, config, onChange }: NodeConfigPanelProps) {
  const defaults = descriptor.defaultConfig;
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const rows = signalRows(config);
  const level = (field: LevelField, at: number, parse: (text: string) => number | undefined, label: string) => (
    <NumberCell
      label={label}
      value={levelSetting(config, defaults, field, at)}
      parse={parse}
      onCommit={(next) => onChange(withLevel(config, defaults, field, at, next))}
    />
  );
  const maxLevel = numberSetting(config, defaults, 'maxLevel', 2);
  return (
    <div className="config-fields">
      <DraftInput
        label="Base chance"
        value={numberSetting(config, defaults, 'baseChance')}
        format={String}
        parse={parseUnit}
        onCommit={(next) => set('baseChance', next)}
        invalid="A number from 0 to 1"
        hint="The starting chance each turn, before growth and signals."
      />
      <DraftInput
        label="Growth per turn"
        value={numberSetting(config, defaults, 'growthPerTurn')}
        format={String}
        parse={(text) => parseAtLeast(text, 0)}
        onCommit={(next) => set('growthPerTurn', next)}
        invalid="A number, 0 or more"
        hint="Added for every turn since the last firing (any level); a firing starts it over."
      />
      <DraftInput
        label="Volatility"
        value={numberSetting(config, defaults, 'volatility')}
        format={String}
        parse={parseUnit}
        onCommit={(next) => set('volatility', next)}
        invalid="A number from 0 to 1"
        hint="Scales the score by 0.5 + volatility. A connected Volatility input overrides it."
      />
      <label>
        Max level
        <select value={String(maxLevel)} onChange={(event) => set('maxLevel', Number(event.target.value))}>
          {TRIGGER_LEVELS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <small className="hint">The highest level that can fire. A connected Max level input overrides it.</small>
      </label>
      <div className="config-field">
        <span>Levels</span>
        <small className="hint">
          Cooldown: turns between two firings at that level (0 = none). Weight: relative chance when it fires (0 =
          never).
        </small>
        <div className="level-table">
          <span />
          <small>Cooldown</small>
          <small>Weight</small>
          {TRIGGER_LEVELS.map((item) => (
            <Fragment key={item}>
              <span>Level {item}</span>
              {level('cooldowns', item, parseTurns, `Cooldown of level ${item}`)}
              {level('levelWeights', item, (text) => parseAtLeast(text, 0), `Weight of level ${item}`)}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="config-field">
        <span>Signals</span>
        <small className="hint">
          Each named signal is an input from 0 to 1 (a classifier score, say) that adds weight × signal to the score. A
          negative weight lowers it; not connected counts as 0.
        </small>
        <div className="signal-table">
          {rows.length > 0 && (
            <>
              <small>Name</small>
              <small>Weight</small>
              <span />
            </>
          )}
          {rows.map((row, index) => {
            const problem = signalNameHint(row.name, rows, index);
            return (
              <Fragment key={index}>
                <NameCell
                  label={`Signal ${index + 1} name`}
                  value={row.name}
                  onCommit={(name) => onChange(withSignals(config, changeSignal(rows, index, { name })))}
                />
                <NumberCell
                  label={`Signal ${index + 1} weight`}
                  value={row.weight}
                  parse={parseDecimal}
                  onCommit={(weight) => onChange(withSignals(config, changeSignal(rows, index, { weight })))}
                />
                <button
                  type="button"
                  aria-label={`Remove signal ${index + 1}`}
                  title="Remove signal"
                  onClick={() => onChange(withSignals(config, removeSignal(rows, index)))}
                >
                  ×
                </button>
                {problem && <small className="hint wide-row">{problem}</small>}
              </Fragment>
            );
          })}
          <button type="button" className="wide-row" onClick={() => onChange(withSignals(config, addSignal(rows)))}>
            + Add signal
          </button>
        </div>
      </div>
    </div>
  );
}
