import { useMemo } from 'react';
import { Pencil, TriangleAlert } from 'lucide-react';
import { IconButton } from '../../../components/IconButton.js';
import { useLayoutActions } from '../../../layout/LayoutActions.js';
import { openStateDefinition } from '../../stateDefinitions/stateDefinitionActions.js';
import { NodeMemory } from './NodeMemory.js';
import { PostFailures } from './PostFailures.js';
import { postFailures } from './postRuns.js';
import { StateKeyRow } from './StateKeyRow.js';
import { definitionBlocks, hasStoredState, nodeMemory, replyExecutionId } from './storyModel.js';
import type { StoryPanelData } from './useStoryState.js';
import './story.css';

/**
 * The chat panel's Story state section: what this chat's workflow nodes have stored, per state definition, read
 * from the server's computed view. `onJump` scrolls the thread to the last reply of a turn.
 */
export function StorySection({ story, onJump }: { story: StoryPanelData; onJump(executionId: string): void }) {
  const { view, failed } = story;
  const { openEditor, selectTab } = useLayoutActions();
  const blocks = useMemo(() => (view ? definitionBlocks(view) : []), [view]);
  const memory = useMemo(() => (view ? nodeMemory(view) : []), [view]);
  const failures = useMemo(() => postFailures(view), [view]);
  if (!view)
    return (
      <p className="hint" role="status">
        {failed ? 'Could not load the story state. It tries again when the chat changes.' : 'Loading story state…'}
      </p>
    );
  if (!hasStoredState(view))
    return (
      <div className="story-empty">
        <PostFailures failures={failures} />
        <p className="hint">
          Nothing has been stored in this chat yet. Story state is what workflow nodes (State Write, Draw's recent
          draws) remember between turns, and it disappears with the replies that stored it.
        </p>
        <button type="button" onClick={() => selectTab('stateDefinitions')}>
          Open state definitions
        </button>
      </div>
    );
  const jump = (turn: number) => {
    const executionId = replyExecutionId(view, turn);
    if (executionId) onJump(executionId);
  };
  const used = blocks.filter((block) => block.used);
  const unused = blocks.filter((block) => !block.used);
  return (
    <div className="story-blocks">
      {failed && <p className="hint warning">Could not refresh; this is the last state that loaded.</p>}
      <PostFailures failures={failures} />
      {used.map((block) => (
        <div key={block.id} className="story-definition">
          <div className="story-definition-head">
            <h4>{block.name}</h4>
            <IconButton
              icon={Pencil}
              label={`Edit state definition ${block.name}`}
              onClick={() => void openStateDefinition(block.id, () => openEditor('stateDefinitions'))}
            />
          </div>
          {block.warnings.map((warning) => (
            <p key={`${warning.key}:${warning.message}`} className="hint warning story-warning">
              <TriangleAlert size={14} aria-hidden="true" />
              <span>
                {warning.key}: {warning.message}
              </span>
            </p>
          ))}
          <ul className="story-keys">
            {block.keys.map((row) => (
              <StateKeyRow key={row.key} row={row} onJump={jump} />
            ))}
          </ul>
        </div>
      ))}
      {unused.length > 0 && (
        <p className="hint story-unused">Not used in this chat yet: {unused.map((block) => block.name).join(', ')}</p>
      )}
      <NodeMemory nodes={memory} onJump={jump} />
    </div>
  );
}
