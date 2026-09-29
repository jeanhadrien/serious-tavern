import type { ApiEndpoint, ApiResponse } from '@st/shared';

export type ApiRoute<K extends ApiEndpoint> = { Reply: ApiResponse<K> };
