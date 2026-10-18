/** What the jump needs of a message element. */
export interface ReplyElement {
  dataset: DOMStringMap;
  scrollIntoView(options: ScrollIntoViewOptions): void;
  animate?(keyframes: Keyframe[], options: KeyframeAnimationOptions): unknown;
}

/** Where to look for replies: the assistant messages of the thread. */
export interface ReplyRoot {
  replies(): Iterable<ReplyElement>;
}

/** An element of the Story state section that carries `data-item-id`, and what it sits in (to open the folds). */
export interface ItemElement extends ReplyElement {
  parentElement?: ItemParent | null;
}
interface ItemParent {
  tagName?: string;
  open?: boolean;
  parentElement?: ItemParent | null;
}

/** Where to look for a state item's row: every row of the panel that has a `data-item-id`. */
export interface ItemRoot {
  items(): Iterable<ItemElement>;
}

/** Where to look for a message by id: every message of the thread, either role. */
export interface MessageRoot {
  messages(): Iterable<ReplyElement>;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const documentReplies: ReplyRoot = {
  replies: () => document.querySelectorAll<HTMLElement>('.message.assistant'),
};

/**
 * The last of `replies` that belongs to a turn (they carry the `data-execution-id` of the run that wrote them). The
 * turn's user message has the id too, but it is not a reply and is never looked at here; the last reply is
 * where the turn ends, so a long turn lands on what it finished with.
 */
export function lastReplyOf<T extends { dataset: DOMStringMap }>(
  replies: Iterable<T>,
  executionId: string,
): T | undefined {
  let found: T | undefined;
  for (const reply of replies) if (reply.dataset.executionId === executionId) found = reply;
  return found;
}

/**
 * Scrolls the thread to the last reply of a turn and flashes it briefly. Returns whether that reply is on screen:
 * a reply that is not in the thread (a long chat is all loaded, so this means it was deleted since the view
 * loaded) does nothing. `root` and `calm` (reduced motion) are only parameters so tests can pass fakes.
 */
export function scrollToTurn(executionId: string, root: ReplyRoot = documentReplies, calm = reducedMotion()): boolean {
  const target = lastReplyOf(root.replies(), executionId);
  if (!target) return false;
  reveal(target, calm);
  return true;
}

const documentMessages: MessageRoot = {
  messages: () => document.querySelectorAll<HTMLElement>('.message[data-message-id]'),
};

/**
 * Scrolls the thread to a message (either role, found by its `data-message-id`) and flashes it, like
 * `scrollToTurn`. Returns whether it is on screen: a message deleted since the view loaded does nothing.
 */
export function scrollToMessage(
  messageId: string,
  root: MessageRoot = documentMessages,
  calm = reducedMotion(),
): boolean {
  for (const candidate of root.messages()) {
    if (candidate.dataset.messageId !== messageId) continue;
    reveal(candidate, calm);
    return true;
  }
  return false;
}

const documentItems: ItemRoot = {
  items: () => document.querySelectorAll<HTMLElement>('[data-item-id]'),
};

/**
 * Scrolls the chat panel to the row of a state item (found by `data-item-id`), opens the folds it sits in (the key's
 * list, "Replaced or repeated") and flashes it. Returns whether the row exists: the view may not have loaded yet, or
 * the item may be gone.
 */
export function scrollToItem(itemId: string, root: ItemRoot = documentItems, calm = reducedMotion()): boolean {
  for (const candidate of root.items()) {
    if (candidate.dataset.itemId !== itemId) continue;
    for (let parent = candidate.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName?.toUpperCase() === 'DETAILS') parent.open = true;
    reveal(candidate, calm);
    return true;
  }
  return false;
}

function reveal(target: ReplyElement, calm: boolean): void {
  target.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  if (!calm && typeof target.animate === 'function')
    target.animate(
      [{ boxShadow: '0 0 0 2px #9fb0ff, 0 0 18px rgba(159, 176, 255, 0.55)' }, { boxShadow: '0 0 0 0 transparent' }],
      { duration: 1400, easing: 'ease-out' },
    );
}

/**
 * Whether a jump from the chat panel closes it: only when it did scroll to something and the panel covers the thread
 * (see `panelCoversThread`); next to the thread it stays open.
 */
export function closesPanelAfter(
  scrolled: boolean,
  panel: Element | null,
  positionOf?: (element: Element) => string,
): boolean {
  return scrolled && panelCoversThread(panel, positionOf);
}

/**
 * Whether the chat panel covers the thread (a chat column narrower than 760px, see chatPanel.css): then a jump
 * closes the panel, or the reply it scrolled to would stay hidden under it. `positionOf` is the computed
 * `position` of the element.
 */
export function panelCoversThread(
  panel: Element | null,
  positionOf: (element: Element) => string = (element) => getComputedStyle(element).position,
): boolean {
  return !!panel && positionOf(panel) === 'absolute';
}
