import { useState } from 'react';
import { Check, Copy, Pencil, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { copyMessageText } from './copyText.js';
import { deleteClick } from './story/deleteConfirm.js';

interface MessageActionsProps {
  disabled: boolean;
  /** The message's raw text (Markdown): shows the Copy button. */
  copyText?: string;
  /** Edit and Delete are shown together, only when both are given. */
  onEdit?: () => void;
  onDelete?: () => Promise<boolean>;
  /**
   * What deleting this message would undo of the chat's story state, asked when the trash button is clicked (never
   * while rendering). Lines mean the delete is confirmed with a dialog that lists them, instead of the inline step.
   */
  undoOnDelete?: () => readonly string[] | undefined;
  /** Told when the inline "Delete message?" step opens or closes (the message shows what the delete affects). */
  onConfirming?: (confirming: boolean) => void;
  /** What the delete stops using (linked story state): put before the question in the dialog of a delete that undoes stored state. */
  deleteNote?: string;
}

export function MessageActions({
  disabled,
  copyText,
  onEdit,
  onDelete,
  undoOnDelete,
  onConfirming,
  deleteNote,
}: MessageActionsProps) {
  const [confirming, setConfirmingState] = useState(false);
  const setConfirming = (value: boolean) => {
    setConfirmingState(value);
    onConfirming?.(value);
  };
  const editable = onEdit && onDelete;
  return (
    <div className={`message-actions${confirming ? ' confirming' : ''}`}>
      {confirming && onDelete ? (
        <>
          <small>Delete message?</small>
          <IconButton
            icon={Check}
            label="Confirm delete message"
            disabled={disabled}
            onClick={() => {
              void onDelete().then(() => setConfirming(false));
            }}
          />
          <IconButton icon={X} label="Cancel delete message" disabled={disabled} onClick={() => setConfirming(false)} />
        </>
      ) : (
        <>
          {copyText !== undefined && (
            <IconButton icon={Copy} label="Copy message" onClick={() => void copyMessageText(copyText)} />
          )}
          {editable && (
            <>
              <IconButton icon={Pencil} label="Edit message" disabled={disabled} onClick={onEdit} />
              <IconButton
                icon={Trash2}
                label="Delete message"
                disabled={disabled}
                onClick={() =>
                  void deleteClick(undoOnDelete?.(), deleteNote).then((click) => {
                    if (click === 'inline') setConfirming(true);
                    else if (click === 'delete') void onDelete();
                  })
                }
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
