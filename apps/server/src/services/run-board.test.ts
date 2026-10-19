import { expect, it } from 'vitest';
import { RunBoard } from './run-board.js';

it('lets a run that waits for nothing go at once', async () => {
  await new RunBoard(2).until([]);
});

it('releases a waiter only when every run it waits for has ended, whatever order they end in', async () => {
  const board = new RunBoard(3);
  const order: string[] = [];
  const waiter = board.until([0, 2]).then(() => order.push('waiter'));
  board.end(2);
  await Promise.resolve();
  order.push('after 2');
  board.end(1);
  await Promise.resolve();
  order.push('after 1');
  board.end(0);
  await waiter;
  expect(order).toEqual(['after 2', 'after 1', 'waiter']);
});

it('ignores a run that ends twice and a position that does not exist', async () => {
  const board = new RunBoard(1);
  board.end(0);
  board.end(0);
  board.end(5);
  await board.until([0]);
});
