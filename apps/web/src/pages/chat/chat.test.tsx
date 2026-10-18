import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { composerShouldSend, editorKeyAction } from './keyboard.js';
import { isNearBottom, shouldStickToBottom } from './useStickToBottom.js';
import { MessageContent } from './MessageContent.js';
import { ChatMessageView } from './ChatMessageView.js';
import { Composer } from './Composer.js';
import { MessageEditor } from './MessageEditor.js';
import { MessageList } from './MessageList.js';
import { ExecutionDetails } from './ExecutionDetails.js';
import { MessageActions } from './MessageActions.js';

const key = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false };
it.each([
  [key, true],
  [{ ...key, shiftKey: true }, false],
  [{ ...key, isComposing: true }, false],
  [{ ...key, keyCode: 229 }, false],
  [{ ...key, key: 'a' }, false],
])('handles composer keyboard input %j', (event, expected) => {
  expect(composerShouldSend(event)).toBe(expected);
});

it.each([
  [key, false],
  [{ ...key, shiftKey: true }, false],
  [{ ...key, ctrlKey: true }, true],
  [{ ...key, metaKey: true }, true],
  [{ ...key, ctrlKey: true, isComposing: true }, false],
])('adds a line on Enter from a touch keyboard %j', (event, expected) => {
  expect(composerShouldSend(event, true)).toBe(expected);
});

it.each([
  [key, undefined],
  [{ ...key, ctrlKey: true }, 'save'],
  [{ ...key, metaKey: true }, 'save'],
  [{ ...key, key: 'Escape' }, 'cancel'],
  [{ ...key, ctrlKey: true, isComposing: true }, undefined],
  [{ ...key, key: 'Escape', isComposing: true }, undefined],
  [{ ...key, ctrlKey: true, keyCode: 229 }, undefined],
])('handles inline editor keyboard input %j', (event, expected) => {
  expect(editorKeyAction(event)).toBe(expected);
});

it('sticks on opening and near the bottom, not while reading history', () => {
  expect(isNearBottom({ scrollHeight: 1000, scrollTop: 404, clientHeight: 500 })).toBe(true);
  expect(isNearBottom({ scrollHeight: 1000, scrollTop: 403, clientHeight: 500 })).toBe(false);
  expect(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 500 })).toBe(true);
  expect(shouldStickToBottom(true, false)).toBe(true);
  expect(shouldStickToBottom(false, true)).toBe(true);
  expect(shouldStickToBottom(false, false)).toBe(false);
});

it('renders safe GFM, external links and soft line breaks without HTML execution', () => {
  const html = renderToStaticMarkup(
    <MessageContent
      content={
        '**bold**\nsoft break\n\n[link](https://example.com)\n\n[bad](javascript:alert(1))\n\n' +
        '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n' +
        '- item\n\n> quote\n\n`inline`\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| - | - |\n| a | b |'
      }
    />,
  );
  expect(html).toContain('<strong>bold</strong>\nsoft break');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(html).toContain('<table>');
  expect(html).toContain('<ul>');
  expect(html).toContain('<blockquote>');
  expect(html).toContain('<pre><code class="language-js">');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('onerror');
});

it('renders Markdown for both roles and a persona avatar/name with accessible disabled actions', () => {
  const message = { id: 'm', role: 'user' as const, content: '**Hello**', createdAt: '' };
  const persona = { id: 'p', name: 'My persona', description: '', avatar: 'p.png', createdAt: '', updatedAt: '' };
  const html = renderToStaticMarkup(
    <ChatMessageView
      message={message}
      persona={persona}
      disabled
      onEdit={async () => true}
      onDelete={async () => true}
    />,
  );
  expect(html).toContain('message user');
  expect(html).toContain('My persona');
  expect(html).toContain('/api/personas/p/avatar');
  expect(html).toContain('<strong>Hello</strong>');
  expect(html).toContain('aria-label="Edit message"');
  expect(html).toContain('aria-label="Delete message"');
  expect(html).toContain('disabled=""');
  const fallback = renderToStaticMarkup(<ChatMessageView message={message} />);
  expect(fallback).toContain('You');
  const assistant = renderToStaticMarkup(
    <ChatMessageView message={{ ...message, role: 'assistant', name: 'Speaker B' }} />,
  );
  expect(assistant).toContain('Speaker B');
  expect(assistant).toContain('message assistant');
  expect(assistant).toContain('<strong>Hello</strong>');
});

it('renders a busy multiline composer, an empty edit guard and an accessible pending indicator', () => {
  const composer = renderToStaticMarkup(
    <Composer content="" busy locked onChange={() => {}} onSend={async () => {}} onStop={() => {}} />,
  );
  expect(composer).toContain('<textarea');
  expect(composer).toContain('readOnly=""');
  expect(composer).toContain('aria-busy="true"');
  expect(composer).toContain('aria-label="Stop generation"');
  expect(composer).toContain('Shift+Enter');
  const editor = renderToStaticMarkup(
    <MessageEditor content=" " disabled={false} onSave={async () => true} onCancel={() => {}} />,
  );
  expect(editor).toContain('Message cannot be empty');
  expect(editor).toContain('disabled=""');
  const list = renderToStaticMarkup(
    <MessageList
      sessionId="s"
      messages={[]}
      characters={[]}
      logs={{}}
      busy
      disabled
      onEdit={async () => true}
      onDelete={async () => true}
    />,
  );
  expect(list).toContain('role="status"');
  expect(list).toContain('typing-dots');
  expect(list).not.toContain('Running workflow…');
});

it('shows reasoning, a stopped note, and no pending indicator once a reply row is streaming', () => {
  const base = { id: 'a', role: 'assistant' as const, createdAt: '' };
  const thinking = renderToStaticMarkup(
    <ChatMessageView message={{ ...base, content: '', reasoning: 'Plan', status: 'streaming' }} />,
  );
  expect(thinking).toContain('message-reasoning');
  expect(thinking).toContain('open=""');
  const stopped = renderToStaticMarkup(
    <ChatMessageView message={{ ...base, content: 'Half', reasoning: 'Plan', status: 'partial' }} />,
  );
  expect(stopped).not.toContain('open=""');
  expect(stopped).toContain('Stopped before it finished');
  const list = renderToStaticMarkup(
    <MessageList
      sessionId="s"
      messages={[{ ...base, content: 'Hel', status: 'streaming' }]}
      characters={[]}
      logs={{}}
      busy
      disabled
      onEdit={async () => true}
      onDelete={async () => true}
    />,
  );
  expect(list).not.toContain('typing-dots');
});

it("shows a node's log lines in the execution details", () => {
  const html = renderToStaticMarkup(
    <ExecutionDetails
      id="x"
      cached={{
        id: 'x',
        workflowId: 'w',
        sessionId: 's',
        status: 'error',
        startedAt: '',
        warnings: [],
        nodes: { parse: { status: 'error', error: 'No JSON value found in the text', logs: ['Input: <nope>'] } },
      }}
    />,
  );
  expect(html).toContain('<p class="error">No JSON value found in the text</p>');
  expect(html).toContain('<pre>Input: &lt;nope&gt;</pre>');
});

it('shows the story chip on a message only when it is given one, and puts it on the last reply of a turn', () => {
  const base = { role: 'assistant' as const, content: 'Hi', createdAt: '' };
  const chip = { turnNumber: 2, lines: ['scene.tension → 7'], editedAfter: false };
  expect(renderToStaticMarkup(<ChatMessageView message={{ id: 'a', ...base }} storyChip={chip} />)).toContain(
    'aria-label="What this turn stored"',
  );
  expect(renderToStaticMarkup(<ChatMessageView message={{ id: 'a', ...base }} />)).not.toContain(
    'What this turn stored',
  );
  const messages = [
    { id: 'first', ...base, executionId: 'e1', nodeId: 'a' },
    { id: 'last', ...base, executionId: 'e1', nodeId: 'b' },
  ];
  const story = {
    turn: 2,
    definitions: [],
    nodes: [],
    turns: [
      {
        executionId: 'e1',
        at: '',
        completed: true,
        replies: 2,
        turnNumber: 1,
        writes: [
          {
            write: {
              op: 'set' as const,
              target: { kind: 'definition' as const, definitionId: 'd', key: 'tension' },
              nodeId: 'n',
              value: 7,
            },
            definitionName: 'scene',
          },
        ],
      },
    ],
    summaries: [],
  };
  const list = renderToStaticMarkup(
    <MessageList
      sessionId="s"
      messages={messages}
      characters={[]}
      logs={{}}
      story={story}
      busy={false}
      disabled={false}
      onEdit={async () => true}
      onDelete={async () => true}
    />,
  );
  expect(list.match(/What this turn stored/g)).toHaveLength(2); // aria-label and title of the one button
  expect(list.indexOf('What this turn stored')).toBeGreaterThan(list.indexOf('data-execution-id="e1"'));
  expect(list.lastIndexOf('data-execution-id="e1"')).toBeLessThan(list.indexOf('What this turn stored'));
});

it('keeps the inline delete step until the trash button is clicked, even when deleting would undo story state', () => {
  const html = renderToStaticMarkup(
    <MessageActions
      disabled={false}
      onEdit={() => {}}
      onDelete={async () => true}
      undoOnDelete={() => {
        throw new Error('asked while rendering');
      }}
    />,
  );
  expect(html).toContain('aria-label="Delete message"');
  expect(html).not.toContain('Delete message?');
});
