import { describe, expect, it, vi } from 'vitest';
import {
  closesPanelAfter,
  lastReplyOf,
  panelCoversThread,
  scrollToItem,
  scrollToMessage,
  scrollToTurn,
  type ItemElement,
  type ReplyElement,
} from './scrollToTurn.js';

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

describe('scrollToMessage', () => {
  const message = (messageId: string) => ({
    dataset: { messageId },
    scrollIntoView: vi.fn<ReplyElement['scrollIntoView']>(),
    animate: vi.fn(),
  });
  const rootOf = (...messages: ReplyElement[]) => ({ messages: () => messages });

  it('scrolls to and flashes the message with that id, whatever its role', () => {
    const [first, second] = [message('m1'), message('m2')] as const;
    expect(scrollToMessage('m2', rootOf(first, second), false)).toBe(true);
    expect(second.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(second.animate).toHaveBeenCalledOnce();
    expect(first.scrollIntoView).not.toHaveBeenCalled();
  });

  it('jumps without the flash for a reader who asked for reduced motion', () => {
    const target = message('m1');
    expect(scrollToMessage('m1', rootOf(target), true)).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(target.animate).not.toHaveBeenCalled();
  });

  it('answers false and scrolls nothing for a message that is not in the thread', () => {
    const other = message('m1');
    expect(scrollToMessage('gone', rootOf(other), false)).toBe(false);
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

describe('scrollToItem', () => {
  const details = () => ({ tagName: 'DETAILS', open: false, parentElement: null as null | object });
  const row = (
    itemId: string,
    parent: object | null = null,
  ): ItemElement & { scrollIntoView: ReturnType<typeof vi.fn> } => ({
    dataset: { itemId },
    scrollIntoView: vi.fn<ReplyElement['scrollIntoView']>(),
    animate: vi.fn(),
    parentElement: parent as ItemElement['parentElement'],
  });
  const rootOf = (...items: ItemElement[]) => ({ items: () => items });

  it('opens every fold the row sits in, scrolls to it and flashes it', () => {
    const outer = details();
    const inner = { tagName: 'DIV', parentElement: outer };
    const folded = { ...details(), parentElement: inner };
    const target = row('i2', folded);
    expect(scrollToItem('i2', rootOf(row('i1'), target), false)).toBe(true);
    expect([outer.open, folded.open]).toEqual([true, true]);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(target.animate).toHaveBeenCalledOnce();
  });

  it('answers false and touches nothing when the row is not there (the view has not loaded, or the item is gone)', () => {
    const other = row('i1');
    expect(scrollToItem('i2', rootOf(other), false)).toBe(false);
    expect(other.scrollIntoView).not.toHaveBeenCalled();
    expect(scrollToItem('i2', rootOf(), false)).toBe(false);
  });
});

describe('closesPanelAfter', () => {
  const panel = {} as Element;
  it.each([
    ['scrolled, panel over the thread', true, 'absolute', true],
    ['scrolled, panel beside the thread', true, 'static', false],
    ['nothing to scroll to, panel over the thread', false, 'absolute', false],
  ])('%s', (_name, scrolled, position, expected) => {
    expect(closesPanelAfter(scrolled, panel, () => position)).toBe(expected);
  });

  it('never closes when there is no panel', () => {
    expect(closesPanelAfter(true, null)).toBe(false);
  });
});
