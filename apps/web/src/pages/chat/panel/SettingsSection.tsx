import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { resolveChatSettings, settingDefault, workflowSettings, type Workflow } from '@st/shared';
import { layoutHref } from '../../../layout/url.js';
import { SettingControl } from './SettingControl.js';
import { useSettingSaver } from './useSettingSaver.js';

export type SaveSettings = (sessionId: string, patch: Record<string, unknown>) => Promise<void>;

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
  if (!declarations.length)
    return (
      <p className="hint">
        This chat's workflow declares no chat settings. Add them in the workflow editor, under Chat settings in its
        toolbar
        {workflow && (
          <>
            : <Link to={layoutHref({ wide: 'workflows', wideId: workflow.id })}>open {workflow.name}</Link>
          </>
        )}
        .
      </p>
    );
  return (
    <div className="chat-settings">
      {declarations.map((setting) => {
        const { key } = setting;
        if (!Object.hasOwn(resolved.values, key)) return null;
        const pending = Object.hasOwn(saver.pending, key);
        const value = pending ? (saver.pending[key] ?? settingDefault(setting)) : resolved.values[key];
        const isStored = pending ? saver.pending[key] !== null : !!stored && Object.hasOwn(stored, key);
        return (
          <SettingControl
            key={key}
            setting={setting}
            value={value}
            resettable={isStored}
            issue={pending ? undefined : resolved.issues.find((issue) => issue.key === key)?.message}
            onChange={(next, mode) => saver.change(key, next, mode)}
            onFlush={() => saver.flush(key)}
            onReset={() => saver.reset(key)}
          />
        );
      })}
    </div>
  );
}
