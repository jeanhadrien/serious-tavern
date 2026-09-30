import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../storage/repository.js';
import { KeyedLock } from '../storage/lock.js';

type CipherText = { iv: string; tag: string; ciphertext: string; hint: string };
export class SecretStore {
  private key!: Buffer;
  private readonly file: string;
  private readonly mutations = new KeyedLock();
  constructor(private readonly directory: string) {
    this.file = join(directory, 'secrets.enc.json');
  }
  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    if (process.env.SECRETS_KEY) {
      const key = process.env.SECRETS_KEY;
      if (!/^[\da-fA-F]{64}$/.test(key)) throw new Error('SECRETS_KEY must be 64 hex characters (32 bytes)');
      this.key = Buffer.from(key, 'hex');
    } else {
      const path = join(this.directory, '.master.key');
      try {
        await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      this.key = Buffer.from((await readFile(path, 'utf8')).trim(), 'hex');
      if (this.key.length !== 32) throw new Error('Invalid master key');
    }
  }
  private async read(): Promise<Record<string, CipherText>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, CipherText>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  async list(): Promise<{ name: string; hint: string }[]> {
    return Object.entries(await this.read()).map(([name, { hint }]) => ({ name, hint }));
  }
  async get(name: string): Promise<string | undefined> {
    const entry = (await this.read())[name];
    if (!entry) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
  async set(name: string, value: string): Promise<void> {
    await this.mutations.run(this.file, async () => {
      const entries = await this.read();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      entries[name] = {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        hint: value.length > 7 ? `${value.slice(0, 5)}…${value.slice(-3)}` : '••••',
      };
      await atomicWrite(this.file, JSON.stringify(entries, null, 2));
    });
  }
  async delete(name: string): Promise<void> {
    await this.mutations.run(this.file, async () => {
      const entries = await this.read();
      delete entries[name];
      await atomicWrite(this.file, JSON.stringify(entries, null, 2));
    });
  }
}
