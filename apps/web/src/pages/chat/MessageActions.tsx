import { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { deleteConfirmText } from './story/undoList.js';

interface MessageActionsProps {
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  /**
   * What deleting this message would undo of the chat's story state, asked when the trash button is clicked (never
   * while rendering). Lines mean the delete is confirmed with a dialog that lists them, instead of the inline step.
   */
  undoOnDelete?: () => readonly string[] | undefined;
}

export function MessageActions({ disabled, onEdit, onDelete, undoOnDelete }: MessageActionsProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={`message-actions${confirming ? ' confirming' : ''}`}>
      {confirming ? (
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
          <IconButton icon={Pencil} label="Edit message" disabled={disabled} onClick={onEdit} />
          <IconButton
            icon={Trash2}
            label="Delete message"
            disabled={disabled}
            onClick={() => {
              const undone = undoOnDelete?.();
              if (undone?.length) {
                if (window.confirm(deleteConfirmText(undone))) void onDelete();
              } else setConfirming(true);
            }}
          />
        </>
      )}
    </div>
  );
}
