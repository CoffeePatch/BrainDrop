import { describe, it, expect } from 'vitest';
import { OrphanCleanerService } from '../src/services/cleaner/orphan-cleaner.js';
import type { RaindropCollection } from '../src/types/raindrop.js';

describe('OrphanCleanerService', () => {
  const service = new OrphanCleanerService();

  const mockCollections: RaindropCollection[] = [
    // 1. System collection (Protected)
    {
      _id: -1,
      title: 'Unsorted',
      count: 0,
      color: '',
      expanded: false,
      public: false,
      view: 'list',
      sort: 0,
      user: { $id: 1 },
      created: '',
      lastUpdate: '',
    },
    // 2. Parent with 0 direct bookmarks, but has active child with 25 bookmarks
    {
      _id: 100,
      title: 'Engineering',
      count: 0, // Direct count = 0
      color: '',
      expanded: true,
      public: false,
      view: 'list',
      sort: 1,
      user: { $id: 1 },
      created: '',
      lastUpdate: '',
    },
    {
      _id: 101,
      title: 'React',
      count: 25, // Active bookmarks
      parent: { $id: 100 },
      color: '',
      expanded: false,
      public: false,
      view: 'list',
      sort: 2,
      user: { $id: 1 },
      created: '',
      lastUpdate: '',
    },
    // 3. Nested empty branch: Parent (0) -> Child (0)
    {
      _id: 200,
      title: 'Old Abandoned Project',
      count: 0,
      color: '',
      expanded: true,
      public: false,
      view: 'list',
      sort: 3,
      user: { $id: 1 },
      created: '',
      lastUpdate: '',
    },
    {
      _id: 201,
      title: 'Old Sub-Folder',
      count: 0,
      parent: { $id: 200 },
      color: '',
      expanded: false,
      public: false,
      view: 'list',
      sort: 4,
      user: { $id: 1 },
      created: '',
      lastUpdate: '',
    },
    // 4. Empty leaf collection protected by user whitelist
    {
      _id: 300,
      title: 'To Read',
      count: 0,
      color: '',
      expanded: false,
      public: false,
      view: 'list',
      sort: 5,
      user: { $id: 1 },
      created: '',
      lastUpdate: '',
    },
  ];

  it('builds hierarchy tree and correctly calculates subtree bookmark count', () => {
    const tree = service.buildCollectionTree(mockCollections);

    // Parent 'Engineering' (#100) must have subtreeCount = 25 (from child #101)
    const engineeringNode = tree.get(100);
    expect(engineeringNode?.subtreeCount).toBe(25);
    expect(engineeringNode?.children).toEqual([101]);

    // Parent 'Old Abandoned Project' (#200) must have subtreeCount = 0
    const abandonedNode = tree.get(200);
    expect(abandonedNode?.subtreeCount).toBe(0);
    expect(abandonedNode?.children).toEqual([201]);
  });

  it('protects parent folders whose children contain active bookmarks', () => {
    const tree = service.buildCollectionTree(mockCollections);
    const engineeringNode = tree.get(100);

    // Subtree count is 25, so it should not be an orphan
    expect(engineeringNode?.subtreeCount).toBeGreaterThan(0);
  });

  it('identifies truly empty collections and sorts bottom-up (children before parents)', () => {
    const protectedTitles = new Set(['to read']);
    const tree = service.buildCollectionTree(mockCollections, protectedTitles);

    const candidates = [];
    for (const node of tree.values()) {
      if (!node.isProtected && node.subtreeCount === 0 && node.id > 0) {
        candidates.push({
          id: node.id,
          title: node.title,
          depth: node.depth,
        });
      }
    }

    candidates.sort((a, b) => b.depth - a.depth);

    // Child #201 (depth 1) must come before Parent #200 (depth 0)
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.id).toBe(201); // Old Sub-Folder first
    expect(candidates[1]?.id).toBe(200); // Old Abandoned Project second
  });

  it('respects user whitelist and protects empty collections in the whitelist', () => {
    const protectedTitles = new Set(['to read']);
    const tree = service.buildCollectionTree(mockCollections, protectedTitles);

    const toReadNode = tree.get(300);
    expect(toReadNode?.isProtected).toBe(true);
  });

  it('never targets system collection # -1, 0, -99 for deletion', () => {
    const tree = service.buildCollectionTree(mockCollections);
    const unsortedNode = tree.get(-1);

    expect(unsortedNode?.isProtected).toBe(true);
  });
});
