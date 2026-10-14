import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileMenu } from './MobileMenu.js';
import type { ResourceId } from './state.js';

const clean: Record<ResourceId, boolean> = {
  workflows: false,
  presets: false,
  providers: false,
  settings: false,
  characters: false,
  personas: false,
};

const render = (props: Partial<Parameters<typeof MobileMenu>[0]>) =>
  renderToStaticMarkup(
    <MobileMenu open active="chat" dirty={clean} onSelect={() => {}} onClose={() => {}} {...props} />,
  );

it('lists the chat and every list, marking what is on screen', () => {
  const html = render({ active: 'presets' });
  for (const label of ['Chat', 'Chats', 'Characters', 'Personas', 'Workflows', 'Presets', 'Providers', 'Settings'])
    expect(html).toContain(`<span>${label}</span>`);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-current="page"[^>]*>.*?<span>Presets<\/span>/);
  expect(html).not.toContain('editor');
});

it('offers the open wide editor and flags unsaved changes', () => {
  const html = render({ active: 'editor', wide: 'workflows', dirty: { ...clean, workflows: true } });
  expect(html).toContain('<span>Workflow editor</span>');
  expect(html).toMatch(/aria-current="page"[^>]*>.*?<span>Workflow editor<\/span>/);
  // The editor's own row and the Workflows list both carry the dot.
  expect(html.match(/aria-label="Unsaved changes"/g)).toHaveLength(2);
});
