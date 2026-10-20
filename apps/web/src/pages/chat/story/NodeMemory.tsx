import { StateKeyRow } from './StateKeyRow.js';
import type { NodeMemoryBlock } from './storyModel.js';

/**
 * What nodes remember under their own implicit keys (Draw's recent draws), collapsed: it is bookkeeping. Node ids repeat
 * across the workflows of a chat, so a block is told apart by its workflow too, and named after it when the chat lists
 * several (`workflowNames`, workflow id to name).
 */
export function NodeMemory({
  nodes,
  workflowNames,
  onJump,
}: {
  nodes: readonly NodeMemoryBlock[];
  workflowNames?: ReadonlyMap<string, string>;
  onJump(turn: number): void;
}) {
  if (!nodes.length) return null;
  return (
    <details className="story-node-memory">
      <summary>Node memory ({nodes.length})</summary>
      <p className="hint">What workflow nodes remember between turns. It goes away with the replies that stored it.</p>
      {nodes.map((node) => {
        const workflow = node.workflowId === undefined ? undefined : workflowNames?.get(node.workflowId);
        return (
          <div key={`${node.workflowId ?? ''}/${node.nodeId}`} className="story-definition">
            <h4>{workflow === undefined ? node.label : `${node.label} · ${workflow}`}</h4>
            <ul className="story-keys">
              {node.keys.map((row) => (
                <StateKeyRow key={row.key} row={row} older={row.older} onJump={onJump} />
              ))}
            </ul>
          </div>
        );
      })}
    </details>
  );
}
