import { describe, it, expect } from 'vitest';
import { keeperResolver } from '../src/services/duplicate/keeper-resolver.js';
import { KeeperStrategy } from '../src/types/duplicate.js';
import type { DuplicateCluster } from '../src/types/duplicate.js';
import type { FirestoreBookmark } from '../src/types/firestore.js';

describe('KeeperResolver Service', () => {
  const createMockBookmark = (
    id: number,
    created: string,
    collectionId: number,
    tags: string[],
    note: string = '',
    important: boolean = false,
    highlights: any[] = []
  ): FirestoreBookmark => ({
    _id: id,
    link: 'https://example.com/clean-code',
    title: `Bookmark ${id}`,
    excerpt: 'Description',
    note,
    type: 'link',
    tags,
    cover: '',
    media: [],
    highlights,
    domain: 'example.com',
    important,
    broken: false,
    sort: id,
    created,
    lastUpdate: created,
    canonical_url: 'https://example.com/clean-code',
    url_hash: 'hash123',
    synced_at: new Date().toISOString(),
    collection: { $id: collectionId },
    user: { $id: 1 },
  });

  it('KEEP_NEWEST_INHERIT_OLD: selects newest bookmark as Keeper and inherits tags and collection', () => {
    const oldBookmark = createMockBookmark(
      101,
      '2024-01-01T10:00:00Z',
      500, // Curated collection
      ['architecture', 'clean-code'],
      'Old note about design',
      true
    );

    const newBookmark = createMockBookmark(
      202,
      '2026-08-17T12:00:00Z',
      -1, // Unsorted
      ['react', 'clean-code'],
      'New note',
      false
    );

    const cluster: DuplicateCluster = {
      clusterHash: 'hash123',
      canonicalUrl: 'https://example.com/clean-code',
      bookmarks: [oldBookmark, newBookmark],
    };

    const plan = keeperResolver.resolveCluster(
      cluster,
      KeeperStrategy.KEEP_NEWEST_INHERIT_OLD
    );

    // Keeper must be the newest bookmark (202)
    expect(plan.keeper.id).toBe(202);

    // Collection must be inherited from old bookmark (500)
    expect(plan.keeper.targetCollectionId).toBe(500);

    // Tags must be union of all unique tags
    expect(plan.keeper.mergedTags.sort()).toEqual(
      ['architecture', 'clean-code', 'react'].sort()
    );

    // Important flag must be true (OR union)
    expect(plan.keeper.mergedImportant).toBe(true);

    // Note must concatenate both notes
    expect(plan.keeper.mergedNote).toContain('New note');
    expect(plan.keeper.mergedNote).toContain('Old note about design');

    // Duplicate targeted for trash must be the old bookmark (101)
    expect(plan.duplicatesToTrash).toHaveLength(1);
    expect(plan.duplicatesToTrash[0]?.id).toBe(101);
    expect(plan.duplicatesToTrash[0]?.collectionId).toBe(500);
  });

  it('KEEP_OLDEST_MERGE_NEW: selects oldest bookmark as Keeper', () => {
    const oldBookmark = createMockBookmark(
      101,
      '2023-05-01T10:00:00Z',
      10,
      ['typescript']
    );
    const newBookmark = createMockBookmark(
      202,
      '2026-01-01T10:00:00Z',
      20,
      ['nodejs']
    );

    const cluster: DuplicateCluster = {
      clusterHash: 'hash123',
      canonicalUrl: 'https://example.com/clean-code',
      bookmarks: [oldBookmark, newBookmark],
    };

    const plan = keeperResolver.resolveCluster(
      cluster,
      KeeperStrategy.KEEP_OLDEST_MERGE_NEW
    );

    expect(plan.keeper.id).toBe(101);
    expect(plan.duplicatesToTrash[0]?.id).toBe(202);
    expect(plan.keeper.mergedTags.sort()).toEqual(['nodejs', 'typescript'].sort());
  });

  it('KEEP_RICHEST: selects bookmark with highest annotation density', () => {
    const sparseBookmark = createMockBookmark(
      101,
      '2025-01-01T10:00:00Z',
      -1,
      ['tag1']
    );
    const richBookmark = createMockBookmark(
      102,
      '2024-01-01T10:00:00Z',
      100,
      ['tag1', 'tag2', 'tag3'],
      'Extensive handwritten notes',
      true,
      [{ _id: 'h1', text: 'Important paragraph' }]
    );

    const cluster: DuplicateCluster = {
      clusterHash: 'hash123',
      canonicalUrl: 'https://example.com/clean-code',
      bookmarks: [sparseBookmark, richBookmark],
    };

    const plan = keeperResolver.resolveCluster(
      cluster,
      KeeperStrategy.KEEP_RICHEST
    );

    expect(plan.keeper.id).toBe(102);
    expect(plan.duplicatesToTrash[0]?.id).toBe(101);
  });
});
