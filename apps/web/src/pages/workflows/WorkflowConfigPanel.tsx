import { Link } from 'react-router-dom';
import { NodeConfigPanel, type NodePanelContext } from '@st/node-ui';
import type { Character, NodeInstance, Preset } from '@st/shared';
import type { CanvasNode } from './model.js';

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
            renderLink: (to, label) => <Link to={to}>{label}</Link>,
          }}
        />
      )}
    </aside>
  );
}
