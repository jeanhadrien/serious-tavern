import { Splitter } from '../components/splitter/Splitter.js';

interface ResizeHandleProps {
  label: string;
  /** Current width of the column this handle resizes. */
  value: number;
  /** +1 when dragging right grows the column (L), -1 when it shrinks it (R). */
  direction: 1 | -1;
  area: string;
  onResize: (width: number) => void;
  /** Double-click: the column goes back to its default width. */
  onReset: () => void;
}

/** The splitter between two shell columns, placed in the shell grid. */
export function ResizeHandle({ label, value, direction, area, onResize, onReset }: ResizeHandleProps) {
  return (
    <Splitter
      label={label}
      value={value}
      direction={direction}
      onChange={onResize}
      onReset={onReset}
      style={{ gridArea: area }}
    />
  );
}
