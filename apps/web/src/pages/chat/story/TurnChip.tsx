import { useEffect, useId, useState } from 'react';
import { Database } from 'lucide-react';
import { IconButton } from '../../../components/IconButton.js';
import type { StoryChip } from './turnChips.js';

/** The card under the chip: the turn's writes in plain words, and the note for a reply edited afterwards. */
export function TurnChipCard({ chip, id }: { chip: StoryChip; id?: string }) {
  return (
    <div className="message-story-card" id={id}>
      <strong>Turn {chip.turnNumber} stored:</strong>
      <ul>
        {chip.lines.map((line, index) => (
          // A turn can write the same words twice (two Draw nodes): the position keeps keys unique.
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines are static text in a fixed order.
          <li key={index}>{line}</li>
        ))}
      </ul>
      {chip.editedAfter && (
        <p className="hint">Edited after it was stored: the values above came from the original text.</p>
      )}
    </div>
  );
}

/**
 * "What this turn stored": a small button on the last reply of a turn that wrote story state. It discloses an inline
 * card under the button (not a floating layer: the thread scrolls, and an inline card needs no placement on a
 * phone); Escape or a second click closes it.
 */
export function TurnChip({ chip }: { chip: StoryChip }) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return (
    <div className="message-story">
      <IconButton
        icon={Database}
        label="What this turn stored"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && <TurnChipCard chip={chip} id={cardId} />}
    </div>
  );
}
