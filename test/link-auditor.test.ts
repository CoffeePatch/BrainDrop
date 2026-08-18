import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkAuditorService } from '../src/services/links/link-auditor.js';
import type { FirestoreBookmark } from '../src/types/firestore.js';

describe('LinkAuditorService', () => {
  const service = new LinkAuditorService();

  const createMockBookmark = (id: number, link: string): FirestoreBookmark => ({
    _id: id,
    link,
    title: `Bookmark ${id}`,
    excerpt: '',
    note: '',
    type: 'link',
    tags: [],
    cover: '',
    media: [],
    highlights: [],
    domain: 'example.com',
    important: false,
    broken: false,
    sort: id,
    created: '2026-01-01T00:00:00Z',
    lastUpdate: '2026-01-01T00:00:00Z',
    canonical_url: link,
    url_hash: `h_${id}`,
    synced_at: '2026-01-01T00:00:00Z',
    collection: { $id: -1 },
    user: { $id: 1 },
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('probes a healthy URL successfully (200 OK)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      url: 'https://example.com',
    } as any);

    const bookmark = createMockBookmark(1, 'https://example.com');
    const result = await service.probeUrl(bookmark);

    expect(result.bookmarkId).toBe(1);
    expect(result.httpStatus).toBe(200);
    expect(result.isBroken).toBe(false);
    expect(result.isRedirect).toBe(false);
  });

  it('detects permanent 301 redirects and captures destination URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      url: 'https://example.com/new-location',
    } as any);

    const bookmark = createMockBookmark(2, 'https://example.com/old-location');
    const result = await service.probeUrl(bookmark);

    expect(result.isRedirect).toBe(true);
    expect(result.finalUrl).toBe('https://example.com/new-location');
    expect(result.isBroken).toBe(false);
  });

  it('identifies 404 dead links as broken', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 404,
      url: 'https://example.com/dead-page',
    } as any);

    const bookmark = createMockBookmark(3, 'https://example.com/dead-page');
    const result = await service.probeUrl(bookmark);

    expect(result.httpStatus).toBe(404);
    expect(result.isBroken).toBe(true);
  });
});
