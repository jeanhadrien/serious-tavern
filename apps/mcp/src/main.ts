import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

// stdout belongs to the protocol: anything we want to say goes to stderr.
const baseUrl = process.env.SERIOUS_TAVERN_URL ?? 'http://127.0.0.1:3001';
const server = await createMcpServer({ baseUrl });
await server.connect(new StdioServerTransport());
console.error(`Serious Tavern MCP server ready, talking to ${baseUrl}`);
