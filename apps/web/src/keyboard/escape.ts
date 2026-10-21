/** What the listener knows when Escape is pressed. */
export interface EscapeSituation {
  /** `event.defaultPrevented`: a field already acted on it. */
  handled: boolean;
  /** The target is inside an open native `<dialog>`, which handles Escape itself. */
  inDialog: boolean;
  /** Open popovers and cards registered with `useEscapeLayer`. */
  layers: number;
  /** Focus is in an input, textarea, select or contenteditable. */
  inField: boolean;
}

export type EscapeStep = 'none' | 'layer' | 'leaveField' | 'area';

/** The one thing an Escape press does (docs/dev/design/FRONTEND-UX.md, Escape): the first step that applies. */
export function escapeStep({ handled, inDialog, layers, inField }: EscapeSituation): EscapeStep {
  if (handled || inDialog) return 'none';
  if (layers > 0) return 'layer';
  if (inField) return 'leaveField';
  return 'area';
}

interface FieldLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** Whether an element is something you type or choose in. */
export function isFieldElement(element: FieldLike | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}
