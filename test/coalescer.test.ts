import { describe, it, expect } from 'vitest';
import { MutationCoalescer } from '../src/services/pipeline/coalescer.js';
import { KeeperStrategy } from '../src/types/duplicate.js';
import type { DuplicateMutationPlan } from '../src/types/duplicate.js';
import type { CategorizationMatch } from '../src/types/rules.js';

describe('MutationCoalescer Service', () => {
  const coalescer = new MutationCoalescer();

  it('coalesces multiple mutations on the same bookmark into 1 combined update', () => {
    // 1. Duplicate Keeper mutation on Bookmark #101
    const duplicatePlans: DuplicateMutationPlan[] = [
      {
        clusterHash: 'hash1',
        canonicalUrl: 'https://example.com/item1',
        strategy: KeeperStrategy.KEEP_NEWEST_INHERIT_OLD,
        keeper: {
          id: 101,
          currentCollectionId: -1,
          targetCollectionId: -1,
          existingTags: ['initial'],
          mergedTags: ['initial', 'inherited:tag'],
          mergedNote: 'Old note',
          mergedImportant: false,
          requiresUpdate: true,
        },
        duplicatesToTrash: [
          {
            id: 102,
            collectionId: -1,
            title: 'Old copy',
            link: 'https://example.com/item1',
            created: '2025-01-01',
            rawPayload: {} as any,
          },
        ],
      },
    ];

    // 2. Categorization match on the SAME Bookmark #101
    const categorizationMatches: CategorizationMatch[] = [
      {
        bookmarkId: 101,
        originalLink: 'https://example.com/item1',
        title: 'Item 1',
        matchedRuleName: 'Folder Routing',
        matchedPattern: 'example.com',
        currentCollectionId: -1,
        targetCollectionId: 500, // Move to Collection 500
        targetCollectionName: 'Curated',
        isNewCollection: false,
        existingTags: ['initial'],
        tagsToAdd: ['categorized:tag'],
        finalTags: ['initial', 'categorized:tag'],
        requiresMutation: true,
      },
    ];

    const plan = coalescer.coalesce(duplicatePlans, categorizationMatches);

    // Must coalesce to EXACTLY 1 bookmark update
    expect(plan.bookmarksToUpdate).toHaveLength(1);

    const update = plan.bookmarksToUpdate[0]!;
    expect(update.bookmarkId).toBe(101);
    expect(update.targetCollectionId).toBe(500);
    expect(update.finalTags.sort()).toEqual(
      ['initial', 'inherited:tag', 'categorized:tag'].sort()
    );
    expect(update.mergedNote).toBe('Old note');
    expect(update.sourceEngines).toEqual(['Deduplication', 'Categorization']);

    // 2 raw calls coalesced into 1 -> saved 1 API call
    expect(plan.apiCallsSavedByCoalescing).toBe(1);
  });

  it('cancels and discards any updates targeting bookmarks marked for Trash', () => {
    const duplicatePlans: DuplicateMutationPlan[] = [
      {
        clusterHash: 'hash2',
        canonicalUrl: 'https://example.com/item2',
        strategy: KeeperStrategy.KEEP_NEWEST_INHERIT_OLD,
        keeper: {
          id: 201,
          currentCollectionId: -1,
          targetCollectionId: -1,
          existingTags: [],
          mergedTags: [],
          mergedImportant: false,
          requiresUpdate: false,
        },
        duplicatesToTrash: [
          {
            id: 202, // Targeted for Trash
            collectionId: -1,
            title: 'Trash Candidate',
            link: 'https://example.com/item2',
            created: '2024-01-01',
            rawPayload: {} as any,
          },
        ],
      },
    ];

    // Categorization tried to tag the bookmark that is being trashed (202)
    const categorizationMatches: CategorizationMatch[] = [
      {
        bookmarkId: 202, // Matches duplicate that is being deleted
        originalLink: 'https://example.com/item2',
        title: 'Trash Candidate',
        matchedRuleName: 'Rule',
        matchedPattern: 'example.com',
        currentCollectionId: -1,
        targetCollectionId: 300,
        isNewCollection: false,
        existingTags: [],
        tagsToAdd: ['tag'],
        finalTags: ['tag'],
        requiresMutation: true,
      },
    ];

    const plan = coalescer.coalesce(duplicatePlans, categorizationMatches);

    // Update for #202 must be cancelled
    expect(plan.bookmarksToUpdate).toHaveLength(0);
    expect(plan.cancelledUpdatesOnTrashCount).toBe(1);
    expect(plan.totalDuplicatesToTrash).toBe(1);
  });

  it('batches action: "trash" matches from categorizer into batch deletion chunks', () => {
    const duplicatePlans: DuplicateMutationPlan[] = [];
    const categorizationMatches: CategorizationMatch[] = [
      {
        bookmarkId: 301,
        originalLink: 'chrome://newtab',
        title: 'New Tab',
        matchedRuleName: 'Default Garbage Shield',
        matchedPattern: 'chrome://',
        currentCollectionId: -1,
        isNewCollection: false,
        existingTags: [],
        tagsToAdd: [],
        finalTags: [],
        requiresMutation: true,
        action: 'trash',
        isTrashCandidate: true,
      },
      {
        bookmarkId: 302,
        originalLink: 'http://localhost:3000',
        title: 'Localhost',
        matchedRuleName: 'Default Garbage Shield',
        matchedPattern: 'localhost',
        currentCollectionId: -1,
        isNewCollection: false,
        existingTags: [],
        tagsToAdd: [],
        finalTags: [],
        requiresMutation: true,
        action: 'trash',
        isTrashCandidate: true,
      },
    ];

    const plan = coalescer.coalesce(duplicatePlans, categorizationMatches);

    expect(plan.bookmarksToUpdate).toHaveLength(0);
    expect(plan.totalDuplicatesToTrash).toBe(2);
    expect(plan.trashedDuplicatesByCollection).toHaveLength(1);
    expect(plan.trashedDuplicatesByCollection[0]?.duplicateIds).toEqual([301, 302]);
  });
});
