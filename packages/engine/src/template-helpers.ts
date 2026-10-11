import Handlebars from 'handlebars';

// Handlebars appends its options object to every helper call; operands are the arguments before it.
const operands = (args: unknown[]): unknown[] => args.slice(0, -1);

// Same truthiness as `{{#if}}`: falsy values and empty arrays are false, and the string "false" is true.
const isTruthy = (value: unknown): boolean => !!value && !(Array.isArray(value) && value.length === 0);

export function createTemplateEnvironment(): typeof Handlebars {
  const environment = Handlebars.create();
  // Stock `log` writes to the server console; templates should have no side effects.
  delete environment.helpers.log;
  environment.registerHelper({
    // Strict equality: 1 and "1" differ, and strings compare case-sensitively.
    eq: (left: unknown, right: unknown) => left === right,
    ne: (left: unknown, right: unknown) => left !== right,
    // Ordering uses JavaScript's own `<`, `<=`, `>`, `>=` operators.
    lt: (left: any, right: any) => left < right,
    lte: (left: any, right: any) => left <= right,
    gt: (left: any, right: any) => left > right,
    gte: (left: any, right: any) => left >= right,
    and: (...args: unknown[]) => operands(args).every(isTruthy),
    or: (...args: unknown[]) => operands(args).some(isTruthy),
    not: (value: unknown) => !isTruthy(value),
  });
  return environment;
}
