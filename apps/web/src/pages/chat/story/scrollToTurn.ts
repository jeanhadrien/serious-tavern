const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Scrolls the thread to the first reply of a turn (found by the `data-execution-id` its messages carry) and
 * flashes it briefly. Returns whether the reply is on screen: a reply that is not in the thread (a long chat is
 * all loaded, so this means it was deleted since the view loaded) does nothing.
 */
export function scrollToTurn(executionId: string): boolean {
  const target = document.querySelector<HTMLElement>(`[data-execution-id="${CSS.escape(executionId)}"]`);
  if (!target) return false;
  const calm = reducedMotion();
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
 * closes the panel, or the reply it scrolled to would stay hidden under it.
 */
export function panelCoversThread(panel: Element | null): boolean {
  return !!panel && getComputedStyle(panel).position === 'absolute';
}
