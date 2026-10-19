import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatsSectionView } from './ChatsSection.js';

const render = (props: Parameters<typeof ChatsSectionView>[0]) => renderToStaticMarkup(<ChatsSectionView {...props} />);

it('shows the stored value of the fork toggle', () => {
  expect(render({ settings: { forkKeepsAlternatives: true }, saving: false, onChange: () => {} })).toMatch(
    /<input type="checkbox" checked=""\/?>/,
  );
  const off = render({ settings: { forkKeepsAlternatives: false }, saving: false, onChange: () => {} });
  expect(off).not.toContain('checked=""');
  expect(off).not.toContain('disabled=""');
  expect(off).toContain('Forks keep the alternatives of the reply they start from');
});

it('locks the toggle until the settings are loaded and while one is being saved', () => {
  expect(render({ saving: false, onChange: () => {} })).toContain('disabled=""');
  expect(render({ settings: { forkKeepsAlternatives: true }, saving: true, onChange: () => {} })).toContain(
    'disabled=""',
  );
});
