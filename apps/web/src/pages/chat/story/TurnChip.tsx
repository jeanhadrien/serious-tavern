import { useEffect, useId, useRef, useState } from 'react';
import { Database, TriangleAlert } from 'lucide-react';
import { IconButton } from '../../../components/IconButton.js';
import { ExecutionDetails } from '../ExecutionDetails.js';
import { POST_DETAILS_LABEL, POST_STOPPED_NOTE, chipLabel, postFailureNote } from './postRunText.js';
import type { StoryChip } from './turnChips.js';

/**
 * The card under the chip: the turn's writes in plain words, the note for a reply edited afterwards, and how its
 * after-reply run ended when that was badly, with the run's log (fetched when the card opens).
 */
export function TurnChipCard({ chip, id }: { chip: StoryChip; id?: string }) {
  const { post } = chip;
  return (
    <div className="message-story-card" id={id}>
      {chip.lines.length ? (
        <>
          <strong>Turn {chip.turnNumber} stored:</strong>
          <ul>
            {chip.lines.map((line, index) => (
              // A turn can write the same words twice (two Draw nodes): the position keeps keys unique.
              <li key={index}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <strong>Turn {chip.turnNumber}</strong>
      )}
      {chip.editedAfter && chip.lines.length > 0 && (
        <p className="hint">Edited after it was stored: the values above came from the original text.</p>
      )}
      {post?.status === 'error' && <p className="error">{postFailureNote(post.message)}</p>}
      {post?.status === 'stopped' && <p className="hint">{POST_STOPPED_NOTE}</p>}
      {post?.executionId && <ExecutionDetails id={post.executionId} label={POST_DETAILS_LABEL} optional />}
    </div>
  );
}

/**
 * "What this turn stored": a small button on the last reply of a turn that wrote story state or whose after-reply
 * run failed (the icon then warns). It discloses an inline
 * card under the button (not a floating layer: the thread scrolls, and an inline card needs no placement on a
 * phone); Escape or a second click closes it.
 */
export function TurnChip({ chip }: { chip: StoryChip }) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // The card grows the message: keep it on screen when the reply sits at the bottom of the thread.
    wrapper.current?.scrollIntoView?.({ block: 'nearest' });
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return (
    <div className="message-story" ref={wrapper}>
      <IconButton
        icon={chip.post?.status === 'error' ? TriangleAlert : Database}
        label={chipLabel(chip.lines.length > 0)}
        className={chip.post?.status === 'error' ? 'chip-alert' : ''}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && <TurnChipCard chip={chip} id={cardId} />}
    </div>
  );
}
