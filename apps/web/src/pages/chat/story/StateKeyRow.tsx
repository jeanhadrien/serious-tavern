import { memo } from 'react';
import { formatValue, fullText, shortText } from './format.js';
import { LinkedItems } from './LinkedItems.js';
import { Sparkline } from './Sparkline.js';
import type { Item, KeyRow } from './storyModel.js';
import { ThreadItemNote } from './ThreadItemNote.js';
import { exchangeCount } from './threadItems.js';

const ITEM_TEXT_MAX = 90;
const OPEN_UP_TO = 5;
const VALUE_MAX = 160;

function Items({ items }: { items: readonly Item[] }) {
  return (
    <ul className="story-items">
      {items.map((item, index) => (
        // Item ids are unique within a key; the index only guards against a hand-edited duplicate.
        <li key={`${item.id}:${index}`}>
          <span title={item.text}>{shortText(item.text, ITEM_TEXT_MAX) || '(empty)'}</span>
          {item.extras.length > 0 && (
            <small className="story-item-fields">
              {item.extras.map((extra) => ` · ${extra.name} ${extra.value}`).join('')}
            </small>
          )}
          {item.thread && <ThreadItemNote thread={item.thread} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * One key of the story state: its value, a sparkline for a number, when it was written (a link to that turn's
 * last reply, plain text when the turn has none) and, for a list, its items newest first. `older` is only set for
 * a node's memory.
 */
export const StateKeyRow = memo(function StateKeyRow({
  row,
  older = 0,
  onJump,
  onJumpMessage,
}: {
  row: KeyRow;
  /** Node memory: items the view does not list. */
  older?: number;
  onJump(turn: number): void;
  /** Scrolls the thread to a chat message by id (the first message a linked item covers). */
  onJumpMessage?(messageId: string): void;
}) {
  const list = row.kind === 'list';
  const text = list ? undefined : formatValue(row.value);
  const turn = row.writtenAtTurn;
  return (
    <li className="story-key">
      <div className="story-key-line">
        <span className="story-key-name">{row.key}</span>
        {text !== undefined && (
          <span className="story-key-value" title={fullText(row.value)}>
            {shortText(text, VALUE_MAX)}
          </span>
        )}
        {row.spark && <Sparkline name={row.key} data={row.spark} />}
      </div>
      {list && (
        <details className="story-list" open={row.items.length <= OPEN_UP_TO || undefined}>
          <summary>
            {row.exchanges
              ? exchangeCount(row.items.length)
              : row.items.length === 1
                ? '1 item'
                : `${row.items.length} items`}
          </summary>
          {row.linked && <LinkedItems groups={row.linked} onJumpMessage={onJumpMessage} />}
          {row.plain.length > 0 && <Items items={row.plain} />}
        </details>
      )}
      {/* Outside the details: the note stays visible while the list is collapsed. */}
      {list && row.dropped > 0 && (
        <small className="story-note">
          {row.dropped === 1 ? '1 older item' : `${row.dropped} older items`} dropped by the cap
        </small>
      )}
      {list && older > 0 && <small className="story-note">and {older} older</small>}
      <div className="story-key-meta">
        {!row.written ? (
          'never written'
        ) : turn === null ? (
          'written'
        ) : (
          <>
            {list ? 'last written at' : 'written at'}{' '}
            {row.jumpable ? (
              <button type="button" className="story-turn-link" onClick={() => onJump(turn)}>
                turn {turn}
              </button>
            ) : (
              `turn ${turn}`
            )}
          </>
        )}
      </div>
    </li>
  );
});
