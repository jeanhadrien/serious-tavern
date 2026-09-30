import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MessageContent({ content }: { content: string }) {
  return (
    <div className="message-content">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
