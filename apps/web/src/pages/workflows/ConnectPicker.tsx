import { useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../../keyboard/escapeRegistry.js';
import { clampToBounds, filterCandidates, type Candidate } from './connectCandidates.js';
import type { PickerState } from './useConnectPicker.js';
import './connectPicker.css';

// Matches the CSS (width, and the filter plus the list's max-height) so the clamp keeps it inside the canvas.
const SIZE = { width: 240, height: 300 };

/**
 * The small node picker at the point where a connection was dropped on empty canvas: a filter and the node types
 * with a port that accepts it. The quick add (no connection) lists every type. Arrows move, Enter picks, Escape or a
 * click outside closes it.
 */
export function ConnectPicker({
  picker,
  onPick,
  onClose,
}: {
  picker: PickerState;
  onPick: (candidate: Candidate) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = filterCandidates(picker.candidates, query);
  const index = Math.min(active, Math.max(shown.length - 1, 0));
  useEscapeLayer(true, onClose);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    // Pointer down, not click: the drag that opened the picker ends with a click-like event on the canvas.
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);
  useEffect(() => {
    root.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [index, query]);
  const move = (step: number) => {
    if (shown.length) setActive((index + step + shown.length) % shown.length);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const candidate = shown[index];
      if (candidate) onPick(candidate);
      else onClose();
    }
  };
  const { x, y } = clampToBounds(picker.at, picker.bounds, SIZE);
  const connecting = picker.from !== undefined;
  return (
    <div
      className="connect-picker"
      ref={root}
      role="dialog"
      aria-label={connecting ? 'Add a connected node' : 'Add a node'}
      style={{ left: x, top: y }}
    >
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label="Filter node types"
        aria-expanded="true"
        aria-controls="connect-picker-list"
        aria-activedescendant={shown[index] ? `connect-option-${shown[index].descriptor.type}` : undefined}
        placeholder="Filter nodes…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        className="connect-picker-list"
        id="connect-picker-list"
        role="listbox"
        aria-label={connecting ? 'Compatible nodes' : 'Nodes'}
      >
        {shown.map((candidate, position) => (
          // Mouse down must not blur the input, or the picker's filter loses focus before the click lands.
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled on the filter input
          <div
            key={candidate.descriptor.type}
            id={`connect-option-${candidate.descriptor.type}`}
            className="connect-option"
            role="option"
            tabIndex={-1}
            aria-selected={position === index}
            title={candidate.descriptor.description}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(position)}
            onClick={() => onPick(candidate)}
          >
            <span className="connect-option-label">{candidate.descriptor.label}</span>
            <small>
              {candidate.descriptor.category}
              {candidate.port && ` · ${candidate.port.label}${candidate.coerce ? ' → text' : ''}`}
            </small>
          </div>
        ))}
        {!shown.length && (
          <p className="connect-picker-empty">
            {picker.candidates.length || !connecting ? 'No node matches.' : 'No node type accepts this connection.'}
          </p>
        )}
      </div>
    </div>
  );
}
