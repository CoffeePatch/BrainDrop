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

  it('supports regex patterns directly inside "domain"', () => {
    const regexDomainRules: HierarchicalRule[] = [
      {
        name: 'Multi-Domain Regex Match',
        domain: '(javtrailers|javlibrary)\\.com',
        targetCollection: 'JAV Archive',
        tags: ['type:jav'],
      },
    ];

    const bookmark1 = createMockBookmark(10, 'https://javlibrary.com/en/');
    const bookmark2 = createMockBookmark(11, 'https://javtrailers.com/video/123');

    const match1 = service.evaluateBookmark(bookmark1, regexDomainRules);
    const match2 = service.evaluateBookmark(bookmark2, regexDomainRules);

    expect(match1).not.toBeNull();
    expect(match1?.targetCollectionName).toBe('JAV Archive');

    expect(match2).not.toBeNull();
    expect(match2?.targetCollectionName).toBe('JAV Archive');
  });

  it('supports wildcard glob patterns in "domain"', () => {
    const wildcardRules: HierarchicalRule[] = [
      {
        name: 'Wildcard Subdomain',
        domain: '*.medium.com',
        targetCollection: 'Articles',
        tags: ['article'],
      },
    ];

    const bookmark = createMockBookmark(20, 'https://betterprogramming.medium.com/clean-code');
    const match = service.evaluateBookmark(bookmark, wildcardRules);

    expect(match).not.toBeNull();
    expect(match?.targetCollectionName).toBe('Articles');
  });

  it('automatically catches built-in garbage tabs (chrome://, about:blank, localhost)', () => {
    const chromeTab = createMockBookmark(30, 'chrome://newtab/');
    const blankTab = createMockBookmark(31, 'about:blank');
    const localTab = createMockBookmark(32, 'http://localhost:5173/dashboard');
    const raindropApp = createMockBookmark(33, 'https://app.raindrop.io/my/0');

    const match1 = service.evaluateBookmark(chromeTab, []);
    const match2 = service.evaluateBookmark(blankTab, []);
    const match3 = service.evaluateBookmark(localTab, []);
    const match4 = service.evaluateBookmark(raindropApp, []);

    expect(match1?.action).toBe('trash');
    expect(match1?.isTrashCandidate).toBe(true);

    expect(match2?.action).toBe('trash');
    expect(match2?.isTrashCandidate).toBe(true);

    expect(match3?.action).toBe('trash');
    expect(match3?.isTrashCandidate).toBe(true);

    expect(match4?.action).toBe('trash');
    expect(match4?.isTrashCandidate).toBe(true);
  });

  it('respects user defined action: "trash" blacklist rules', () => {
    const blacklistRules: HierarchicalRule[] = [
      {
        name: 'Blacklist Spam & Trackers',
        domain: '(spamlink|tracking-hub)\\.com',
        action: 'trash',
      },
    ];

    const bookmark = createMockBookmark(40, 'https://spamlink.com/click?id=123');
    const match = service.evaluateBookmark(bookmark, blacklistRules);

    expect(match).not.toBeNull();
    expect(match?.action).toBe('trash');
    expect(match?.isTrashCandidate).toBe(true);
  });
});
