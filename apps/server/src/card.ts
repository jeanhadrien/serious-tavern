import { characterSchema, type Character } from '@st/shared';
import { deflateSync } from 'node:zlib';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const cardFields = new Set([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'first_message', 'mes_example',
  'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings', 'tags',
  'creator', 'character_version', 'extensions'
]);

export class InvalidCardError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidCardError'; }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

export function readPngTextChunks(png: Buffer): Map<string, string> {
  if (png.length < signature.length || !png.subarray(0, signature.length).equals(signature))
    throw new InvalidCardError('File is not a valid PNG image');
  const values = new Map<string, string>();
  let offset = signature.length;
  let sawEnd = false;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new InvalidCardError('PNG contains a truncated chunk');
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const storedCrc = png.readUInt32BE(offset + 8 + length);
    if (storedCrc !== crc32(png.subarray(offset + 4, offset + 8 + length)))
      throw new InvalidCardError('PNG contains an invalid chunk checksum');
    if (type === 'tEXt') {
      const separator = data.indexOf(0);
      if (separator > 0) values.set(data.toString('latin1', 0, separator), data.toString('latin1', separator + 1));
    }
    offset = end;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  if (!sawEnd) throw new InvalidCardError('PNG is missing its end chunk');
  return values;
}

function parseCardJson(json: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch { throw new InvalidCardError('Character card metadata is not valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new InvalidCardError('Character card metadata must be a JSON object');
  const outer = parsed as Record<string, unknown>;
  const data = outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data)
    ? outer.data as Record<string, unknown> : outer;
  if (outer.spec && !['chara_card_v2', 'chara_card_v3'].includes(String(outer.spec)))
    throw new InvalidCardError('Unsupported character card specification');
  return data;
}

export function characterFromCard(json: string, id: string, date: string, avatar: string | boolean = false): Character {
  const card = parseCardJson(json);
  if (typeof card.name !== 'string' || !card.name.trim())
    throw new InvalidCardError('Character card is missing a name');
  const strings = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
    'system_prompt', 'post_history_instructions', 'creator', 'character_version'];
  const fields: Record<string, unknown> = {};
  for (const key of strings) {
    const value = key === 'first_mes' ? card.first_mes ?? card.first_message : card[key];
    fields[key] = typeof value === 'string' ? value : '';
  }
  const alternate = Array.isArray(card.alternate_greetings) ? card.alternate_greetings.filter(item => typeof item === 'string') : [];
  const tags = Array.isArray(card.tags) ? card.tags.filter(item => typeof item === 'string') : [];
  const extensions = card.extensions && typeof card.extensions === 'object' && !Array.isArray(card.extensions)
    ? { ...card.extensions as Record<string, unknown> } : {};
  for (const [key, value] of Object.entries(card)) if (!cardFields.has(key)) extensions[key] = value;
  const result = characterSchema.safeParse({
    id, name: card.name, ...fields, alternate_greetings: alternate, tags, extensions, avatar,
    createdAt: date, updatedAt: date
  });
  if (!result.success) throw new InvalidCardError(`Character card is invalid: ${result.error.issues.map(issue => issue.message).join(', ')}`);
  return result.data;
}

export function readCharacterCardPng(png: Buffer, id: string, date: string, avatar: string): Character {
  const text = readPngTextChunks(png);
  const key = text.has('ccv3') ? 'ccv3' : text.has('chara') ? 'chara' : undefined;
  if (!key) throw new InvalidCardError('PNG image does not contain a character card (ccv3 or chara metadata)');
  let decoded: string;
  try { decoded = Buffer.from(text.get(key)!, 'base64').toString('utf8'); }
  catch { throw new InvalidCardError(`PNG ${key} metadata is not valid base64`); }
  return characterFromCard(decoded, id, date, avatar);
}

export function writePngCard(png: Buffer, v2Json: string, v3Json: string): Buffer {
  readPngTextChunks(png);
  const chunks: Buffer[] = [signature];
  let offset = signature.length;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > png.length) throw new InvalidCardError('PNG contains a truncated chunk');
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type !== 'tEXt' || !['chara', 'ccv3'].includes(png.toString('latin1', offset + 8, offset + 8 + length).split('\0', 1)[0]!))
      chunks.push(png.subarray(offset, end));
    if (type === 'IEND') {
      chunks.splice(chunks.length - 1, 0,
        pngChunk('tEXt', Buffer.from(`chara\0${Buffer.from(v2Json).toString('base64')}`, 'latin1')),
        pngChunk('tEXt', Buffer.from(`ccv3\0${Buffer.from(v3Json).toString('base64')}`, 'latin1')));
      break;
    }
    offset = end;
  }
  return Buffer.concat(chunks);
}

export const pngSignature = signature;

export function placeholderPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([signature, pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))), pngChunk('IEND', Buffer.alloc(0))]);
}
