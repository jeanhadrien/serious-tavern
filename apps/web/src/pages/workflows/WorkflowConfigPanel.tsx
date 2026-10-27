import { Trash2 } from 'lucide-react';
import { NodeConfigPanel, type NodePanelContext } from '@st/node-ui';
import type { Character, NodeInstance, Preset, WorkflowSetting } from '@st/shared';
import { providersApi } from '../../api.js';
import { IconButton } from '../../components/IconButton.js';
import { LastRun } from './LastRun.js';
import type { LastRunIO } from './lastRunIO.js';
import type { CanvasNode } from './model.js';
import { PanelLink } from './PanelLink.js';
import './modelPicker.css';

// The panel shows load errors inline, so the request must not toast. Module-level, so the panel's effect stays stable.
const loadModels: NonNullable<NodePanelContext['loadModels']> = (providerId, options) =>
  providersApi.models(providerId, options?.refresh === true, { silent: true });

export function WorkflowConfigPanel({
  current,
  presets,
  characters,
  providersList,
  collections,
  settings,
  stateDefinitions,
  snippets,
  updateConfig,
  lastRun,
  onDelete,
  onClose,
}: {
  current: CanvasNode;
  presets: Preset[];
  characters: Character[];
  providersList: NodePanelContext['providers'];
  /** Collection summaries for the Recall and Draw pickers. */
  collections?: NodePanelContext['collections'];
  /** The draft's chat settings, hinted in template fields. */
  settings?: readonly WorkflowSetting[];
  /** State definitions, for the State panels and `{{state.*}}` hints. */
  stateDefinitions?: NodePanelContext['stateDefinitions'];
  /** Stored snippets, for `{{snippets.*}}` hints and warnings. */
  snippets?: NodePanelContext['snippets'];
  updateConfig: (config: NodeInstance['config']) => void;
  /** The node in the open chat's last run of this workflow; absent while the chat has no run of it. */
  lastRun?: { io: LastRunIO | undefined; stale: boolean; nameOf: (nodeId: string) => string | undefined };
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const currentDescriptor = current.data.descriptor;
  return (
    <aside className="config-panel">
      <div className="toolbar">
        <h3>{current.data.name}</h3>
        <span className="config-panel-actions">
          <IconButton
            icon={Trash2}
            label="Delete node"
            className="delete-button"
            onClick={() => onDelete(current.id)}
          />
          <button onClick={onClose}>×</button>
        </span>
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
            collections,
            loadModels,
            settings,
            stateDefinitions,
            snippets,
            renderLink: (to, label) => <PanelLink to={to} label={label} />,
          }}
        />
      )}
      {lastRun && <LastRun {...lastRun} />}
    </aside>
  );
}
