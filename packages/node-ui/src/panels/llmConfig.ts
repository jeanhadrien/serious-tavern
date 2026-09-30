export function updateNumericOption(
  config: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  const next = { ...config };
  if (value === '') delete next[key];
  else next[key] = Number(value);
  return next;
}

export function parseStopSequences(value: string): string[] | undefined {
  return value ? value.split('\n').filter(Boolean) : undefined;
}
