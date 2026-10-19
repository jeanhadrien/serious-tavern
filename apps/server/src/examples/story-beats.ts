import type { Collection, CollectionEntry } from '@st/shared';

export const BEATS_COLLECTION_ID = 'd91a3c57-2b84-4e60-b5f2-8c7e0a4d6f13';

type Beat = [text: string, tags: string[], level: 1 | 2 | 3 | 4 | 5, weight?: number];

// Self-written, genre-neutral things the story can offer. Level 1 is a passing detail, 2 something to notice,
// 3 a complication that wants a reaction, 4 a serious turn, 5 a climax-sized event.
const BEATS: Beat[] = [
  ['Somewhere close by, a door closes softly, as if someone did not want to be heard.', ['sound'], 1, 3],
  ['A smell of smoke, faint and sweet, drifts in from nowhere in particular.', ['sensory'], 1, 3],
  ['A stranger across the room looks away a moment too quickly.', ['person'], 1, 2],
  ['Something small and shiny lies half hidden where it should not be.', ['object'], 1, 2],
  ['A message arrives, short and unsigned: "Not here. Not yet."', ['mystery', 'person'], 2, 2],
  ['A familiar face turns up where it has no reason to be, and avoids an explanation.', ['person', 'mystery'], 2, 2],
  ['A promise made earlier comes due sooner than anyone expected.', ['history'], 2],
  ['The weather turns, and the plan for the day no longer works.', ['weather'], 2, 2],
  ['A rumour reaches the group that one of them is not who they claim to be.', ['mystery', 'person'], 3],
  [
    'Something that was safe a moment ago is suddenly not: a locked door, a broken tool, a closing window of time.',
    ['obstacle'],
    3,
    2,
  ],
  ['An ally asks for help that would cost the group something real.', ['person', 'choice'], 3],
  ['Pursuers are close, closer than anyone thought, and they have not yet been seen.', ['danger'], 3],
  ['A trusted plan fails in the middle of its execution, and someone is left exposed.', ['danger', 'obstacle'], 4],
  [
    'A secret comes out at the worst possible moment, and it changes how everyone looks at each other.',
    ['mystery', 'person'],
    4,
  ],
  ['The way back is closed. Whatever happens next has to happen here.', ['obstacle', 'danger'], 4, 0.5],
  ['The thing everyone has been avoiding arrives, all at once, and there is no more time to prepare.', ['danger'], 5],
  [
    'Someone has to choose now, in front of everyone, between what they want and what they owe.',
    ['choice', 'person'],
    5,
    0.5,
  ],
];

export function beatsCollection(): Collection {
  const date = new Date().toISOString();
  return {
    id: BEATS_COLLECTION_ID,
    name: 'Story beats (example)',
    description:
      'Things the story can offer, from a passing detail (level 1) to a climax-sized event (level 5). Written for the Story Director example; edit freely.',
    entries: BEATS.map(
      ([text, tags, level, weight = 1]): CollectionEntry => ({ text, tags, level, weight, enabled: true }),
    ),
    createdAt: date,
    updatedAt: date,
  };
}
