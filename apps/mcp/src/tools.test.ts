import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { apiContract, type ApiEndpoint, type EndpointInfo } from '@st/shared';
import { describe, expect, it } from 'vitest';
import { exposeMap } from './expose.js';
import { buildEndpointTools, exposedEndpoints, toolName } from './tools.js';

const tools = buildEndpointTools();
const byName = (name: string) => tools.find((tool) => tool.name === name)!;
const contractKeys = Object.keys(apiContract) as ApiEndpoint[];

describe('the expose map', () => {
  it('decides every contract endpoint, and only those', () => {
    expect(Object.keys(exposeMap).sort()).toEqual([...contractKeys].sort());
  });

  it('gives a reason for every skipped endpoint', () => {
    for (const [key, entry] of Object.entries(exposeMap))
      if (typeof entry !== 'string') expect(entry.skip.length, key).toBeGreaterThan(10);
  });

  it('exposes the v1 scope', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        'list_presets',
        'get_preset',
        'create_preset',
        'update_preset',
        'preview_preset',
        'list_workflows',
        'get_workflow',
        'create_workflow',
        'update_workflow',
        'validate_workflow',
        'list_node_types',
        'get_node_type',
        'resolve_ports',
        'list_characters',
        'get_character',
        'create_character',
        'update_character',
        'list_personas',
        'get_persona',
        'create_persona',
        'update_persona',
        'list_providers',
        'get_provider',
        'list_provider_models',
        'list_state_definitions',
        'get_state_definition',
        'list_collections',
        'get_collection',
      ].sort(),
    );
  });

  it('never exposes a delete, a secret or a binary endpoint', () => {
    for (const key of exposedEndpoints()) {
      expect(apiContract[key].method, key).not.toBe('DELETE');
      expect(key, key).not.toMatch(/secret|avatar|import|export/i);
    }
  });
});

describe('the generated tools', () => {
  it('have unique snake_case names derived from the endpoint key', () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(toolName('listProviderModels')).toBe('list_provider_models');
  });

  it('describe themselves from the contract', () => {
    for (const tool of tools) {
      expect((apiContract[tool.endpoint] as EndpointInfo).description, tool.endpoint).toBeTruthy();
    }
  });

  it('talk about other tools by their tool name, never by endpoint key', () => {
    const keysInText = contractKeys.filter((key) =>
      tools.some((tool) => new RegExp(`\\b${key}\\b`).test(tool.description)),
    );
    expect(keysInText).toEqual([]);
    expect(byName('list_node_types').description).toContain('get_node_type');
    expect(byName('get_node_type').description).toContain('resolve_ports');
  });

  it('take path params and query fields at top level, and the body nested under "body"', () => {
    const update = byName('update_character');
    expect(update.pathParams).toEqual(['id']);
    const properties = update.inputSchema.properties as Record<string, any>;
    expect(Object.keys(properties).sort()).toEqual(['body', 'id']);
    expect(properties.id.format).toBe('uuid');
    expect(properties.body.properties.name).toBeDefined();
    // A partial update: no field of the record is required.
    expect(properties.body.required).toBeUndefined();
    expect(update.inputSchema.required).toEqual(['id', 'body']);

    const models = byName('list_provider_models');
    expect(models.queryParams).toEqual(['refresh']);
    expect(Object.keys(models.inputSchema.properties as object).sort()).toEqual(['id', 'refresh']);
    expect(models.inputSchema.required).toEqual(['id']);
  });

  it('take no "body" when the endpoint has none, instead of an empty one', () => {
    for (const name of ['list_presets', 'get_workflow', 'validate_workflow', 'get_node_type']) {
      const tool = byName(name);
      expect(tool.hasBody, name).toBe(false);
      expect(tool.inputSchema.properties, name).not.toHaveProperty('body');
    }
    expect(byName('validate_workflow').inputSchema).toEqual({
      type: 'object',
      properties: { id: expect.objectContaining({ type: 'string' }) },
      required: ['id'],
    });
    expect(byName('create_preset').hasBody).toBe(true);
  });

  it('flag reads as read-only, including the POSTs that only read', () => {
    const readOnly = tools.filter((tool) => tool.readOnly).map((tool) => tool.name);
    expect(readOnly).toEqual(expect.arrayContaining(['list_presets', 'preview_preset', 'validate_workflow']));
    expect(readOnly).toEqual(expect.arrayContaining(['resolve_ports', 'get_node_type']));
    for (const name of ['create_preset', 'update_workflow', 'update_persona']) expect(readOnly).not.toContain(name);
  });

  it('have plain, self-contained input schemas that clients can compile', () => {
    const validator = new AjvJsonSchemaValidator();
    for (const tool of tools) {
      const text = JSON.stringify(tool.inputSchema);
      // The body is nested, so a pointer into the document would break: everything must be inline.
      expect(text, tool.name).not.toMatch(/\$ref|\$defs|"definitions"|\$schema|propertyNames/);
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(() => validator.getValidator(tool.inputSchema), tool.name).not.toThrow();
    }
  });

  it('accept what the API accepts: a workflow without positions, a partial character', () => {
    const validator = new AjvJsonSchemaValidator();
    const create = validator.getValidator(byName('create_workflow').inputSchema);
    const body = { name: 'W', nodes: [{ id: 'a', type: 'chat-input', config: {} }], edges: [] };
    expect(create({ body }).valid).toBe(true);
    expect(create({}).valid).toBe(false);
    const update = validator.getValidator(byName('update_character').inputSchema);
    expect(update({ id: '6f1c7a0e-2f4d-4a3c-9a55-1b9c2f0d7e11', body: { personality: 'dry' } }).valid).toBe(true);
  });
});
