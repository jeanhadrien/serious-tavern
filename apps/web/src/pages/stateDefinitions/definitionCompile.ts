import { isSettingKey, stateDefinitionWriteSchema, TEMPLATE_NAME_RULE, type StateDefinitionFields } from '@st/shared';
import type { DefinitionDraft, KeyDraft } from './definitionDraft.js';
import { parseFields, parseNumberText, parseObjectText, parseOptions } from './keyFields.js';

/** Problems found in a draft, in plain language: one for the name and a list per key row (by its uid). */
export interface DraftProblems {
  name?: string;
  keys: Record<string, string[]>;
  count: number;
}

/** The typed properties of one key, or the problems with its text fields. */
function compileKey(key: KeyDraft): { def?: Record<string, unknown>; problems: string[] } {
  const problems: string[] = [];
  const typed: Record<string, unknown> = {};
  const number = (label: string, text: string) => {
    const parsed = parseNumberText(text);
    if (!parsed.ok) problems.push(`${label} must be a number`);
    return parsed.ok ? parsed.value : undefined;
  };
  const set = (name: string, value: unknown) => {
    if (value !== undefined) typed[name] = value;
  };
  set('description', key.description.trim() || undefined);
  switch (key.type) {
    case 'number':
      set('default', number('Default', key.default));
      set('min', number('Min', key.min));
      set('max', number('Max', key.max));
      break;
    case 'boolean':
      if (key.default) set('default', key.default === 'true');
      break;
    case 'enum':
      typed.options = parseOptions(key.options);
      if (key.default) typed.default = key.default;
      break;
    case 'text':
      if (key.default) typed.default = key.default;
      break;
    case 'object': {
      const parsed = parseObjectText(key.default);
      if (parsed.ok) set('default', parsed.value);
      else problems.push(`Default: ${parsed.error}`);
      break;
    }
    case 'collection':
    case 'thread': {
      const cap = number('Cap', key.cap);
      if (cap !== undefined && !(Number.isInteger(cap) && cap >= 1))
        problems.push('Cap must be a whole number, 1 or more');
      set('cap', cap);
      // A thread's items are exchanges, not declared records: it has a cap and no item fields.
      if (key.type === 'collection') {
        const fields = parseFields(key.fields);
        if (fields.ok) set('fields', fields.fields);
        else problems.push(...fields.errors);
      }
      break;
    }
  }
  return problems.length ? { problems } : { def: { type: key.type, ...typed, ...key.rest }, problems };
}

/**
 * Why a definition cannot take `name` (already trimmed): it is blank, not usable in templates, or another
 * definition has it (compared ignoring case). The one check behind the form, the save and Duplicate.
 */
export function definitionNameProblem(name: string, takenNames: readonly string[]): string | undefined {
  if (!name) return 'Give the definition a name';
  if (!isSettingKey(name)) return TEMPLATE_NAME_RULE;
  const lower = name.toLowerCase();
  return takenNames.some((taken) => taken.toLowerCase() === lower)
    ? `A state definition named "${name}" already exists`
    : undefined;
}

/** The schema adds `"<key>: "` in front of its own messages. */
const withoutPrefix = (message: string, key: string) =>
  message.startsWith(`${key}: `) ? message.slice(key.length + 2) : message;

/**
 * Turns a draft into a request body and checks it: the one path for the save body and the live problems shown in
 * the form. `body` is only present when there are no problems. `takenNames` are the other definitions' names.
 */
export function compile(
  draft: DefinitionDraft,
  takenNames: readonly string[] = [],
): { body?: StateDefinitionFields; problems: DraftProblems } {
  const problems: DraftProblems = { keys: {}, count: 0 };
  const addKey = (uid: string, message: string) => {
    problems.keys[uid] = [...(problems.keys[uid] ?? []), message];
    problems.count++;
  };

  const name = draft.name.trim();
  problems.name = definitionNameProblem(name, takenNames);
  if (problems.name) problems.count++;

  const keys: Record<string, unknown> = {};
  const uidOf = new Map<string, string>();
  for (const key of draft.keys) {
    const keyName = key.name.trim();
    const own = compileKey(key);
    for (const message of own.problems) addKey(key.uid, message);
    if (!keyName) addKey(key.uid, 'Give the key a name');
    else if (!isSettingKey(keyName)) addKey(key.uid, TEMPLATE_NAME_RULE);
    else if (uidOf.has(keyName)) addKey(key.uid, `Another key is already named ${keyName}`);
    else if (own.def) {
      keys[keyName] = own.def;
      uidOf.set(keyName, key.uid);
    }
  }

  // The schema checks what the rows cannot: ranges, defaults against options, reserved item fields. It runs over
  // the rows that are fine so far, with a stand-in name, so every row shows its problems at once.
  const parsed = stateDefinitionWriteSchema.safeParse({ name: problems.name ? 'x' : name, keys });
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const [head, keyName] = issue.path;
      const uid = head === 'keys' && typeof keyName === 'string' ? uidOf.get(keyName) : undefined;
      const message = typeof keyName === 'string' ? withoutPrefix(issue.message, keyName) : issue.message;
      const target = uid ?? draft.keys[0]?.uid;
      if (target) addKey(target, message);
      else {
        problems.name = message;
        problems.count++;
      }
    }

  if (problems.count) return { problems };
  const description = draft.description.trim();
  return { body: { name, ...(description && { description }), keys: keys as StateDefinitionFields['keys'] }, problems };
}
