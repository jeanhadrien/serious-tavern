import { describe, expect, it } from 'vitest';
import { characterFromCard, InvalidCardError, placeholderPng, readCharacterCardPng, readPngTextChunks, writePngCard } from './card.js';

const v1 = { name: 'Legacy', description: 'Old card', personality: 'kind', first_mes: 'Hello', custom_extension: 42 };
const v2 = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Second', scenario: 'Rainy day' } };
const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Third', tags: ['test'] } };

describe('character card parser and PNG metadata', () => {
  it('accepts V1 flat, V2, and V3 card payloads and preserves unknown data', () => {
    const legacy = characterFromCard(JSON.stringify(v1), 'id-1', 'date');
    const second = characterFromCard(JSON.stringify(v2), 'id-2', 'date');
    const third = characterFromCard(JSON.stringify(v3), 'id-3', 'date');
    expect(legacy).toMatchObject({ name: 'Legacy', first_mes: 'Hello', extensions: { custom_extension: 42 } });
    expect(second).toMatchObject({ name: 'Second', scenario: 'Rainy day' });
    expect(third).toMatchObject({ name: 'Third', tags: ['test'] });
  });

  it('prefers ccv3 over chara metadata and round-trips both PNG card metadata fields', () => {
    const png = writePngCard(placeholderPng(), JSON.stringify(v2), JSON.stringify(v3));
    expect(readPngTextChunks(png).has('chara')).toBe(true);
    expect(readPngTextChunks(png).has('ccv3')).toBe(true);
    expect(readCharacterCardPng(png, 'id', 'date', 'id.png')).toMatchObject({ name: 'Third', avatar: 'id.png' });
  });

  it('returns clear invalid-card errors for malformed JSON and PNGs without card metadata', () => {
    expect(() => characterFromCard('{', 'id', 'date')).toThrow(InvalidCardError);
    expect(() => readCharacterCardPng(placeholderPng(), 'id', 'date', 'id.png'))
      .toThrow('PNG image does not contain a character card');
  });
});
