import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiResponse, Character } from '@st/shared';
import { InvalidCardError, characterFromCard, placeholderPng, readCharacterCardPng, writePngCard } from '../card.js';
import { now, type AppContext } from '../context.js';
import { errorMessage, HttpError } from '../errors.js';
import { MAX_UPLOAD_BYTES, normalizeImage, storeAvatar, type UploadedFile } from '../uploads.js';

export const cardData = (character: Character): Exclude<ApiResponse<'exportCharacter'>, Uint8Array> => ({
  ...character.extensions,
  name: character.name,
  description: character.description,
  personality: character.personality,
  scenario: character.scenario,
  first_mes: character.first_mes,
  mes_example: character.mes_example,
  creator_notes: character.creator_notes,
  system_prompt: character.system_prompt,
  post_history_instructions: character.post_history_instructions,
  alternate_greetings: character.alternate_greetings,
  tags: character.tags,
  creator: character.creator,
  character_version: character.character_version,
});

export async function importCharacters(
  { characters, characterAvatars }: AppContext,
  files: UploadedFile[],
): Promise<ApiResponse<'importCharacters'>> {
  const imported: Character[] = [];
  const failed: ApiResponse<'importCharacters'>['failed'] = [];
  for (const source of files) {
    const file = normalizeImage(source);
    const id = randomUUID();
    const date = now();
    try {
      if (file.data.length > MAX_UPLOAD_BYTES)
        throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'File must be 20 MB or smaller');
      let character: Character;
      if (file.mime === 'image/png' || /\.png$/i.test(file.name)) {
        const image = { ...file, mime: 'image/png' };
        character = readCharacterCardPng(image.data, id, date, `${id}.png`);
        await storeAvatar(characterAvatars, id, image);
      } else if (/\.json$/i.test(file.name) || /^(application|text)\/json$/i.test(file.mime)) {
        character = characterFromCard(file.data.toString('utf8'), id, date, false);
      } else throw new InvalidCardError('Import a character card JSON file or PNG with embedded card metadata');
      await characters.save(character);
      imported.push(character);
    } catch (error) {
      if (error instanceof HttpError && error.code === 'UPLOAD_TOO_LARGE') throw error;
      const code =
        error instanceof InvalidCardError ? 'INVALID_CARD' : error instanceof HttpError ? error.code : 'INVALID_CARD';
      failed.push({ filename: file.name, error: { code, message: errorMessage(error) } });
    }
  }
  if (!imported.length && failed.length === 1 && failed[0]!.error.code === 'INVALID_CARD')
    throw new HttpError(400, 'INVALID_CARD', failed[0]!.error.message, failed);
  return { imported, failed };
}

export async function exportCharacterPng(character: Character, avatarDirectory: string): Promise<Uint8Array> {
  const data = cardData(character);
  let image = placeholderPng();
  if (typeof character.avatar === 'string') {
    try {
      image = await readFile(join(avatarDirectory, character.avatar));
    } catch {
      image = placeholderPng();
    }
  }
  const v2 = JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data });
  const v3 = JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data });
  return writePngCard(image, v2, v3);
}
