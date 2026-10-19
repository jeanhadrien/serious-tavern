import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from './IconButton.js';
import './editor-header.css';

/** One button of the header. `label` overrides the default text (e.g. "Duplicate…" when it asks a name). */
interface HeaderAction {
  onClick(): void;
  disabled?: boolean;
  title?: string;
  label?: string;
}

export interface HeaderActions {
  save?: HeaderAction;
  /** Shown only while the draft is dirty. */
  revert?: HeaderAction;
  duplicate?: HeaderAction;
  remove?: HeaderAction;
}

/**
 * The top of every editor: back (narrow editors), the item's name, the "Unsaved changes" marker and the
 * actions in one fixed order: `extra`, Save, Revert, Duplicate, Delete. An action left out isn't rendered.
 * A string `title` becomes the heading; wide editors pass their name input instead. `note` (a read-only
 * banner) renders right below.
 */
export function EditorHeader(props: {
  title: ReactNode;
  back?: { label: string; onClick(): void };
  dirty: boolean;
  note?: ReactNode;
  extra?: ReactNode;
  actions: HeaderActions;
  className?: string;
}) {
  const { actions } = props;
  const classes = ['editor-header', props.back ? 'editor-header-stacked' : '', props.className ?? ''];
  return (
    <>
      <div className={classes.filter(Boolean).join(' ')}>
        <div className="editor-header-title">
          {props.back && <IconButton icon={ArrowLeft} label={props.back.label} onClick={props.back.onClick} />}
          {typeof props.title === 'string' ? <h1>{props.title}</h1> : props.title}
          {props.dirty && <span className="dirty-dot">Unsaved changes</span>}
        </div>
        <div className="toolbar editor-header-actions">
          {props.extra}
          {actions.save && <HeaderButton action={actions.save} label="Save" primary />}
          {props.dirty && actions.revert && <HeaderButton action={actions.revert} label="Revert" />}
          {actions.duplicate && <HeaderButton action={actions.duplicate} label="Duplicate" />}
          {actions.remove && <HeaderButton action={actions.remove} label="Delete" />}
        </div>
      </div>
      {props.note}
    </>
  );
}

function HeaderButton({ action, label, primary }: { action: HeaderAction; label: string; primary?: boolean }) {
  return (
    <button
      type="button"
      className={primary ? 'primary' : undefined}
      disabled={action.disabled}
      title={action.title}
      onClick={action.onClick}
    >
      {action.label ?? label}
    </button>
  );
}
