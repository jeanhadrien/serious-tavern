import { describe, expect, it } from 'vitest';
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

describe('a turn whose after-reply run did not finish well', () => {
  const failed = {
    turnNumber: 2,
    lines: [],
    editedAfter: false,
    post: { status: 'error' as const, message: 'HTTP Request (fetch): HTTP 500', executionId: 'p1' },
  };

  it('names the button for the after-reply run when the turn stored nothing, and warns', () => {
    const html = renderToStaticMarkup(<TurnChip chip={failed} />);
    const button = html.match(/<button[^>]*>/)?.[0] ?? '';
    expect(button).toContain('aria-label="After-reply steps details"');
    expect(button).toContain('chip-alert');
    expect(button).toContain('aria-expanded="false"');
  });

  it('keeps the stored name when the turn also stored something', () => {
    const html = renderToStaticMarkup(<TurnChip chip={{ ...failed, lines: ['scene.tension → 9'] }} />);
    expect(html.match(/<button[^>]*>/)?.[0]).toContain('aria-label="What this turn stored"');
  });

  it('shows the error and a disclosure for the run’s log in the card', () => {
    const html = renderToStaticMarkup(<TurnChipCard chip={failed} />);
    expect(html).toContain('<strong>Turn 2</strong>');
    expect(html).not.toContain('stored:');
    expect(html).toContain('After-reply steps failed: HTTP Request (fetch): HTTP 500');
    expect(html).toContain('<summary>After-reply run details</summary>');
  });

  it('lists the writes above the error when there are some', () => {
    const html = renderToStaticMarkup(<TurnChipCard chip={{ ...failed, lines: ['scene.tension → 9'] }} />);
    expect(html).toContain('Turn 2 stored:');
    expect(html.indexOf('scene.tension → 9')).toBeLessThan(html.indexOf('After-reply steps failed'));
  });

  it('has no disclosure for a run without a log id', () => {
    const html = renderToStaticMarkup(<TurnChipCard chip={{ ...failed, post: { status: 'error' } }} />);
    expect(html).toContain('After-reply steps failed.');
    expect(html).not.toContain('<details');
  });

  it('says a stopped run was stopped, not that it failed', () => {
    const html = renderToStaticMarkup(
      <TurnChipCard chip={{ ...failed, post: { status: 'stopped', executionId: 'p1' } }} />,
    );
    expect(html).toContain('After-reply steps were stopped before they finished.');
    expect(html).not.toContain('class="error"');
    expect(renderToStaticMarkup(<TurnChip chip={{ ...failed, post: { status: 'stopped' } }} />)).not.toContain(
      'chip-alert',
    );
  });

  it('offers the log of a completed run too, and says so when it stored nothing', () => {
    const done = { ...failed, post: { status: 'completed' as const, executionId: 'p1' } };
    const empty = renderToStaticMarkup(<TurnChipCard chip={done} />);
    expect(empty).toContain('The after-reply steps ran and stored nothing.');
    expect(empty).toContain('<summary>After-reply run details</summary>');
    expect(renderToStaticMarkup(<TurnChip chip={done} />)).not.toContain('chip-alert');
    const stored = renderToStaticMarkup(<TurnChipCard chip={{ ...done, lines: ['scene.tension → 9'] }} />);
    expect(stored).not.toContain('stored nothing');
    expect(stored).toContain('<summary>After-reply run details</summary>');
  });

  it('leaves out the edited note for a chip with no stored lines', () => {
    expect(renderToStaticMarkup(<TurnChipCard chip={{ ...failed, editedAfter: true }} />)).not.toContain(
      'Edited after',
    );
  });
});

describe('a turn that lost a linked item at commit time', () => {
  const lost =
    'An item for memory.summaries ("The party met Borin") was not saved: a message it links to was edited while it was being written.';
  const warned = { turnNumber: 4, lines: [], editedAfter: false, warnings: [lost] };

  it('names the button for the warnings and warns on the icon', () => {
    const button = renderToStaticMarkup(<TurnChip chip={warned} />).match(/<button[^>]*>/)?.[0] ?? '';
    expect(button).toContain('aria-label="Turn warnings"');
    expect(button).toContain('title="Turn warnings"');
    expect(button).toContain('chip-alert');
  });

  it('shows the warning in the card, next to what the turn stored', () => {
    const html = renderToStaticMarkup(<TurnChipCard chip={{ ...warned, lines: ['scene.tension → 9'] }} />);
    expect(html).toContain('<li>scene.tension → 9</li>');
    expect(html).toContain('An item for memory.summaries');
  });
});
