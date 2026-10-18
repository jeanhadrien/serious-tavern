import { parse, type AST } from '@handlebars/parser';

// Helpers available to every template. The runtime lives in packages/engine/src/template-helpers.ts.
export const templateHelperNames = [
  'if',
  'unless',
  'each',
  'with',
  'lookup',
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'and',
  'or',
  'not',
  'linked',
] as const;

const helperNames = new Set<string>(templateHelperNames);

export type TemplateReference = {
  /** The reference as written, e.g. `{{character.name}}`. */
  expression: string;
  /** The path without leading `../`, e.g. `character.name`. */
  name: string;
  /** False inside an `#each`/`#with` body, where the path is relative to that item and cannot be checked. */
  root: boolean;
};

export type TemplateAnalysis = {
  references: TemplateReference[];
  /** Plain-language problems: syntax errors and constructs that fail or render nothing at runtime. */
  problems: string[];
};

type Scope = { changesContext: boolean; blockParams: readonly string[] };

export function analyzeTemplate(template: string): TemplateAnalysis {
  let program: AST.Program;
  try {
    program = parse(template);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0]!.replace(/:$/, '') : String(error);
    // Handlebars reads a trailing numeric segment (`{{history.0}}`) as a number literal, which is not a path.
    const hint = /\.\d+\s*\}\}/.test(template)
      ? ' (write numeric path segments in brackets, e.g. {{history.[0]}})'
      : '';
    return { references: [], problems: [`Template syntax error: ${message}${hint}`] };
  }
  const analysis: TemplateAnalysis = { references: [], problems: [] };
  walkProgram(program, [], analysis);
  return analysis;
}

function walkProgram(program: AST.Program, scopes: Scope[], analysis: TemplateAnalysis): void {
  for (const statement of program.body) walkStatement(statement, scopes, analysis);
}

function walkStatement(node: AST.Node, scopes: Scope[], analysis: TemplateAnalysis): void {
  switch (node.type) {
    case 'MustacheStatement': {
      const mustache = node as AST.MustacheStatement;
      walkCall(mustache.path, mustache.params, mustache.hash, scopes, analysis);
      return;
    }
    case 'BlockStatement':
      walkBlock(node as AST.BlockStatement, scopes, analysis);
      return;
    case 'PartialStatement':
    case 'PartialBlockStatement':
      analysis.problems.push('Unsupported template syntax: partials');
      return;
    case 'Decorator':
    case 'DecoratorBlock':
      analysis.problems.push('Unsupported template syntax: decorators');
      return;
    default:
      // Content and comments render no references.
      return;
  }
}

function walkBlock(block: AST.BlockStatement, scopes: Scope[], analysis: TemplateAnalysis): void {
  const name = block.path.original;
  walkCall(block.path, block.params, block.hash, scopes, analysis);
  if (['if', 'unless', 'with'].includes(name) && block.params.length !== 1)
    analysis.problems.push(`Block helper #${name} requires exactly one argument`);
  if (name === 'each' && block.params.length === 0) analysis.problems.push('Block helper #each requires an argument');
  // Only each/with and named paths (`{{#character}}`) move the context; conditionals keep it.
  const changesContext = name === 'each' || name === 'with' || !helperNames.has(name);
  walkProgram(block.program, [...scopes, { changesContext, blockParams: block.program.blockParams ?? [] }], analysis);
  if (block.inverse) walkProgram(block.inverse, scopes, analysis);
}

function walkCall(
  path: AST.Expression,
  params: AST.Expression[],
  hash: AST.Hash,
  scopes: Scope[],
  analysis: TemplateAnalysis,
): void {
  if (path.type === 'PathExpression') {
    const name = (path as AST.PathExpression).original;
    if (!helperNames.has(name)) {
      // Handlebars throws "Missing helper" at render time when arguments are passed to an unknown name.
      if (params.length > 0) analysis.problems.push(`Unknown helper: ${name}`);
      else walkPath(path as AST.PathExpression, scopes, analysis);
    }
  } else {
    walkExpression(path, scopes, analysis);
  }
  for (const param of params) walkExpression(param, scopes, analysis);
  // The parser leaves `hash` undefined on plain paths such as `{{name}}`, despite its declared type.
  for (const pair of hash?.pairs ?? []) walkExpression(pair.value, scopes, analysis);
}

function walkExpression(node: AST.Expression, scopes: Scope[], analysis: TemplateAnalysis): void {
  if (node.type === 'PathExpression') walkPath(node as AST.PathExpression, scopes, analysis);
  else if (node.type === 'SubExpression') {
    const sub = node as AST.SubExpression;
    walkCall(sub.path, sub.params, sub.hash, scopes, analysis);
  }
  // Literals reference nothing.
}

function walkPath(path: AST.PathExpression, scopes: Scope[], analysis: TemplateAnalysis): void {
  // `@index`-style data variables and `this`/`./` refer to the current item rather than a named value.
  if (path.data || path.original === 'this' || path.original.startsWith('this.') || path.original.startsWith('./'))
    return;
  if (path.parts.length === 0 || path.parts.some((part) => typeof part !== 'string')) return;
  const head = path.parts[0] as string;
  if (path.depth === 0 && scopes.some((scope) => scope.blockParams.includes(head))) return;
  const depth = scopes.filter((scope) => scope.changesContext).length;
  analysis.references.push({
    expression: `{{${path.original}}}`,
    name: path.parts.join('.'),
    root: path.depth === depth,
  });
}
