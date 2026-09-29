export function WorkflowToolbar({
  name,
  onNameChange,
  onValidate,
  onSave,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onValidate: () => void;
  onSave: () => void;
}) {
  return (
    <div className="editor-toolbar">
      <input aria-label="Workflow name" value={name} onChange={(e) => onNameChange(e.target.value)} />
      <button onClick={onValidate}>Validate</button>
      <button className="primary" onClick={onSave}>
        Save
      </button>
    </div>
  );
}
