import { CircleCheck, CircleSlash } from 'lucide-react';
import { plainPreview, type ItemLinkView } from '@st/shared';
import { MessageContent } from '../MessageContent.js';
import { shortText } from './format.js';
import {
  BROKEN_EXPLANATION,
  GONE_EXPLANATION,
  REPLACED_EXPLANATION,
  STATUS_LABELS,
  linkLabel,
  type LinkGroups,
} from './linkedGroups.js';
import type { LinkedItem } from './storyModel.js';
import './linked.css';

const PREVIEW_MAX = 80;

const explanation = ({ status, replaced }: ItemLinkView) =>
  replaced ? REPLACED_EXPLANATION : status === 'gone' ? GONE_EXPLANATION : BROKEN_EXPLANATION;

function LinkedRow({ item, onJumpMessage }: { item: LinkedItem; onJumpMessage?(messageId: string): void }) {
  const { link } = item;
  const intact = link.status === 'intact';
  const label = linkLabel(link);
  const jumpTo = link.firstMessageId;
  return (
    <li className={`linked-item${intact ? '' : ' broken'}`} data-item-id={item.id}>
      <div className="linked-head">
        {jumpTo && onJumpMessage ? (
          <button
            type="button"
            className="linked-range story-turn-link"
            title="Scroll to the first linked message"
            onClick={() => onJumpMessage(jumpTo)}
          >
            {label}
          </button>
        ) : (
          <span className="linked-range">{label}</span>
        )}
        <span className={`linked-badge ${intact ? 'intact' : 'stale'}`}>
          {intact ? <CircleCheck size={12} aria-hidden="true" /> : <CircleSlash size={12} aria-hidden="true" />}
          {STATUS_LABELS[link.status]}
        </span>
      </div>
      {!intact && <p className="hint warning linked-why">{explanation(link)}</p>}
      <details className="linked-text">
        <summary>{shortText(plainPreview(item.text), PREVIEW_MAX) || '(empty)'}</summary>
        <MessageContent content={item.text} />
        {item.extras.length > 0 && (
          <small className="story-item-fields">
            {item.extras.map((extra) => `${extra.name} ${extra.value}`).join(' · ')}
          </small>
        )}
      </details>
    </li>
  );
}

/**
 * The items of a collection key that link to chat messages: the ones in use in chat order, then the broken ones
 * waiting to be redone, and the ones that no longer count (replaced, or a copy of an earlier item) collapsed. The
 * text is markdown, rendered like a reply (`skipHtml`).
 */
export function LinkedItems({
  groups,
  onJumpMessage,
}: {
  groups: LinkGroups<LinkedItem>;
  onJumpMessage?(messageId: string): void;
}) {
  const { used, broken, hidden } = groups;
  return (
    <div className="linked-items">
      {(used.length > 0 || broken.length > 0) && (
        <ul className="linked-list">
          {[...used, ...broken].map((item) => (
            <LinkedRow key={item.id} item={item} onJumpMessage={onJumpMessage} />
          ))}
        </ul>
      )}
      {hidden.length > 0 && (
        <details className="linked-hidden">
          <summary title="Broken items an intact item replaced, and intact copies of an earlier item">
            Replaced or repeated ({hidden.length})
          </summary>
          <ul className="linked-list">
            {hidden.map((item) => (
              <LinkedRow key={item.id} item={item} onJumpMessage={onJumpMessage} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
