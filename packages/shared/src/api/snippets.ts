import { z } from 'zod';
import { snippetSchema, snippetWriteSchema } from '../snippet.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

export const snippetEndpoints = {
  // Whole records (snippets are small), in file-name order; clients sort.
  listSnippets: endpoint(
    {
      method: 'GET',
      path: '/api/snippets',
      description: 'List snippets: named template text that any template reads as {{snippets.<name>}}.',
    },
    z.array(snippetSchema),
  ),
  getSnippet: endpoint(
    { method: 'GET', path: '/api/snippets/:id', description: 'Get one snippet.' },
    snippetSchema,
    undefined,
    idParamsSchema,
  ),
  // 409 `SNIPPET_NAME_TAKEN` when another snippet already has the name.
  createSnippet: endpoint(
    {
      method: 'POST',
      path: '/api/snippets',
      description:
        'Create a snippet. Its text is a template rendered where {{snippets.<name>}} is used, with that template’s context (state, settings, character, inputs...). Fails when the name is taken.',
    },
    snippetSchema,
    snippetWriteSchema,
  ),
  // Replaces name, description and text; unknown fields of the stored record survive. Renaming does not update the
  // templates that use the old name. 409 `SNIPPET_NAME_TAKEN` like create.
  updateSnippet: endpoint(
    {
      method: 'PUT',
      path: '/api/snippets/:id',
      description:
        'Replace a snippet’s name, description and text. Renaming does not update templates that use the old name.',
    },
    snippetSchema,
    snippetWriteSchema,
    idParamsSchema,
  ),
  deleteSnippet: endpoint({ method: 'DELETE', path: '/api/snippets/:id' }, noContentSchema, undefined, idParamsSchema),
};
