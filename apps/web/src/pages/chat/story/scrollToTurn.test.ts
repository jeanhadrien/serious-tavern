import { describe, expect, it, vi } from 'vitest';
import { lastReplyOf, panelCoversThread, scrollToTurn, type ReplyElement } from './scrollToTurn.js';

const element = (executionId: string | undefined) => ({
  dataset: executionId === undefined ? {} : { executionId },
  scrollIntoView: vi.fn<ReplyElement['scrollIntoView']>(),
  animate: vi.fn(),
});

describe('lastReplyOf', () => {
  it('takes the last reply of the turn, not the first', () => {
    const [first, second, other] = [element('e1'), element('e1'), element('e2')] as const;
    expect(lastReplyOf([first, second, other], 'e1')).toBe(second);
    expect(lastReplyOf([first, second, other], 'e2')).toBe(other);
  });

  it('finds nothing for a turn with no reply in the thread', () => {
    expect(lastReplyOf([element('e1'), element(undefined)], 'e9')).toBeUndefined();
    expect(lastReplyOf([], 'e1')).toBeUndefined();
  });
});

describe('scrollToTurn', () => {
  const rootOf = (...replies: ReplyElement[]) => ({ replies: () => replies });

  it('scrolls to and flashes the last reply of the turn', () => {
    const first = element('e1');
    const last = element('e1');
    expect(scrollToTurn('e1', rootOf(first, last), false)).toBe(true);
    expect(last.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(last.animate).toHaveBeenCalledOnce();
    expect(first.scrollIntoView).not.toHaveBeenCalled();
  });

  it('jumps without the flash for a reader who asked for reduced motion', () => {
    const reply = element('e1');
    expect(scrollToTurn('e1', rootOf(reply), true)).toBe(true);
    expect(reply.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(reply.animate).not.toHaveBeenCalled();
  });

  it('answers false and scrolls nothing when the turn has no reply on screen', () => {
    const other = element('e2');
    expect(scrollToTurn('e1', rootOf(other), false)).toBe(false);
    expect(other.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('panelCoversThread', () => {
  const panel = {} as Element;

  it('is true only for a panel laid over the thread (absolutely positioned)', () => {
    expect(panelCoversThread(panel, () => 'absolute')).toBe(true);
    expect(panelCoversThread(panel, () => 'static')).toBe(false);
    expect(panelCoversThread(panel, () => 'relative')).toBe(false);
  });

  it('is false without a panel', () => {
    expect(panelCoversThread(null, () => 'absolute')).toBe(false);
  });
});
