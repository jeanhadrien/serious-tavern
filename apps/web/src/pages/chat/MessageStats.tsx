import type { TextStats } from '@st/shared';
import { Copy, Languages, Repeat2, Sparkles, Type } from 'lucide-react';
import { statItems, type StatKey } from './statItems.js';

const ICONS: Record<StatKey, typeof Type> = {
  words: Type,
  mtld: Languages,
  slopWords: Sparkles,
  ngramOverlap: Copy,
  recycledSentences: Repeat2,
};

/** The raw text statistics of an assistant reply: a quiet row of icons and numbers, no judgement. */
export function MessageStats({ stats }: { stats: TextStats }) {
  return (
    <ul className="message-stats" aria-label="Text statistics">
      {statItems(stats).map((item) => {
        const Icon = ICONS[item.key];
        return (
          <li key={item.key} title={item.title} aria-label={`${item.label}: ${item.value}`}>
            <Icon size={13} aria-hidden="true" />
            <span aria-hidden="true">{item.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
