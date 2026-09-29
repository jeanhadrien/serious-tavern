import { randomUUID } from 'node:crypto';
import { personaSchema, type ApiResponse, type Persona } from '@st/shared';
import { InvalidCardError, readCharacterCardPng, readPngTextChunks } from '../card.js';
import { now, type AppContext } from '../context.js';
import { errorMessage, HttpError } from '../errors.js';
import { imageExtension, MAX_UPLOAD_BYTES, normalizeImage, storeAvatar, type UploadedFile } from '../uploads.js';

export async function importPersonas(
  { personas, personaAvatars }: AppContext,
  files: UploadedFile[],
): Promise<ApiResponse<'importPersonas'>> {
  const imported: Persona[] = [];
  const failed: ApiResponse<'importPersonas'>['failed'] = [];
  for (const source of files) {
    const file = normalizeImage(source);
    const id = randomUUID();
    const date = now();
    try {
      if (file.data.length > MAX_UPLOAD_BYTES)
        throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'File must be 20 MB or smaller');
      const avatarFile = { ...file, mime: imageExtension(file.mime) === '.png' ? 'image/png' : file.mime };
      const avatar = `${id}.${imageExtension(avatarFile.mime).slice(1)}`;
      let name = file.name.replace(/\.[^.]*$/, '').trim() || 'New persona';
      let description = '';
      if (avatarFile.mime === 'image/png') {
        const metadata = readPngTextChunks(file.data);
        if (metadata.has('ccv3') || metadata.has('chara')) {
          const card = readCharacterCardPng(file.data, id, date, avatar);
          name = card.name;
          description = card.description;
        }
      }
      const persona = personaSchema.parse({ id, name, description, avatar, createdAt: date, updatedAt: date });
      await storeAvatar(personaAvatars, id, avatarFile);
      await personas.save(persona);
      imported.push(persona);
    } catch (error) {
      const code =
        error instanceof HttpError ? error.code : error instanceof InvalidCardError ? 'INVALID_CARD' : 'INVALID_IMAGE';
      failed.push({ filename: file.name, error: { code, message: errorMessage(error) } });
    }
  }
  return { imported, failed };
}
