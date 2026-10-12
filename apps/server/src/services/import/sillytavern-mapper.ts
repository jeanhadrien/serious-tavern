import { randomUUID } from 'node:crypto';
import type { Preset, PresetEntry, PresetInput } from '@st/shared';

type ImportedPresetFields = Pick<Preset, 'inputs' | 'entries'>;
type Placement = Extract<PresetEntry, { kind: 'message' }>['placement'];

type Record_ = Record<string, unknown>;

const CHAT_HISTORY = 'chatHistory';
// ST's "global" prompt order holds the user's real list; 100000 is a stock skeleton.
const ORDER_CHARACTER_IDS = ['100001', '100000'];
// injection_position 1 is ST's absolute (in-chat) injection, which is what depth placement models.
const ABSOLUTE_INJECTION = 1;
// Markers whose content is a macro in our model. Other markers have no equivalent and import disabled.
const MARKER_MACROS = new Map([
  ['charDescription', '{{character.description}}'],
  ['charPersonality', '{{character.personality}}'],
  ['scenario', '{{character.scenario}}'],
  ['personaDescription', '{{persona.description}}'],
]);

/**
 * Maps a parsed SillyTavern chat-completion preset to our preset inputs and entries. Pure: callers
 * supply the ids generator, and content is kept verbatim, macros included.
 */
export function mapSillyTavernPreset(file: unknown, newId: () => string = randomUUID): ImportedPresetFields {
  const root = asRecord(file);
  if (!root) throw new Error('Not a SillyTavern preset: expected a JSON object');

  const listed = listedPrompts(root);
  const promptByIdentifier = new Map<string, Record_>();
  for (const prompt of records(root.prompts)) {
    if (typeof prompt.identifier === 'string' && !promptByIdentifier.has(prompt.identifier))
      promptByIdentifier.set(prompt.identifier, prompt);
  }
  // Prompts absent from the chosen order are dropped, as ST does.
  const ordered = listed.flatMap((item) => {
    const prompt = promptByIdentifier.get(item.identifier);
    return prompt ? [{ ...item, prompt }] : [];
  });

  const ids = ordered.map(() => newId());
  // Depth placement targets the first enabled chat-history slot; without one, prompts stay ordered.
  const historyIndex = ordered.findIndex((item) => item.enabled && item.identifier === CHAT_HISTORY);
  const depthTarget = historyIndex === -1 ? undefined : ids[historyIndex];
  const inputs: PresetInput[] = ordered.some((item) => item.identifier === CHAT_HISTORY)
    ? [{ id: newId(), key: 'history', dataType: 'messages' }]
    : [];

  const entries = ordered.map((item, index): PresetEntry => {
    const id = ids[index]!;
    const name = entryName(item.prompt, item.identifier);
    if (item.identifier === CHAT_HISTORY)
      return { id, name, enabled: item.enabled, kind: 'slot', inputKey: 'history', role: 'user' };

    const placement = depthPlacement(item.prompt, depthTarget);
    if (item.prompt.marker !== true)
      return {
        id,
        name,
        enabled: item.enabled,
        kind: 'message',
        role: roleOf(item.prompt.role),
        content: typeof item.prompt.content === 'string' ? item.prompt.content : '',
        placement,
      };
    const macro = MARKER_MACROS.get(item.identifier);
    return {
      id,
      name,
      enabled: macro === undefined ? false : item.enabled,
      kind: 'message',
      role: 'system',
      content: macro ?? '',
      placement,
    };
  });
  return { inputs, entries };
}

function listedPrompts(root: Record_): { identifier: string; enabled: boolean }[] {
  const orders = records(root.prompt_order);
  const chosen =
    ORDER_CHARACTER_IDS.map((id) => orders.find((order) => String(order.character_id) === id)).find(Boolean) ??
    orders[0];
  return records(chosen?.order).flatMap((item) =>
    typeof item.identifier === 'string' ? [{ identifier: item.identifier, enabled: item.enabled === true }] : [],
  );
}

function depthPlacement(prompt: Record_, depthTarget: string | undefined): Placement {
  const depth = prompt.injection_depth;
  if (prompt.injection_position !== ABSOLUTE_INJECTION || depthTarget === undefined) return { mode: 'ordered' };
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return { mode: 'ordered' };
  return { mode: 'depth', entryId: depthTarget, depth: Math.max(0, Math.trunc(depth)) };
}

// Entry names must be non-empty, so they fall back to the identifier, then to a generic label.
function entryName(prompt: Record_, identifier: string): string {
  return nonEmptyString(prompt.name) ?? (identifier.trim() || 'Prompt');
}

function roleOf(value: unknown): 'system' | 'user' | 'assistant' {
  return value === 'user' || value === 'assistant' ? value : 'system';
}

function asRecord(value: unknown): Record_ | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record_) : undefined;
}

function records(value: unknown): Record_[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record_ => item !== undefined) : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
