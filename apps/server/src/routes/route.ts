import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
  RouteHandlerMethod,
  RouteShorthandOptions,
} from 'fastify';
import { apiContract, type ApiEndpoint, type ApiResponse } from '@st/shared';

export type ApiRoute<K extends ApiEndpoint> = { Reply: ApiResponse<K> };

type Handler<K extends ApiEndpoint> = RouteHandlerMethod<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  ApiRoute<K>
>;
type Options<K extends ApiEndpoint> = RouteShorthandOptions<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  ApiRoute<K>
>;

/**
 * Registers the handler of a contract endpoint. Method and path come from the contract, so a route cannot sit at a
 * path the contract doesn't name. `options` are Fastify route options (`bodyLimit`, ...).
 */
export function route<K extends ApiEndpoint>(app: FastifyInstance, key: K, handler: Handler<K>, options?: Options<K>) {
  const { method, path } = apiContract[key];
  app.route<ApiRoute<K>>({ ...options, method, url: path, handler, config: { contractKey: key } });
}

/**
 * Makes `route` the only way to serve an `/api` path: any other registration on this app throws at startup.
 * Add it before the routes. (Fastify's own HEAD twin of a GET route carries the GET's config.)
 */
export function requireContractRoutes(app: FastifyInstance) {
  app.addHook('onRoute', (options) => {
    if (options.url.startsWith('/api/') && !(options.config as { contractKey?: string } | undefined)?.contractKey)
      throw new Error(`${options.method} ${options.url} is not registered through route() from the API contract`);
  });
}
