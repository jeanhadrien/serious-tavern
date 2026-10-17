import { StateKeyRow } from './StateKeyRow.js';
import type { NodeMemoryBlock } from './storyModel.js';

/** What nodes remember under their own implicit keys (Draw's recent draws), collapsed: it is bookkeeping. */
export function NodeMemory({ nodes, onJump }: { nodes: readonly NodeMemoryBlock[]; onJump(turn: number): void }) {
  if (!nodes.length) return null;
  return (
    <details className="story-node-memory">
      <summary>Node memory ({nodes.length})</summary>
      <p className="hint">What workflow nodes remember between turns. It goes away with the replies that stored it.</p>
      {nodes.map((node) => (
        <div key={node.nodeId} className="story-definition">
          <h4>{node.label}</h4>
          <ul className="story-keys">
            {node.keys.map((row) => (
              <StateKeyRow key={row.key} row={row} older={row.older} onJump={onJump} />
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}
