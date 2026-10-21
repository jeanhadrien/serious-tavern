import { useEffect, useState } from 'react';
import type { AppSettings } from '@st/shared';
import { appSettingsApi } from '../../api.js';
import './settings.css';

/** The checkbox itself: `settings` is undefined until the server has answered, and the box waits for it. */
export function ChatsSectionView({
  settings,
  saving,
  onChange,
}: {
  settings?: AppSettings;
  saving: boolean;
  onChange(forkKeepsAlternatives: boolean): void;
}) {
  return (
    <section className="chats-settings">
      <h2>Chats</h2>
      <label className="check settings-check">
        <input
          type="checkbox"
          checked={settings?.forkKeepsAlternatives ?? true}
          disabled={!settings || saving}
          onChange={(event) => onChange(event.target.checked)}
        />
        Forks keep the alternatives of the reply they start from
      </label>
      <small className="hint">
        On, a forked chat can still swipe and regenerate the reply it starts from. Off, it only holds what the chat
        shows.
      </small>
    </section>
  );
}

/** The "Chats" section of Settings: app-wide chat preferences, loaded on mount and saved on change. */
export function ChatsSection() {
  const [settings, setSettings] = useState<AppSettings>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    appSettingsApi
      .get()
      .then(setSettings)
      .catch(() => {});
  }, []);
  // One save at a time (the box is locked meanwhile), so answers cannot arrive out of order.
  const change = async (forkKeepsAlternatives: boolean) => {
    setSaving(true);
    try {
      setSettings(await appSettingsApi.update({ forkKeepsAlternatives }));
    } catch {
      // The error is toasted; show what the server holds.
      await appSettingsApi
        .get({ silent: true })
        .then(setSettings)
        .catch(() => {});
    } finally {
      setSaving(false);
    }
  };
  return <ChatsSectionView settings={settings} saving={saving} onChange={(value) => void change(value)} />;
}
