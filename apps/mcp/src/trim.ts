/** Descriptions in a summary are cut here: a character card or a model blurb can run to pages. */
export const MAX_DESCRIPTION_LENGTH = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Per kept field, the keys it can come from, first present wins.
const KEPT_FIELDS = [['id', 'type'], ['name', 'label'], ['description']] as const;

/** Reduces one list item to `id` (or `type`), `name` (or `label`) and `description`; an item with none of them stays as is. */
function summarize(item: unknown): unknown {
  if (!isRecord(item)) return item;
  const summary: Record<string, unknown> = {};
  for (const keys of KEPT_FIELDS) {
    const key = keys.find((candidate) => item[candidate] !== undefined);
    if (key !== undefined) summary[key] = item[key];
  }
  if (Object.keys(summary).length === 0) return item;
  const { description } = summary;
  if (typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH)
    summary.description = `${description.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd()}…`;
  return summary;
}

const summarizeAll = (items: unknown[]) => items.map(summarize);

/**
 * The one trimming rule: the answer of a `list…` endpoint is cut down to summaries, so a list stays cheap to read and
 * the matching `get_` tool gives the full record. An answer that is an array is trimmed item by item; one that is an
 * object (a model list with its timestamp) has each of its array fields trimmed. Other endpoints answer in full.
 */
export function trimResponse(endpoint: string, data: unknown): unknown {
  if (!endpoint.startsWith('list')) return data;
  if (Array.isArray(data)) return summarizeAll(data);
  if (isRecord(data))
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? summarizeAll(value) : value]),
    );
  return data;
}
