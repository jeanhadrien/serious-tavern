import { z } from 'zod';
import { isSettingKey } from './chat-settings.js';

// Snippets: named pieces of template text the user writes once and reuses anywhere as `{{snippets.<name>}}`.
// Read through the YAML codec, which parses every file on read (see `collection.ts`), so records keep unknown fields.

/**
 * A snippet name is its handle in templates (`{{snippets.<name>}}`), compared case-sensitively. It follows the
 * rule of chat setting keys (an identifier, not a reserved word), since both are template paths.
 */
export const snippetNameSchema = z
  .string()
  .refine(isSettingKey, 'Use letters, digits and _ (not starting with a digit), and not a reserved word');

/** What a client writes: everything but identity and timestamps. */
export const snippetWriteSchema = z
  .object({
    name: snippetNameSchema,
    description: z.string().optional(),
    // A template, rendered with the context of the template that uses the snippet.
    text: z.string(),
  })
  .passthrough();
export type SnippetFields = z.input<typeof snippetWriteSchema>;

/** A stored snippet (`data/snippets/*.yaml`). */
export const snippetSchema = snippetWriteSchema
  .extend({ id: z.string().uuid(), createdAt: z.string(), updatedAt: z.string() })
  .passthrough();
export type Snippet = z.infer<typeof snippetSchema>;

/**
 * The `snippets` namespace of a template: text by name. Where hand-edited files repeat a name, the oldest snippet
 * wins (the API refuses a duplicate name, so only files on disk can repeat one).
 */
export function snippetTexts(snippets: readonly Snippet[]): Record<string, string> {
  const oldestFirst = [...snippets].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const texts: Record<string, string> = {};
  for (const snippet of oldestFirst) if (!Object.hasOwn(texts, snippet.name)) texts[snippet.name] = snippet.text;
  return texts;
}
