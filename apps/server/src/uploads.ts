import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyReply } from 'fastify';
import { HttpError } from './errors.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export type UploadedFile = { name: string; mime: string; data: Buffer };

export function parseMultipart(body: unknown, contentType: string): UploadedFile[] {
  if (!Buffer.isBuffer(body)) throw new HttpError(400, 'INVALID_UPLOAD', 'Expected a multipart file upload');
  const boundary = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw new HttpError(400, 'INVALID_UPLOAD', 'Multipart boundary is missing');
  const marker = Buffer.from(`--${(boundary[1] ?? boundary[2]!).trim()}`);
  const files: UploadedFile[] = [];
  let cursor = 0;
  while (true) {
    const start = body.indexOf(marker, cursor);
    if (start < 0) break;
    let partStart = start + marker.length;
    if (body.subarray(partStart, partStart + 2).toString() === '--') break;
    if (body.subarray(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
    const next = body.indexOf(marker, partStart);
    if (next < 0) break;
    let partEnd = next;
    if (body.subarray(partEnd - 2, partEnd).toString() === '\r\n') partEnd -= 2;
    const separator = body.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (separator < 0 || separator >= partEnd)
      throw new HttpError(400, 'INVALID_UPLOAD', 'Malformed multipart request');
    const headers = body.toString('latin1', partStart, separator);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headers)?.[1] ?? '';
    const fileName = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1];
    if (fileName !== undefined && fileName.length) {
      const data = body.subarray(separator + 4, partEnd);
      if (data.length > MAX_UPLOAD_BYTES)
        throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'Each upload must be 20 MB or smaller');
      files.push({
        name: fileName.replace(/\\/g, '/').split('/').pop() ?? 'upload',
        data,
        mime: /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim().toLowerCase() ?? 'application/octet-stream',
      });
    }
    cursor = next;
  }
  if (!files.length) throw new HttpError(400, 'INVALID_UPLOAD', 'No files were uploaded');
  return files;
}

export function imageExtension(mime: string): string {
  const extension: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  const result = extension[mime.toLowerCase()];
  if (!result) throw new HttpError(415, 'UNSUPPORTED_IMAGE', 'Upload a PNG, JPEG, GIF, or WebP image');
  return result;
}

export async function storeAvatar(directory: string, id: string, file: UploadedFile): Promise<string> {
  const extension = imageExtension(file.mime);
  if (file.data.length > MAX_UPLOAD_BYTES)
    throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'Image must be 20 MB or smaller');
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory))
    if (name.startsWith(`${id}.`)) await rm(join(directory, name), { force: true });
  const name = `${id}${extension}`;
  await writeFile(join(directory, name), file.data, { flag: 'w' });
  return name;
}

export async function removeAvatar(directory: string, id: string): Promise<void> {
  try {
    for (const name of await readdir(directory))
      if (name.startsWith(`${id}.`)) await rm(join(directory, name), { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function sendAvatar(
  reply: FastifyReply,
  directory: string,
  filename: string | boolean,
): Promise<FastifyReply> {
  if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\'))
    throw new HttpError(404, 'NOT_FOUND', 'Avatar not found');
  let data: Buffer;
  try {
    data = await readFile(join(directory, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'NOT_FOUND', 'Avatar not found');
    throw error;
  }
  const mime =
    (
      { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<
        string,
        string
      >
    )[filename.slice(filename.lastIndexOf('.'))] ?? 'application/octet-stream';
  return reply.type(mime).header('Cache-Control', 'private, max-age=3600').send(data);
}
