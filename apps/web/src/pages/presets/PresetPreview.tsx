import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  presetInputLabel,
  presetSchema,
  presetWarnings,
  type Preset,
  type PresetWarning,
  type PromptMessage,
  type SessionSummary,
} from '@st/shared';
import { presetsApi, sessionsApi } from '../../api.js';

export function PresetPreview(props: { preset: Preset }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<PromptMessage[]>([]);
  const [serverWarnings, setServerWarnings] = useState<PresetWarning[]>([]);
  const [previewed, setPreviewed] = useState(false);
  const parsed = presetSchema.safeParse(props.preset);
  const warnings = parsed.success ? presetWarnings(parsed.data) : [];

  useEffect(() => {
    void sessionsApi
      .list()
      .then(setSessions)
      .catch(() => {});
  }, []);
  useEffect(() => {
    setPreviewed(false);
  }, [props.preset]);

  const preview = async () => {
    if (!parsed.success) return;
    try {
      const result = await presetsApi.preview({
        preset: parsed.data,
        inputs: samples,
        ...(sessionId ? { sessionId } : {}),
      });
      setMessages(result.messages);
      setServerWarnings(result.warnings);
      setPreviewed(true);
    } catch {
      /* API errors are toasted. */
    }
  };

  return (
    <section className="preset-preview">
      <div className="toolbar">
        <h3>Preview</h3>
        <button onClick={() => void preview()} disabled={!parsed.success}>
          Render
        </button>
      </div>
      <label>
        Conversation{' '}
        <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
          <option value="">Sample conversation</option>
          {sessions.map((session) => (
            <option value={session.id} key={session.id}>
              {session.title}
            </option>
          ))}
        </select>
      </label>
      {props.preset.inputs
        .filter((input) => input.dataType === 'text')
        .map((input) => (
          <label key={input.id}>
            Sample · {presetInputLabel(input.key)} ({input.key})
            <textarea
              rows={2}
              placeholder={`<${input.key}>`}
              value={samples[input.key] ?? ''}
              onChange={(event) => setSamples({ ...samples, [input.key]: event.target.value })}
            />
          </label>
        ))}
      {(previewed ? serverWarnings : warnings).length > 0 && (
        <div className="preset-warnings">
          <strong>Warnings</strong>
          {(previewed ? serverWarnings : warnings).map((warning) => (
            <p key={`${warning.path.join('.')}:${warning.message}`}>{warning.message}</p>
          ))}
        </div>
      )}
      {previewed && !messages.length && <p className="hint">No messages rendered.</p>}
      {previewed &&
        messages.map((message, index) => (
          <div className="preview-message" key={index}>
            <strong>{message.role}</strong>
            <p>{message.content}</p>
          </div>
        ))}
      <p className="hint">
        Connect inputs to an LLM node in <Link to="/workflows">Workflows</Link>.
      </p>
    </section>
  );
}
