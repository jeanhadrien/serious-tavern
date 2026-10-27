import { findMacro, macroInputKey, snippetName } from './macros.js';
import { analyzeTemplate } from './template-analysis.js';

/**
 * The plain-language warnings of one template: syntax errors and constructs that fail at run time, then macros that
 * don't exist. With `inputKeys` (a node's input port names) a `{{input.<key>}}` for a key outside the list is a warning
 * too; a preset checks its inputs separately and passes none. With `snippetNames` (the stored snippets) a
 * `{{snippets.<name>}}` for another name is a warning. The one place templates are checked, for presets and nodes.
 */
export function templateWarnings(
  template: string,
  options: { inputKeys?: readonly string[]; snippetNames?: readonly string[] } = {},
): string[] {
  const { references, problems } = analyzeTemplate(template);
  const warnings = [...problems];
  for (const reference of references) {
    if (!reference.root) continue;
    if (!findMacro(reference.name)) warnings.push(`Unknown macro: ${reference.expression}`);
    const key = macroInputKey(reference.name);
    if (options.inputKeys && key !== undefined && !options.inputKeys.includes(key))
      warnings.push(`Unknown input: ${key}`);
    const snippet = snippetName(reference.name);
    if (options.snippetNames && snippet !== undefined && !options.snippetNames.includes(snippet))
      warnings.push(`Unknown snippet: ${snippet}`);
  }
  return warnings;
}
