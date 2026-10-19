import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';

export interface AlternativeControlsProps {
  /** Position of the shown alternative (0-based) and how many the last turn has. */
  index: number;
  count: number;
  /** Regenerate and swipe are locked while a message change is saved. */
  disabled: boolean;
  /** Swiping also waits for an after-reply run (the server refuses it while one works). */
  swipeDisabled: boolean;
  onRegenerate: () => void;
  /** -1 for the previous alternative, 1 for the next. */
  onSwipe: (direction: -1 | 1) => void;
}

/** Regenerate, and `‹ n/N ›` once there are two alternatives: shown on the last reply of the last turn only. */
export function AlternativeControls({
  index,
  count,
  disabled,
  swipeDisabled,
  onRegenerate,
  onSwipe,
}: AlternativeControlsProps) {
  const locked = disabled || swipeDisabled;
  return (
    <div className="message-alternatives">
      <IconButton icon={RotateCw} label="Regenerate reply" disabled={disabled} onClick={onRegenerate} />
      {count > 1 && (
        <>
          <IconButton
            icon={ChevronLeft}
            label="Previous alternative"
            data-swipe="-1"
            disabled={locked || index === 0}
            onClick={() => onSwipe(-1)}
          />
          <span className="alternative-count" role="status" aria-label="Shown alternative">
            {index + 1}/{count}
          </span>
          <IconButton
            icon={ChevronRight}
            label="Next alternative"
            data-swipe="1"
            disabled={locked || index === count - 1}
            onClick={() => onSwipe(1)}
          />
        </>
      )}
    </div>
  );
}
