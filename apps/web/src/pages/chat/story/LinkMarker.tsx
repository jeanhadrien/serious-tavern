import { useEffect, useId, useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { IconButton } from '../../../components/IconButton.js';
import { STATUS_LABELS } from './linkedItems.js';
import type { MessageLinkNote } from './linkMarkers.js';

/**
 * A small button on a message that story state items link to; it discloses an inline card listing them (not a
 * floating layer, like the turn chip). Escape or a second click closes it.
 */
export function LinkMarker({ notes }: { notes: readonly MessageLinkNote[] }) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    wrapper.current?.scrollIntoView?.({ block: 'nearest' });
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  const label =
    notes.length === 1 ? '1 state item links to this message' : `${notes.length} state items link to this message`;
  return (
    <div className="message-story message-links" ref={wrapper}>
      <IconButton
        icon={Link2}
        label={label}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="message-story-card" id={cardId}>
          <strong>Linked state</strong>
          <ul>
            {notes.map((note, index) => (
              <li key={`${note.key}:${index}`}>
                <span className="link-note-key">{note.key}</span>: {note.range}
                {note.preview && <> · {note.preview}</>}
                {note.status !== 'intact' && <em> ({STATUS_LABELS[note.status]}, not used)</em>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
