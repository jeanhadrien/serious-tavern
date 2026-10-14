import { Link } from 'react-router-dom';
import { NodeConfigPanel, type NodePanelContext } from '@st/node-ui';
import type { Character, NodeInstance, Preset } from '@st/shared';
import { providersApi } from '../../api.js';
import type { CanvasNode } from './model.js';
import './modelPicker.css';

// The panel shows load errors inline, so the request must not toast. Module-level, so the panel's effect stays stable.
const loadModels: NonNullable<NodePanelContext['loadModels']> = (providerId, options) =>
  providersApi.models(providerId, options?.refresh === true, { silent: true });

export function WorkflowConfigPanel({
  current,
  presets,
  characters,
  providersList,
  updateConfig,
  onClose,
}: {
  current: CanvasNode;
  presets: Preset[];
  characters: Character[];
  providersList: NodePanelContext['providers'];
  updateConfig: (config: NodeInstance['config']) => void;
  onClose: () => void;
}) {
  const currentDescriptor = current.data.descriptor;
  return (
    <aside className="config-panel">
      <div className="toolbar">
        <h3>{current.data.name}</h3>
        <button onClick={onClose}>×</button>
      </div>
      <p className="hint">{currentDescriptor.description}</p>
      {current.data.unknown ? (
        <pre className="unknown-config">{JSON.stringify(current.data.config, null, 2)}</pre>
      ) : (
        <NodeConfigPanel
          descriptor={currentDescriptor}
          config={current.data.config}
          onChange={updateConfig}
          context={{
            presets,
            characters,
            providers: providersList,
            loadModels,
            renderLink: (to, label) => <Link to={to}>{label}</Link>,
          }}
        />
      )}
    </aside>
  );
}
