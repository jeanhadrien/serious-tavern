import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  listedSettings,
  resolveChatSettings,
  workflowSettingIssues,
  workflowSettings,
  type Workflow,
} from '@st/shared';
import { layoutHref } from '../../../layout/url.js';
import { SettingControl } from './SettingControl.js';
import { displayedSetting } from './settingControls.js';
import { useSettingSaver, type SaveOptions } from './useSettingSaver.js';

export type SaveSettings = (sessionId: string, patch: Record<string, unknown>, options?: SaveOptions) => Promise<void>;

/**
 * The chat's settings: one control per setting the listed workflows declare together (`listedSettings`, the rule the
 * server checks values against: a key several declare is one setting, the first declaration wins), showing the stored
 * value or the default. A stored value no workflow accepts is shown as the default with the resolver's issue.
 */
export function SettingsSection({
  workflows,
  stored,
  sessionId,
  onSave,
}: {
  /** The workflows of the chat's reply list that exist, in list order (`listedWorkflows`). */
  workflows: readonly Workflow[];
  stored?: Record<string, unknown>;
  sessionId: string;
  onSave: SaveSettings;
}) {
  const declarations = useMemo(() => workflows.flatMap(workflowSettings), [workflows]);
  const resolved = useMemo(() => resolveChatSettings(declarations, stored), [declarations, stored]);
  const saver = useSettingSaver(sessionId, onSave);
  const usable = useMemo(() => listedSettings(workflows), [workflows]);
  // Declaration problems make every turn of that workflow fail as WORKFLOW_INVALID, so the panel says where to fix them.
  const broken = useMemo(
    () => workflows.filter((workflow) => workflowSettingIssues(workflow.settings).length > 0),
    [workflows],
  );
  const several = workflows.length > 1;
  const link = (workflow: Workflow) => (
    <Link key={workflow.id} to={layoutHref({ wide: 'workflows', wideId: workflow.id })}>
      open {workflow.name}
    </Link>
  );
  // With one workflow the link follows the sentence; with several, only the broken ones are named.
  const editorLinks = (list: readonly Workflow[]) =>
    list.length > 0 && <>: {list.flatMap((workflow, i) => (i ? [', ', link(workflow)] : [link(workflow)]))}</>;
  const problemsHint = broken.length > 0 && (
    <p className="hint">
      {several ? "Chat settings of some of this chat's workflows have" : "This workflow's chat settings have"} problems;
      fix them in the workflow editor, under Chat settings in its toolbar
      {editorLinks(broken)}.
    </p>
  );
  if (!usable.length)
    return (
      problemsHint || (
        <p className="hint">
          {several
            ? 'No workflow of this chat declares chat settings.'
            : "This chat's workflow declares no chat settings."}{' '}
          Add them in the workflow editor, under Chat settings in its toolbar
          {!several && editorLinks(workflows)}.
        </p>
      )
    );
  return (
    <div className="chat-settings">
      {problemsHint}
      {/* One control per usable key, the first declaration of each, like the resolver and the server. */}
      {usable.map((setting) => {
        const { key } = setting;
        return (
          <SettingControl
            key={key}
            setting={setting}
            {...displayedSetting(setting, resolved, stored, saver.pending)}
            onChange={(next, mode) => saver.change(key, next, mode)}
            onFlush={() => saver.flush(key)}
            onReset={() => saver.reset(key)}
            onCancel={() => saver.cancel(key)}
          />
        );
      })}
    </div>
  );
}
