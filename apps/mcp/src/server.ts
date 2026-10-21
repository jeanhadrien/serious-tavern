import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import pkg from '../package.json' with { type: 'json' };
import { callEndpoint, type CallOptions, type ToolOutput } from './call.js';
import { guideText, listGuides, type Guide } from './guides.js';
import { INSTRUCTIONS } from './instructions.js';
import { buildEndpointTools } from './tools.js';

const GUIDE_TOOL_NAME = 'read_guide';

/** The `read_guide` tool: the topics are listed in its description and enumerated in its schema. */
function guideTool(guides: Guide[]): Tool {
  const listing = guides.map((guide) => `${guide.topic}: ${guide.title}`).join('; ');
  return {
    name: GUIDE_TOOL_NAME,
    description: `Read one of the app's user guides in full. Topics: ${listing}.`,
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: guides.map((guide) => guide.topic) } },
      required: ['topic'],
    },
    annotations: { readOnlyHint: true },
  };
}

async function readGuide(guides: Guide[], args: unknown): Promise<ToolOutput> {
  const topic = typeof args === 'object' && args !== null ? (args as { topic?: unknown }).topic : undefined;
  const guide = guides.find((candidate) => candidate.topic === topic);
  if (!guide) return { text: `Unknown topic. Topics: ${guides.map((g) => g.topic).join(', ')}.`, isError: true };
  return { text: await guideText(guide), isError: false };
}

export type McpServerOptions = CallOptions & {
  /** Where the user guides are; defaults to the repository's `docs/`. */
  docsDir?: string;
};

/**
 * The MCP server: one tool per exposed API endpoint (generated from the contract) plus `read_guide`. It holds no state
 * and talks to the running app over HTTP, so any transport can carry it.
 */
export async function createMcpServer(options: McpServerOptions) {
  const endpointTools = buildEndpointTools();
  const guides = await listGuides(options.docsDir).catch((error: unknown) => {
    console.error(`Guides unavailable, read_guide is off: ${error instanceof Error ? error.message : error}`);
    return [] as Guide[];
  });
  const tools: Tool[] = [
    ...endpointTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool['inputSchema'],
      annotations: { readOnlyHint: tool.readOnly },
    })),
    ...(guides.length > 0 ? [guideTool(guides)] : []),
  ];

  const server = new Server(
    { name: pkg.name, version: pkg.version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const endpointTool = endpointTools.find((tool) => tool.name === params.name);
    const output: ToolOutput = endpointTool
      ? await callEndpoint(endpointTool, params.arguments, options)
      : params.name === GUIDE_TOOL_NAME && guides.length > 0
        ? await readGuide(guides, params.arguments).catch((error: unknown) => ({
            text: `The guide could not be read: ${error instanceof Error ? error.message : error}`,
            isError: true,
          }))
        : { text: `Unknown tool: ${params.name}`, isError: true };
    return { content: [{ type: 'text' as const, text: output.text }], isError: output.isError };
  });
  return server;
}
