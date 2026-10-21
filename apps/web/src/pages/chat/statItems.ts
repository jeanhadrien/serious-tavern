import type { TextStats } from '@st/shared';

export type StatKey = keyof TextStats;

export interface StatItem {
  key: StatKey;
  /** Short name, for the accessible label. */
  label: string;
  /** What the number is, in plain words (the hover text). */
  title: string;
  /** The number as shown; `—` when the metric is undefined for this reply. */
  value: string;
}

const MISSING = '—';

/** The numbers shown under an assistant reply, raw and in a fixed order. */
export function statItems(stats: TextStats): StatItem[] {
  const number = (value: number | null, show: (value: number) => string) => (value === null ? MISSING : show(value));
  return [
    {
      key: 'words',
      label: 'Words',
      title: 'Words in this reply, code blocks and links left out.',
      value: String(stats.words),
    },
    {
      key: 'mtld',
      label: 'Vocabulary diversity (MTLD)',
      title:
        'Vocabulary diversity (MTLD): how long the reply goes before its words start repeating. Higher means a more varied vocabulary. Not available for short replies.',
      value: number(stats.mtld, (value) => value.toFixed(1)),
    },
    {
      key: 'slopWords',
      label: 'Overused words',
      title: 'Words from a list of words that language models overuse ("tapestry", "testament"...). A count.',
      value: String(stats.slopWords),
    },
    {
      key: 'ngramOverlap',
      label: 'Repeated phrasing',
      title:
        'Share of the reply’s four-word sequences that already appeared in the previous replies. Not available for the first reply.',
      value: number(stats.ngramOverlap, (value) => `${Math.round(value * 100)}%`),
    },
    {
      key: 'recycledSentences',
      label: 'Recycled sentences',
      title: 'Sentences of this reply that appeared word for word in the previous replies.',
      value: String(stats.recycledSentences),
    },
  ];
}
