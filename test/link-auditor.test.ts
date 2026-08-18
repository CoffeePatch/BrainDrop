import { describe, it, expect } from 'vitest';
import { LinkAuditorService } from '../src/services/links/link-auditor.js';
import type { FirestoreBookmark } from '../src/types/firestore.js';

describe('LinkAuditorService', () => {
  it('probes a healthy URL successfully', async () => {
    const service = new LinkAuditorService();

    const bookmark: FirestoreBookmark = {
      _id: 1,
      link: 'https://example.com',
      title: 'Example Domain',
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
      sort: 1,
      created: '2026-01-01T00:00:00Z',
      lastUpdate: '2026-01-01T00:00:00Z',
      canonical_url: 'https://example.com',
      url_hash: 'h1',
      synced_at: '2026-01-01T00:00:00Z',
      collection: { $id: -1 },
      user: { $id: 1 },
    };

    const result = await service.probeUrl(bookmark);
    expect(result.bookmarkId).toBe(1);
    expect(result.httpStatus).toBeGreaterThanOrEqual(200);
    expect(result.httpStatus).toBeLessThan(400);
    expect(result.isBroken).toBe(false);
  });
});
