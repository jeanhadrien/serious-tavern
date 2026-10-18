import { useMemo } from 'react';
import { CircleCheck, CircleSlash } from 'lucide-react';
import { MessageContent } from '../MessageContent.js';
import { formatCreated, viewSummaryBlocks, type SummaryRow } from './summariesModel.js';
import type { StoryPanelData } from './useStoryState.js';
import './summaries.css';

function SummaryItem({ row, onJump }: { row: SummaryRow; onJump(messageId: string): void }) {
  const { jumpTo } = row;
  return (
    <li className={`summary-row${row.valid ? '' : ' invalid'}`}>
      <div className="summary-head">
        {jumpTo ? (
          <button
            type="button"
            className="summary-chunk story-turn-link"
            title="Scroll to the first covered message"
            onClick={() => onJump(jumpTo)}
          >
            {row.label}
          </button>
        ) : (
          <span className="summary-chunk">{row.label}</span>
        )}
        <span className={`summary-badge ${row.valid ? 'valid' : 'stale'}`}>
          {row.valid ? <CircleCheck size={12} aria-hidden="true" /> : <CircleSlash size={12} aria-hidden="true" />}
          {row.valid ? 'valid' : 'invalid'}
        </span>
      </div>
      {row.explanation && <p className="hint warning summary-why">{row.explanation}</p>}
      <details className="summary-text">
        <summary>Summary text</summary>
        <MessageContent content={row.text} />
        <small>
          Written <time dateTime={row.createdAt}>{formatCreated(row.createdAt)}</time>
        </small>
      </details>
    </li>
  );
}

/**
 * The chat panel's Summaries section: the history summaries the chat's workflows saved, per set, from the same
 * state view as Story state (no fetch of its own). `onJump` scrolls the thread to a message by id.
 */
export function SummariesSection({ story, onJump }: { story: StoryPanelData; onJump(messageId: string): void }) {
  const { view, failed } = story;
  const blocks = useMemo(() => (view ? viewSummaryBlocks(view) : []), [view]);
  if (!view)
    return (
      <p className="hint" role="status">
        {failed ? 'Could not load the summaries. It tries again when the chat changes.' : 'Loading summaries…'}
      </p>
    );
  if (blocks.length === 0)
    return (
      <p className="hint summaries-empty">
        No summaries yet. Older history can be summarized in chunks: a post-turn run (After Reply, Next Chunk, an LLM,
        Save Summary) writes them, and a Memory node with a summary set uses them in place of the older messages.
      </p>
    );
  return (
    <div className="summaries">
      {blocks.map((block) => (
        <div key={block.set} className="summary-set">
          <h4>{block.set}</h4>
          <ul className="summary-list">
            {block.rows.map((row) => (
              <SummaryItem key={row.id} row={row} onJump={onJump} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
