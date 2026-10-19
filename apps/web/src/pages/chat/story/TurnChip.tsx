import { useEffect, useId, useRef, useState } from 'react';
import { Database, ListChecks, TriangleAlert } from 'lucide-react';
import { useEscapeLayer } from '../../../keyboard/escapeRegistry.js';
import { IconButton } from '../../../components/IconButton.js';
import { ExecutionDetails } from '../ExecutionDetails.js';
import {
  POST_DETAILS_LABEL,
  POST_NOTHING_STORED,
  POST_STOPPED_NOTE,
  RUNS_HEADING,
  RUN_UNKNOWN_WORKFLOW,
  chipLabel,
  postFailureNote,
  runPartLabel,
} from './postRunText.js';
import type { RunNote, StoryChip } from './turnChips.js';

/** One run of a turn of several: which workflow, which part, how it ended, and its log (fetched when opened). */
function RunItem({ run }: { run: RunNote }) {
  const name = run.workflowName ?? RUN_UNKNOWN_WORKFLOW;
  return (
    <li className="turn-run">
      <span className={`turn-run-head turn-run-${run.status}`}>
        <strong>{name}</strong> · {runPartLabel(run.part)} · {run.status}
      </span>
      {run.error && <p className="error">{run.error}</p>}
      {run.status !== 'running' && (
        <ExecutionDetails id={run.executionId} label={`${name}, ${runPartLabel(run.part)} run details`} optional />
      )}
    </li>
  );
}

/**
 * The card under the chip: the turn's writes in plain words, the note for a reply edited afterwards, and how its
 * after-reply run ended when that was badly, with the run's log (fetched when the card opens).
 */
export function TurnChipCard({ chip, id }: { chip: StoryChip; id?: string }) {
  const { post } = chip;
  return (
    <div className="message-story-card" id={id}>
      {chip.lines.length ? (
        <>
          <strong>Turn {chip.turnNumber} stored:</strong>
          <ul>
            {chip.lines.map((line, index) => (
              // A turn can write the same words twice (two Draw nodes): the position keeps keys unique.
              <li key={index}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <strong>Turn {chip.turnNumber}</strong>
      )}
      {chip.warnings?.map((warning) => (
        <p key={warning} className="hint warning">
          {warning}
        </p>
      ))}
      {chip.editedAfter && chip.lines.length > 0 && (
        <p className="hint">Edited after it was stored: the values above came from the original text.</p>
      )}
      {chip.runs && (
        <>
          <strong className="turn-runs-heading">{RUNS_HEADING}</strong>
          <ol className="turn-runs">
            {chip.runs.map((run) => (
              <RunItem key={run.executionId} run={run} />
            ))}
          </ol>
        </>
      )}
      {post?.status === 'error' && !chip.runs && <p className="error">{postFailureNote(post.message)}</p>}
      {post?.status === 'stopped' && <p className="hint">{POST_STOPPED_NOTE}</p>}
      {post?.status === 'completed' && !chip.lines.length && <p className="hint">{POST_NOTHING_STORED}</p>}
      {/* A turn of several runs lists every log above; a single run's log is reached from here. */}
      {post?.executionId && !chip.runs && (
        <ExecutionDetails id={post.executionId} label={POST_DETAILS_LABEL} optional />
      )}
    </div>
  );
}

/**
 * "What this turn stored": a small button on the last reply of a turn that wrote story state or whose after-reply
 * run failed or that lost a linked item (the icon then warns). It discloses an inline
 * card under the button (not a floating layer: the thread scrolls, and an inline card needs no placement on a
 * phone); Escape or a second click closes it.
 */
export function TurnChip({ chip }: { chip: StoryChip }) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // A failed after-reply run or an item that was dropped: the icon warns.
  const alert =
    chip.post?.status === 'error' || !!chip.warnings?.length || !!chip.runs?.some((run) => run.status === 'error');
  useEffect(() => {
    if (!open) return;
    // The card grows the message: keep it on screen when the reply sits at the bottom of the thread.
    wrapper.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  // Escape closes the card and gives focus back to the button that opened it.
  useEscapeLayer(open, () => {
    setOpen(false);
    opener.current?.focus();
  });
  return (
    <div className="message-story" ref={wrapper}>
      <IconButton
        ref={opener}
        icon={alert ? TriangleAlert : chip.lines.length ? Database : ListChecks}
        label={chipLabel(chip.lines.length > 0, !!chip.warnings?.length, !!chip.runs)}
        className={alert ? 'chip-alert' : ''}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && <TurnChipCard chip={chip} id={cardId} />}
    </div>
  );
}
