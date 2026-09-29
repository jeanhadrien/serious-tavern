import type { ReactNode } from 'react';

export function EntityDetail({
  title,
  dirty,
  onDelete,
  onSave,
  actions,
  children,
}: {
  title: string;
  dirty: boolean;
  onDelete: () => Promise<void>;
  onSave: () => Promise<void>;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="entity-editor">
      <div className="entity-toolbar">
        <div>
          <h1>{title}</h1>
          {dirty && <span className="dirty-dot">Unsaved</span>}
        </div>
        <div className="toolbar">
          {actions}
          <button onClick={() => void onDelete()}>Delete</button>
          <button className="primary" onClick={() => void onSave()} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}
