import type { ReactNode } from 'react';

/** The answer when the user dismisses a dialog: its Cancel button, Escape or a click on the backdrop. */
export const CANCEL = 'cancel';

interface DialogAction<A extends string = string> {
  id: A;
  label: string;
  /** `danger` for destructive actions (delete, discard), `primary` for the expected one. */
  kind?: 'primary' | 'danger';
}

export interface DialogOptions<A extends string> {
  title: string;
  /** Text or structure (e.g. a list of what a delete undoes). */
  body?: ReactNode;
  /** Shown after Cancel, in this order. Cancel is always offered and holds the focus first. */
  actions: readonly DialogAction<Exclude<A, typeof CANCEL>>[];
  cancelLabel?: string;
}

export interface DialogRequest extends DialogOptions<string> {
  id: number;
}

/**
 * Modal questions (see docs/FRONTEND-UX.md, Confirmations). `ask` works outside React too, like `alerts`; the one
 * `<DialogHost/>` shows the oldest pending request, so questions asked together are answered one at a time.
 */
export class DialogStore {
  private queue: { request: DialogRequest; resolve: (action: string) => void }[] = [];
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): DialogRequest | undefined => this.queue[0]?.request;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of [...this.listeners]) listener();
  }

  /** Resolves with the id of the chosen action, or `CANCEL`. */
  ask<A extends string>(options: DialogOptions<A>): Promise<A | typeof CANCEL> {
    return new Promise((resolve) => {
      this.queue.push({ request: { ...options, id: ++this.seq }, resolve: resolve as (action: string) => void });
      if (this.queue.length === 1) this.notify();
    });
  }

  /** The host's answer to the shown request. Answers to anything else, or naming no offered action, are ignored. */
  answer = (id: number, action: string) => {
    const head = this.queue[0];
    if (!head || head.request.id !== id) return;
    if (action !== CANCEL && !head.request.actions.some((offered) => offered.id === action)) return;
    this.queue.shift();
    head.resolve(action);
    this.notify();
  };
}

export const dialogs = new DialogStore();

/** Asks before deleting something stored. Resolves true when the user chose Delete. */
export async function confirmDelete(title: string, body: ReactNode = "This can't be undone."): Promise<boolean> {
  const answer = await dialogs.ask({ title, body, actions: [{ id: 'delete', label: 'Delete', kind: 'danger' }] });
  return answer === 'delete';
}
