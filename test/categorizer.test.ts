import { describe, it, expect } from 'vitest';
import { HierarchicalCategorizerService } from '../src/services/rules/categorizer.js';
import type { HierarchicalRule } from '../src/types/rules.js';
import type { FirestoreBookmark } from '../src/types/firestore.js';

describe('HierarchicalCategorizerService', () => {
  const service = new HierarchicalCategorizerService();

  const mockRules: HierarchicalRule[] = [
    {
      name: 'JAV Media & Series',
      domain: 'javtrailers.com',
      targetCollection: 'JAV',
      tags: ['type:jav'],
      subpaths: [
        {
          pattern: '/series/*',
          tags: ['type:series'],
        },
        {
          pattern: '/search/*',
          tags: ['type:search'],
        },
        {
          pattern: '/special/*',
          overrideTags: ['exclusive:special'],
          targetCollection: 'JAV / Special Edition',
        },
      ],
    },
    {
      name: 'Tags Only Rule (No Collection)',
      domain: 'vimeo.com',
      tags: ['video', 'media'],
    },
  ];

  const createMockBookmark = (
    id: number,
    link: string,
    collectionId = -1,
    existingTags: string[] = []
  ): FirestoreBookmark => ({
    _id: id,
    link,
    title: `Bookmark #${id}`,
    excerpt: '',
    note: '',
    type: 'link',
    tags: existingTags,
    cover: '',
    media: [],
    highlights: [],
    domain: new URL(link).hostname,
    important: false,
    broken: false,
    sort: id,
    created: '2026-01-01T00:00:00Z',
    lastUpdate: '2026-01-01T00:00:00Z',
    canonical_url: link,
    url_hash: `hash_${id}`,
    synced_at: '2026-01-01T00:00:00Z',
    collection: { $id: collectionId },
    user: { $id: 1 },
  });

  it('inherits base collection and base tags for root domain matches', () => {
    const bookmark = createMockBookmark(1, 'https://javtrailers.com/');
    const match = service.evaluateBookmark(bookmark, mockRules);

    expect(match).not.toBeNull();
    expect(match?.targetCollectionName).toBe('JAV');
    expect(match?.finalTags).toEqual(['type:jav']);
    expect(match?.tagsToAdd).toEqual(['type:jav']);
  });

  it('cascades subpath: inherits parent collection and merges parent + subpath tags', () => {
    const bookmark = createMockBookmark(2, 'https://javtrailers.com/series/sdde-325');
    const match = service.evaluateBookmark(bookmark, mockRules);

    expect(match).not.toBeNull();
    expect(match?.targetCollectionName).toBe('JAV');
    expect(match?.finalTags).toEqual(['type:jav', 'type:series']);
    expect(match?.tagsToAdd).toEqual(['type:jav', 'type:series']);
  });

  it('handles overrideTags on subpath to replace parent tags', () => {
    const bookmark = createMockBookmark(3, 'https://javtrailers.com/special/vip-01');
    const match = service.evaluateBookmark(bookmark, mockRules);

    expect(match).not.toBeNull();
    expect(match?.targetCollectionName).toBe('JAV / Special Edition');
    expect(match?.finalTags).toEqual(['exclusive:special']);
  });

  it('applies tags without changing collection when rule has no targetCollection', () => {
    const bookmark = createMockBookmark(4, 'https://vimeo.com/123456', 500); // in curated folder 500
    const match = service.evaluateBookmark(bookmark, mockRules);

    expect(match).not.toBeNull();
    expect(match?.targetCollectionName).toBeUndefined();
    expect(match?.finalTags).toEqual(['video', 'media']);
    expect(match?.tagsToAdd).toEqual(['video', 'media']);
  });

  it('does not overwrite collection for already-curated bookmarks unless forced', () => {
    const curatedBookmark = createMockBookmark(5, 'https://javtrailers.com/series/abc', 72869650);
    
    // Default (no overwrite)
    const matchNormal = service.evaluateBookmark(curatedBookmark, mockRules, false);
    expect(matchNormal?.targetCollectionName).toBeUndefined(); // Folder preserved
    expect(matchNormal?.finalTags).toEqual(['type:jav', 'type:series']); // Tags still added

    // With overwriteExisting = true
    const matchForced = service.evaluateBookmark(curatedBookmark, mockRules, true);
    expect(matchForced?.targetCollectionName).toBe('JAV');
  });

  it('deduplicates existing tags with case insensitivity', () => {
    const bookmark = createMockBookmark(6, 'https://javtrailers.com/search?q=test', -1, ['Type:JAV']);
    const match = service.evaluateBookmark(bookmark, mockRules);

    expect(match).not.toBeNull();
    expect(match?.tagsToAdd).toEqual(['type:search']); // Does not duplicate Type:JAV
    expect(match?.finalTags).toEqual(['Type:JAV', 'type:search']);
  });
});
