import { describe, it, expect } from 'vitest';
import { RuleEngineService } from '../src/services/rules/rule-engine.js';
import type { DomainRule } from '../src/config/rules.js';
import type { FirestoreBookmark } from '../src/types/firestore.js';

describe('RuleEngineService', () => {
  const service = new RuleEngineService();

  const rules: DomainRule[] = [
    {
      id: 'github-rule',
      name: 'GitHub Code',
      domains: ['github.com'],
      tagsToAdd: ['code', 'git'],
      targetCollectionName: 'Development',
    },
    {
      id: 'arxiv-rule',
      name: 'ArXiv Papers',
      domains: ['arxiv.org'],
      tagsToAdd: ['paper'],
    },
  ];

  const colMap = new Map<string, number>([['development', 500]]);

  it('matches domain, adds missing tags, and routes Unsorted bookmark to collection', () => {
    const bookmark: FirestoreBookmark = {
      _id: 101,
      link: 'https://github.com/facebook/react',
      title: 'React Repository',
      excerpt: '',
      note: '',
      type: 'link',
      tags: ['react'],
      cover: '',
      media: [],
      highlights: [],
      domain: 'github.com',
      important: false,
      broken: false,
      sort: 1,
      created: '2026-01-01T00:00:00Z',
      lastUpdate: '2026-01-01T00:00:00Z',
      canonical_url: 'https://github.com/facebook/react',
      url_hash: 'h1',
      synced_at: '2026-01-01T00:00:00Z',
      collection: { $id: -1 }, // Unsorted
      user: { $id: 1 },
    };

    const action = service.evaluateBookmark(bookmark, rules, colMap);

    expect(action).not.toBeNull();
    expect(action?.bookmarkId).toBe(101);
    expect(action?.tagsToAdd).toEqual(['code', 'git']);
    expect(action?.targetTags).toEqual(['react', 'code', 'git']);
    expect(action?.targetCollectionId).toBe(500);
  });

  it('does not re-add tags if bookmark already possesses all rule tags', () => {
    const bookmark: FirestoreBookmark = {
      _id: 102,
      link: 'https://arxiv.org/abs/2301.00001',
      title: 'Attention Is All You Need',
      excerpt: '',
      note: '',
      type: 'link',
      tags: ['paper', 'ai'],
      cover: '',
      media: [],
      highlights: [],
      domain: 'arxiv.org',
      important: false,
      broken: false,
      sort: 2,
      created: '2026-01-01T00:00:00Z',
      lastUpdate: '2026-01-01T00:00:00Z',
      canonical_url: 'https://arxiv.org/abs/2301.00001',
      url_hash: 'h2',
      synced_at: '2026-01-01T00:00:00Z',
      collection: { $id: 10 },
      user: { $id: 1 },
    };

    const action = service.evaluateBookmark(bookmark, rules, colMap);
    expect(action).toBeNull();
  });
});
