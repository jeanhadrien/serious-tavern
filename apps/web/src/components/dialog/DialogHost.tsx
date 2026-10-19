import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { CANCEL, dialogs, type DialogRequest, type DialogStore } from './dialogStore.js';
import './dialog.css';

/**
 * Shows the dialog store's current request in a native modal `<dialog>`: it traps focus, Escape cancels, and focus
 * starts on Cancel (the safe action) and returns to where it was once the last question is answered.
 */
export function DialogHost({ store = dialogs }: { store?: DialogStore }) {
  const request = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (request) {
      if (!element.open) {
        opener.current = document.activeElement;
        element.showModal();
      }
      cancel.current?.focus();
    } else if (element.open) {
      element.close();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      opener.current = null;
    }
  }, [request]);

  const answer = (action: string) => request && store.answer(request.id, action);
  return (
    // A click on the backdrop lands on the dialog itself and cancels, like Escape.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click's keyboard twin is Escape, built into the dialog
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        // The store closes the dialog once the answer is in; closing here would skip the next queued question.
        event.preventDefault();
        answer(CANCEL);
      }}
      onClick={(event) => event.target === event.currentTarget && answer(CANCEL)}
    >
      {request && <DialogContent key={request.id} request={request} cancel={cancel} onAnswer={answer} />}
    </dialog>
  );
}

function DialogContent({
  request,
  cancel,
  onAnswer,
}: {
  request: DialogRequest;
  cancel: RefObject<HTMLButtonElement | null>;
  onAnswer(action: string): void;
}) {
  return (
    <div className="confirm-dialog-panel">
      <h2 id="confirm-dialog-title">{request.title}</h2>
      {request.body !== undefined && (
        <div className="confirm-dialog-body">
          {typeof request.body === 'string' ? <p>{request.body}</p> : request.body}
        </div>
      )}
      <div className="confirm-dialog-actions">
        <button ref={cancel} type="button" onClick={() => onAnswer(CANCEL)}>
          {request.cancelLabel ?? 'Cancel'}
        </button>
        {request.actions.map((action) => (
          <button key={action.id} type="button" className={action.kind} onClick={() => onAnswer(action.id)}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
