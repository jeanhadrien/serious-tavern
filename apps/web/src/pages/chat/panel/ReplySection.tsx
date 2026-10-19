import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { ReplyEntry, ReplyPlan, Workflow } from '@st/shared';
import { IconButton } from '../../../components/IconButton.js';
import { SortableList, type SortableRow } from '../../../components/sortable/SortableList.js';
import { layoutHref } from '../../../layout/url.js';
import {
  addableWorkflows,
  anyEnabled,
  planHints,
  replyRows,
  rowLabel,
  type PlanHint,
  type ReplyRow,
} from './replyList.js';
import { useReplyList, type SaveReplyList } from './useReplyList.js';

const rowId = (row: ReplyRow) => row.workflowId;

function ReplyRowView({
  row,
  hint,
  place,
  onToggle,
  onRemove,
}: {
  row: ReplyRow;
  hint?: PlanHint;
  place: SortableRow;
  onToggle(workflowId: string): void;
  onRemove(workflowId: string): void;
}) {
  const name = rowLabel(row);
  return (
    <div className={`reply-row${row.enabled ? '' : ' reply-row-off'}`}>
      {place.handle}
      <input
        type="checkbox"
        checked={row.enabled}
        aria-label={`Run ${name} on reply`}
        title={row.enabled ? 'On: runs on every reply' : 'Off: skipped'}
        onChange={() => onToggle(row.workflowId)}
      />
      <span className="reply-name">
        {row.name === undefined ? (
          name
        ) : (
          <Link to={layoutHref({ wide: 'workflows', wideId: row.workflowId })} title={`Open ${name} in the editor`}>
            {name}
          </Link>
        )}
        {hint && (
          <span className={`reply-hint${hint.problem ? ' reply-hint-problem' : ''}`} title={hint.title}>
            {hint.text}
          </span>
        )}
      </span>
      <IconButton icon={ArrowUp} label={`Move ${name} up`} disabled={!place.moveUp} onClick={place.moveUp} />
      <IconButton icon={ArrowDown} label={`Move ${name} down`} disabled={!place.moveDown} onClick={place.moveDown} />
      {row.removable && (
        <IconButton icon={X} label={`Remove ${name} from the list`} onClick={() => onRemove(row.workflowId)} />
      )}
    </div>
  );
}

/**
 * The chat panel's "On reply" section: the workflows a reply runs, top to bottom, each switched on or off, reordered
 * (drag, buttons or Alt+Up/Down) and removed (never the last). Every change saves at once and applies from the next
 * turn, so nothing here is disabled while a reply streams.
 */
export function ReplySection({
  sessionId,
  workflows,
  stored,
  plan,
  onSave,
}: {
  sessionId: string;
  workflows: readonly Workflow[];
  stored: readonly ReplyEntry[];
  /** What each saved workflow waits for (`useReplyPlan`); the hints under the rows. */
  plan?: ReplyPlan;
  onSave: SaveReplyList;
}) {
  const { list, add, remove, toggle, move } = useReplyList(sessionId, stored, onSave);
  const rows = useMemo(() => replyRows(list, workflows), [list, workflows]);
  const addable = useMemo(() => addableWorkflows(list, workflows), [list, workflows]);
  // The plan describes the saved list: while a change is still being saved the rows are in another order, so no hints.
  const hints = useMemo(
    () => (list === stored ? planHints(list, workflows, plan) : new Map<string, PlanHint>()),
    [list, stored, workflows, plan],
  );
  const renderItem = useCallback(
    (row: ReplyRow, place: SortableRow) => (
      <ReplyRowView row={row} hint={hints.get(row.workflowId)} place={place} onToggle={toggle} onRemove={remove} />
    ),
    [hints, toggle, remove],
  );
  return (
    <div className="reply-list">
      <p className="hint">
        Each reply runs these workflows with the same result as one after another, top to bottom: each sees what the
        ones above it wrote. A workflow only waits for the ones above it that write what it reads; the others run at the
        same time. Workflows below the last one that replies run after the reply is complete. Changes apply from the
        next message.
      </p>
      <SortableList
        as="ul"
        rowAs="li"
        className="reply-rows"
        items={rows}
        getId={rowId}
        label={rowLabel}
        onMove={move}
        renderItem={renderItem}
      />
      {!anyEnabled(list) && <p className="hint warning">Every workflow is off, so a message gets no reply.</p>}
      {addable.length > 0 && (
        <select aria-label="Add workflow" value="" onChange={(event) => event.target.value && add(event.target.value)}>
          <option value="">Add workflow…</option>
          {addable.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
