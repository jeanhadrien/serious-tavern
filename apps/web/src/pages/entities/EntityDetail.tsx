import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';

export function EntityDetail({
  title,
  backLabel,
  dirty,
  onBack,
  onDelete,
  onSave,
  actions,
  children,
}: {
  title: string;
  /** Names where the back arrow goes, e.g. "Back to characters". */
  backLabel: string;
  dirty: boolean;
  onBack: () => void;
  onDelete: () => Promise<void>;
  onSave: () => Promise<void>;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="entity-editor">
      <div className="entity-toolbar">
        <div className="entity-title">
          <IconButton icon={ArrowLeft} label={backLabel} onClick={onBack} />
          <h1>{title}</h1>
          {dirty && <span className="dirty-dot">Unsaved</span>}
        </div>
        <div className="toolbar">
          {actions}
          <button type="button" onClick={() => void onDelete()}>
            Delete
          </button>
          <button type="button" className="primary" onClick={() => void onSave()} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}
