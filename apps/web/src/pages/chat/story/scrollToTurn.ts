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
  target.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  if (!calm && typeof target.animate === 'function')
    target.animate(
      [{ boxShadow: '0 0 0 2px #9fb0ff, 0 0 18px rgba(159, 176, 255, 0.55)' }, { boxShadow: '0 0 0 0 transparent' }],
      { duration: 1400, easing: 'ease-out' },
    );
  return true;
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
