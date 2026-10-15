import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  resolveChatSettings,
  usableSettings,
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
 * The chat's settings: one control per setting its workflow declares, showing the stored value or the
 * default. A stored value the workflow no longer accepts is shown as the default with the resolver's issue.
 */
export function SettingsSection({
  workflow,
  stored,
  sessionId,
  onSave,
}: {
  workflow?: Workflow;
  stored?: Record<string, unknown>;
  sessionId: string;
  onSave: SaveSettings;
}) {
  const declarations = useMemo(() => workflowSettings(workflow ?? {}), [workflow]);
  const resolved = useMemo(() => resolveChatSettings(declarations, stored), [declarations, stored]);
  const saver = useSettingSaver(sessionId, onSave);
  const usable = useMemo(() => usableSettings(declarations), [declarations]);
  // Declaration problems make every turn fail as WORKFLOW_INVALID, so the panel says where to fix them.
  const broken = useMemo(() => workflowSettingIssues(workflow?.settings).length > 0, [workflow]);
  const editorLink = workflow && (
    <>
      : <Link to={layoutHref({ wide: 'workflows', wideId: workflow.id })}>open {workflow.name}</Link>
    </>
  );
  const problemsHint = broken && (
    <p className="hint">
      This workflow's chat settings have problems; fix them in the workflow editor, under Chat settings in its toolbar
      {editorLink}.
    </p>
  );
  if (!usable.length)
    return (
      problemsHint || (
        <p className="hint">
          This chat's workflow declares no chat settings. Add them in the workflow editor, under Chat settings in its
          toolbar{editorLink}.
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
