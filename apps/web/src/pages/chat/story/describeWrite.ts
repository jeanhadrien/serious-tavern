import type { SessionStateView } from '@st/shared';
import { formatValue, quote } from './format.js';

export type TurnWrite = SessionStateView['turns'][number]['writes'][number];

const TEXT_MAX = 60;
// Bookkeeping of an item, not something the user declared.
const BOOKKEEPING = new Set(['id', 'text', 'entryKey']);
// Draw's implicit node key (see "Implicit node state" in the README).
const DRAW_KEY = 'draws';

/** Every item text the view shows, by item id, so a removal can say what it removed. */
export function itemTexts(view: SessionStateView): Map<string, string> {
  const texts = new Map<string, string>();
  for (const turn of view.turns)
    for (const { write } of turn.writes) if (write.op === 'add') texts.set(write.item.id, write.item.text);
  return texts;
}

const valueText = (value: unknown) => (typeof value === 'string' ? quote(value, TEXT_MAX) : formatValue(value));

function extras(item: Record<string, unknown>): string {
  const fields = Object.entries(item)
    .filter(([name]) => !BOOKKEEPING.has(name))
    .map(([name, value]) => `${name} ${formatValue(value)}`);
  return fields.length ? ` (${fields.join(', ')})` : '';
}

/**
 * One stored write in plain words, as the "What this turn stored" card lists it:
 * `scene.tension → 6`, `scene.injected + 'a bell' (level 2)`, `scene.injected: removed 'a bell'`,
 * `scene.tension reset to its default`, `Draw #1 (draw): drew 'resin smell'`. Long text is cut (the view already
 * cut very long values, see `truncated`).
 */
export function describeWrite({ write, definitionName, nodeLabel }: TurnWrite, itemText: ReadonlyMap<string, string>) {
  const { target } = write;
  if (target.kind === 'node') {
    const who = nodeLabel ?? 'A removed node';
    switch (write.op) {
      case 'add':
        return target.key === DRAW_KEY
          ? `${who}: drew ${quote(write.item.text, TEXT_MAX)}`
          : `${who}: remembered ${quote(write.item.text, TEXT_MAX)} (${target.key})`;
      case 'set':
        return `${who}: ${target.key} → ${valueText(write.value)}`;
      case 'remove':
        return `${who}: forgot ${itemText.has(write.itemId) ? quote(itemText.get(write.itemId) ?? '', TEXT_MAX) : 'an item'} (${target.key})`;
      case 'delete':
        return `${who}: ${target.key} cleared`;
    }
  }
  const subject = `${definitionName ?? '(deleted definition)'}.${target.key}`;
  switch (write.op) {
    case 'set':
      return `${subject} → ${valueText(write.value)}`;
    case 'delete':
      return `${subject} reset to its default`;
    case 'add':
      return `${subject} + ${quote(write.item.text, TEXT_MAX)}${extras(write.item)}`;
    case 'remove': {
      const text = itemText.get(write.itemId);
      return `${subject}: removed ${text === undefined ? 'an item' : quote(text, TEXT_MAX)}`;
    }
  }
}
