import type { ImportApp, Preset } from '@st/shared';

/** A source file a connector found. Identity is (user, file) within one install. */
export interface SourceFile {
  user: string;
  file: string;
  path: string;
}

/**
 * Adapter for one external app: where its importable files live, how they are named, and how their
 * JSON maps to presets. Sync and the routes are generic over it.
 */
export interface ImportConnector {
  readonly app: ImportApp;
  /** Throws an HttpError when `installPath` is not a usable install of this app. */
  detect(installPath: string): Promise<void>;
  /** Lists only the files this connector imports. Nothing else in the install is read. */
  scan(installPath: string): Promise<SourceFile[]>;
  /** Display name of the preset imported from `file`. */
  presetName(file: SourceFile): string;
  /** Maps a parsed source file to preset fields. Throws when the content is unusable. */
  mapContent(json: unknown): Pick<Preset, 'inputs' | 'entries'>;
}
