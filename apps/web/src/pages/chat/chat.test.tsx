import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
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
      onRegenerate={() => {}}
      onSwipe={async () => true}
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
      onRegenerate={() => {}}
      onSwipe={async () => true}
    />,
  );
  expect(list).not.toContain('typing-dots');
});

it("shows a node's log lines in the execution details", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
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
      />
    </MemoryRouter>,
  );
  expect(html).toContain('<p class="error">No JSON value found in the text</p>');
  // Each node row links to its node on the canvas of the run's workflow.
  expect(html).toContain('href="/?wide=workflow:w&amp;node=parse"');
  expect(html).toContain('>Show on canvas</a>');
  expect(html).toContain('<pre>Input: &lt;nope&gt;</pre>');
});

it('marks every message with its id, either role, so the chat panel and the link markers can find it', () => {
  for (const role of ['user', 'assistant'] as const)
    expect(
      renderToStaticMarkup(<ChatMessageView message={{ id: 'm-7', role, content: 'Hi', createdAt: '' }} />),
    ).toContain('data-message-id="m-7"');
});

it('shows a link marker on a message that state items link to, and none otherwise', () => {
  const message = { id: 'a', role: 'user' as const, content: 'Hi', createdAt: '' };
  const note = {
    itemId: 'i1',
    key: 'memory.summaries',
    range: 'messages 1–2 (2)',
    preview: 'A summary',
    status: 'intact' as const,
  };
  const html = renderToStaticMarkup(<ChatMessageView message={message} links={[note, note]} />);
  expect(html).toContain('aria-label="2 state items link to this message"');
  expect(renderToStaticMarkup(<ChatMessageView message={message} links={[note]} />)).toContain(
    'aria-label="1 state item links to this message"',
  );
  expect(renderToStaticMarkup(<ChatMessageView message={message} />)).not.toContain('link to this message');
  expect(renderToStaticMarkup(<ChatMessageView message={message} links={[]} />)).not.toContain('link to this message');
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
      onRegenerate={() => {}}
      onSwipe={async () => true}
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

it('offers Copy on stored messages with content, with or without edit and delete', () => {
  const base = { id: 'm', role: 'assistant' as const, createdAt: '' };
  const copyOnly = renderToStaticMarkup(<ChatMessageView message={{ ...base, content: 'Hi' }} />);
  expect(copyOnly).toContain('aria-label="Copy message"');
  expect(copyOnly).not.toContain('aria-label="Edit message"');
  const all = renderToStaticMarkup(
    <ChatMessageView message={{ ...base, content: 'Hi' }} onEdit={async () => true} onDelete={async () => true} />,
  );
  for (const label of ['Copy message', 'Edit message', 'Delete message'])
    expect(all).toContain(`aria-label="${label}"`);
});

it('shows no Copy on a streaming row or a message without content', () => {
  const base = { id: 'm', role: 'assistant' as const, createdAt: '' };
  const streaming = { ...base, content: 'Hel', status: 'streaming' as const };
  expect(renderToStaticMarkup(<ChatMessageView message={streaming} />)).not.toContain('Copy message');
  expect(renderToStaticMarkup(<ChatMessageView message={{ ...base, content: '' }} />)).not.toContain('Copy message');
});
