import { RAINDROP_API_BASE_URL } from '../config/constants.js';
import { env } from '../config/env.js';
import type {
  RaindropBookmark,
  RaindropCollection,
  RaindropCollectionsResponse,
  RaindropListResponse,
  RaindropSingleResponse,
  RaindropTagsResponse,
} from '../types/raindrop.js';
import { logger } from '../utils/logger.js';
import { AdaptiveRateLimiter } from '../utils/rate-limiter.js';

export interface GetRaindropsParams {
  search?: string;
  sort?: string;
  page?: number;
  perpage?: number;
  nested?: boolean;
}

export class RaindropApiClient {
  private token: string;
  private rateLimiter: AdaptiveRateLimiter;

  constructor(token: string = env.RAINDROP_TOKEN) {
    this.token = token;
    this.rateLimiter = new AdaptiveRateLimiter();
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.rateLimiter.acquire();

    const url = `${RAINDROP_API_BASE_URL}${endpoint}`;
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Update adaptive rate limiter with response headers
    this.rateLimiter.updateFromHeaders(response.headers);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `Raindrop API Error [${response.status} ${response.statusText}] at ${endpoint}: ${errorText}`
      );
      throw new Error(
        `Raindrop API Error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Get raindrops from a collection (use collectionId=0 for all non-trash).
   */
  async getRaindrops(
    collectionId = 0,
    params: GetRaindropsParams = {}
  ): Promise<RaindropListResponse> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.perpage !== undefined) query.set('perpage', String(params.perpage));
    if (params.nested) query.set('nested', 'true');

    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.request<RaindropListResponse>(`/raindrops/${collectionId}${queryString}`);
  }

  /**
   * Get single bookmark by ID.
   */
  async getRaindrop(id: number): Promise<RaindropSingleResponse> {
    return this.request<RaindropSingleResponse>(`/raindrop/${id}`);
  }

  /**
   * Update single bookmark fields (tags, notes, collection, title, etc.).
   */
  async updateRaindrop(
    id: number,
    payload: Partial<RaindropBookmark>
  ): Promise<RaindropSingleResponse> {
    return this.request<RaindropSingleResponse>(`/raindrop/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Batch delete raindrops within a specific collection.
   * Note: collectionId=0 is rejected by Raindrop.
   */
  async batchDeleteRaindrops(
    collectionId: number,
    ids: number[]
  ): Promise<{ result: boolean }> {
    if (collectionId === 0) {
      throw new Error(
        'Raindrop API does not support bulk delete on collection 0 (All). Group by collection ID first.'
      );
    }
    if (!ids.length) return { result: true };

    return this.request<{ result: boolean }>(`/raindrops/${collectionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  }

  /**
   * Remove a single bookmark to Trash.
   */
  async deleteRaindrop(id: number): Promise<{ result: boolean }> {
    return this.request<{ result: boolean }>(`/raindrop/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get user root collections.
   */
  async getCollections(): Promise<RaindropCollectionsResponse> {
    return this.request<RaindropCollectionsResponse>('/collections');
  }

  /**
   * Get user nested/child collections.
   */
  async getChildCollections(): Promise<RaindropCollectionsResponse> {
    return this.request<RaindropCollectionsResponse>('/collections/childrens');
  }

  /**
   * Create a new collection.
   */
  async createCollection(
    title: string,
    parentId?: number
  ): Promise<{ result: boolean; item: RaindropCollection }> {
    const body: Record<string, any> = { title };
    if (parentId && parentId > 0) {
      body.parent = { $id: parentId };
    }

    return this.request<{ result: boolean; item: RaindropCollection }>('/collection', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a custom collection by ID.
   */
  async deleteCollection(id: number): Promise<{ result: boolean }> {
    if (id <= 0) {
      throw new Error(`Cannot delete system collection #${id}`);
    }
    return this.request<{ result: boolean }>(`/collection/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get all tags and their frequency counts.
   */
  async getTags(collectionId = 0): Promise<RaindropTagsResponse> {
    return this.request<RaindropTagsResponse>(`/tags/${collectionId}`);
  }

  /**
   * Globally rename/replace a list of tags to a new name across all bookmarks in a collection (0 = all).
   */
  async renameTags(
    collectionId = 0,
    tags: string[],
    replaceWith: string
  ): Promise<{ result: boolean }> {
    if (tags.length === 0) return { result: true };
    return this.request<{ result: boolean }>(`/tags/${collectionId}`, {
      method: 'PUT',
      body: JSON.stringify({ tags, replace: replaceWith }),
    });
  }

  /**
   * Globally delete/purge tags from all bookmarks in a collection (0 = all).
   */
  async deleteTags(collectionId = 0, tags: string[]): Promise<{ result: boolean }> {
    if (tags.length === 0) return { result: true };
    return this.request<{ result: boolean }>(`/tags/${collectionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ tags }),
    });
  }
}

export const raindropClient = new RaindropApiClient();
