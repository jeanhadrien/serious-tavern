import { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';

interface MessageActionsProps {
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
}

export function MessageActions({ disabled, onEdit, onDelete }: MessageActionsProps) {
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
          <IconButton icon={Trash2} label="Delete message" disabled={disabled} onClick={() => setConfirming(true)} />
        </>
      )}
    </div>
  );
}
