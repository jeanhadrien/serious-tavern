import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnChip, TurnChipCard } from './TurnChip.js';

const chip = { turnNumber: 3, lines: ['scene.tension → 9', "Draw #1 (draw): drew 'resin'"], editedAfter: false };

it('renders a closed button with an accurate name and state', () => {
  const html = renderToStaticMarkup(<TurnChip chip={chip} />);
  const button = html.match(/<button[^>]*>/)?.[0] ?? '';
  expect(button).toContain('aria-label="What this turn stored"');
  expect(button).toContain('title="What this turn stored"');
  expect(button).toContain('aria-expanded="false"');
  expect(button).not.toContain('aria-controls');
  expect(html).not.toContain('Turn 3 stored');
});

it('lists the turn and its writes in the card', () => {
  const html = renderToStaticMarkup(<TurnChipCard chip={chip} />);
  expect(html).toContain('Turn 3 stored:');
  expect(html).toContain('<li>scene.tension → 9</li>');
  expect(html).toContain(`<li>Draw #1 (draw): drew &#x27;resin&#x27;</li>`);
  expect(html).not.toContain('Edited after it was stored');
});

it('adds the note when a reply was edited after its turn stored state', () => {
  const html = renderToStaticMarkup(<TurnChipCard chip={{ ...chip, editedAfter: true }} />);
  expect(html).toContain('Edited after it was stored');
});
