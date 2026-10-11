/** Splits a Server-Sent Events body into its event names and parsed JSON data. */
export function parseEventStream(body: string): { event: string; data: { type: string } & Record<string, unknown> }[] {
  return body
    .split('\n\n')
    .filter((block) => block.length > 0)
    .map((block) => {
      const event = block
        .split('\n')
        .find((line) => line.startsWith('event: '))
        ?.slice('event: '.length);
      const data = block
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      if (event === undefined || data === undefined) throw new Error(`Malformed event: ${block}`);
      return { event, data: JSON.parse(data) };
    });
}
