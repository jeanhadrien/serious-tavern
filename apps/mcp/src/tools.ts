import { apiContract, type ApiEndpoint, type EndpointInfo, type HttpMethod } from '@st/shared';
import { exposeMap } from './expose.js';
import { requiresBody, takesBody, toJsonSchema, type JsonSchema } from './schema.js';

/** One generated tool: the endpoint it calls and everything the caller needs to build the request. */
export type EndpointTool = {
  name: string;
  endpoint: ApiEndpoint;
  method: HttpMethod;
  path: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  pathParams: string[];
  queryParams: string[];
  hasBody: boolean;
};

/** `listProviderModels` -> `list_provider_models`. */
export const toolName = (endpoint: ApiEndpoint) => endpoint.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const TRIMMED_LIST_NOTE =
  ' Each item is a summary (id or type, name or label, and description); call the matching get_ tool for the full record.';

/** The endpoints agents get, in contract order. */
export const exposedEndpoints = () =>
  (Object.keys(apiContract) as ApiEndpoint[]).filter((key) => typeof exposeMap[key] === 'string');

/** Contract descriptions point at other endpoints by key (`getNodeType`); an agent knows them by tool name. */
function describe(endpoint: ApiEndpoint) {
  const info: EndpointInfo = apiContract[endpoint];
  let text = info.description ?? '';
  for (const other of exposedEndpoints()) text = text.replace(new RegExp(`\\b${other}\\b`, 'g'), toolName(other));
  return endpoint.startsWith('list') ? text + TRIMMED_LIST_NOTE : text;
}

const propertiesOf = (schema: JsonSchema) => (schema.properties ?? {}) as Record<string, JsonSchema>;
const requiredOf = (schema: JsonSchema) => (schema.required ?? []) as string[];

/** Builds the tool of one endpoint: its input is the path params and query fields at top level, plus a nested `body`. */
function buildTool(endpoint: ApiEndpoint): EndpointTool {
  const { method, path, params, query, body } = apiContract[endpoint];
  const paramsSchema = toJsonSchema(params);
  const querySchema = toJsonSchema(query);
  const properties: Record<string, JsonSchema> = { ...propertiesOf(paramsSchema), ...propertiesOf(querySchema) };
  const required = [...requiredOf(paramsSchema), ...requiredOf(querySchema)];
  const pathParams = Object.keys(propertiesOf(paramsSchema));
  const queryParams = Object.keys(propertiesOf(querySchema));
  const hasBody = takesBody(body);
  if (new Set([...pathParams, ...queryParams]).size !== pathParams.length + queryParams.length)
    throw new Error(`${endpoint}: a path parameter and a query field share a name`);
  if (hasBody) {
    if ('body' in properties) throw new Error(`${endpoint}: "body" is reserved for the request body`);
    properties.body = { ...toJsonSchema(body), description: 'The JSON request body.' };
    if (requiresBody(body)) required.push('body');
  }
  return {
    name: toolName(endpoint),
    endpoint,
    method,
    path,
    description: describe(endpoint),
    inputSchema: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
    readOnly: method === 'GET' || exposeMap[endpoint] === 'readonly',
    pathParams,
    queryParams,
    hasBody,
  };
}

/** Every tool generated from the contract. */
export const buildEndpointTools = () => exposedEndpoints().map(buildTool);
