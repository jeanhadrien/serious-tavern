/** The parts of a keyboard event that decide a move (a React or a DOM event fits). */
export interface MoveKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Where `Alt+ArrowUp` / `Alt+ArrowDown` send the row at `index` of `length` rows; undefined when the key is not a move. */
export function keyMove(event: MoveKeyEvent, index: number, length: number): number | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return undefined;
  const to = index + (event.key === 'ArrowUp' ? -1 : 1);
  return to >= 0 && to < length ? to : undefined;
}

const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'];

/** True for elements that use the arrow keys to edit (text boxes, selects, contenteditable): rows leave those alone. */
export function isTextField(element: { tagName: string; type?: string; isContentEditable?: boolean }): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !NON_TEXT_INPUTS.includes((element.type ?? 'text').toLowerCase());
  return element.isContentEditable === true;
}
