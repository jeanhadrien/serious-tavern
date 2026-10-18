import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link2 } from 'lucide-react';
import { IconButton } from '../../../components/IconButton.js';
import { STATUS_LABELS } from './linkedItems.js';
import type { MessageLinkNote } from './linkMarkers.js';

/**
 * The marker of a message that story state items link to: a small button (put it in the message's header) and an
 * inline card listing the items (put it under the header; not a floating layer, like the turn chip's card). Escape or
 * a second click closes it. Both are null for a message nothing links to. A hook because the two live in different
 * places of the message.
 */
export function useLinkMarker(notes: readonly MessageLinkNote[] | undefined): { button: ReactNode; card: ReactNode } {
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
  if (!notes?.length) return { button: null, card: null };
  const label =
    notes.length === 1 ? '1 state item links to this message' : `${notes.length} state items link to this message`;
  return {
    button: (
      <IconButton
        icon={Link2}
        label={label}
        className="message-link-button"
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
    ),
    card: open ? (
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
    ) : null,
  };
}
