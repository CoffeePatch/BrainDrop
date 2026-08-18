import { RAINDROP_LIMITS } from '../../config/constants.js';
import type { DuplicateMutationPlan } from '../../types/duplicate.js';
import type { CategorizationMatch } from '../../types/rules.js';
import type { TagAnalysisSummary } from '../tags/tag-normalizer.js';

export interface CoalescedBookmarkUpdate {
  bookmarkId: number;
  originalLink: string;
  title: string;
  currentCollectionId: number;
  targetCollectionId?: number;
  targetCollectionName?: string;
  existingTags: string[];
  tagsToAdd: string[];
  finalTags: string[];
  mergedNote?: string;
  important?: boolean;
  sourceEngines: string[]; // e.g. ['Deduplication', 'Categorization']
}

export interface CollectionBatchDelete {
  collectionId: number;
  duplicateIds: number[];
}

export interface CoalescedMutationPlan {
  totalEstimatedApiCalls: number;
  apiCallsSavedByCoalescing: number;
  bookmarksToUpdate: CoalescedBookmarkUpdate[];
  trashedDuplicatesByCollection: CollectionBatchDelete[];
  totalDuplicatesToTrash: number;
  cancelledUpdatesOnTrashCount: number;
}

export class MutationCoalescer {
  /**
   * Merges multi-engine mutation plans into a single minimal execution plan per bookmark.
   */
  coalesce(
    duplicatePlans: DuplicateMutationPlan[],
    categorizationMatches: CategorizationMatch[],
    tagSummary?: TagAnalysisSummary
  ): CoalescedMutationPlan {
    const trashedIdSet = new Set<number>();
    const trashedByCollectionMap = new Map<number, number[]>();

    // 1. Collect all duplicate IDs marked for Raindrop Trash
    for (const plan of duplicatePlans) {
      for (const dup of plan.duplicatesToTrash) {
        trashedIdSet.add(dup.id);
        const colId = dup.collectionId;
        if (!trashedByCollectionMap.has(colId)) {
          trashedByCollectionMap.set(colId, []);
        }
        trashedByCollectionMap.get(colId)!.push(dup.id);
      }
    }

    const bookmarkMap = new Map<number, CoalescedBookmarkUpdate>();
    let cancelledUpdatesOnTrashCount = 0;
    let rawApiCallsCount = 0;

    // 2. Ingest Duplicate Keeper Updates
    for (const plan of duplicatePlans) {
      const keeper = plan.keeper;
      if (keeper.requiresUpdate) {
        rawApiCallsCount++;
        const targetCollectionId =
          keeper.targetCollectionId > 0 && keeper.targetCollectionId !== keeper.currentCollectionId
            ? keeper.targetCollectionId
            : undefined;

        bookmarkMap.set(keeper.id, {
          bookmarkId: keeper.id,
          originalLink: plan.canonicalUrl,
          title: `Keeper #${keeper.id}`,
          currentCollectionId: keeper.currentCollectionId,
          targetCollectionId,
          existingTags: keeper.existingTags,
          tagsToAdd: keeper.mergedTags.filter((t) => !keeper.existingTags.includes(t)),
          finalTags: [...keeper.mergedTags],
          mergedNote: keeper.mergedNote,
          important: keeper.mergedImportant,
          sourceEngines: ['Deduplication'],
        });
      }
    }

    // 3. Ingest Categorization Matches (Coalescing with Keepers or Auto-Trashing)
    for (const match of categorizationMatches) {
      // If match is an Auto-Trash or Blacklist candidate
      if (match.action === 'trash' || match.isTrashCandidate) {
        trashedIdSet.add(match.bookmarkId);
        const colId = match.currentCollectionId;
        if (!trashedByCollectionMap.has(colId)) {
          trashedByCollectionMap.set(colId, []);
        }
        trashedByCollectionMap.get(colId)!.push(match.bookmarkId);

        // If an update was previously planned on this bookmark, cancel it!
        if (bookmarkMap.has(match.bookmarkId)) {
          bookmarkMap.delete(match.bookmarkId);
          cancelledUpdatesOnTrashCount++;
        }
        continue;
      }

      // RULE 1: Discard any updates on bookmarks scheduled for Trash
      if (trashedIdSet.has(match.bookmarkId)) {
        cancelledUpdatesOnTrashCount++;
        continue;
      }

      rawApiCallsCount++;

      if (bookmarkMap.has(match.bookmarkId)) {
        // Coalesce with existing plan for this bookmark
        const existing = bookmarkMap.get(match.bookmarkId)!;
        existing.sourceEngines.push('Categorization');

        // Merge collection target
        if (match.targetCollectionId && match.targetCollectionId > 0) {
          existing.targetCollectionId = match.targetCollectionId;
          existing.targetCollectionName = match.targetCollectionName;
        }

        // Merge tags with Set union
        const tagSet = new Map<string, string>();
        existing.finalTags.forEach((t) => tagSet.set(t.toLowerCase(), t));
        match.tagsToAdd.forEach((t) => tagSet.set(t.toLowerCase(), t));

        existing.finalTags = Array.from(tagSet.values());
        existing.tagsToAdd = existing.finalTags.filter((t) => !existing.existingTags.includes(t));

        if (match.important !== undefined) {
          existing.important = existing.important || match.important;
        }
      } else {
        // Create new entry
        bookmarkMap.set(match.bookmarkId, {
          bookmarkId: match.bookmarkId,
          originalLink: match.originalLink,
          title: match.title,
          currentCollectionId: match.currentCollectionId,
          targetCollectionId: match.targetCollectionId,
          targetCollectionName: match.targetCollectionName,
          existingTags: match.existingTags,
          tagsToAdd: match.tagsToAdd,
          finalTags: match.finalTags,
          important: match.important,
          sourceEngines: ['Categorization'],
        });
      }
    }

    // 4. Ingest Tag Normalizer Renames if applicable
    if (tagSummary && tagSummary.caseConflictGroups.length > 0) {
      const tagRenameMap = new Map<string, string>();
      for (const group of tagSummary.caseConflictGroups) {
        for (const variant of group.sourceTags) {
          if (variant !== group.canonicalTag) {
            tagRenameMap.set(variant.toLowerCase(), group.canonicalTag);
          }
        }
      }

      for (const update of bookmarkMap.values()) {
        const normalized = update.finalTags.map((t) => {
          const lower = t.toLowerCase();
          return tagRenameMap.has(lower) ? tagRenameMap.get(lower)! : t;
        });

        // Deduplicate
        const uniqueSet = new Set(normalized);
        update.finalTags = Array.from(uniqueSet);
        update.tagsToAdd = update.finalTags.filter((t) => !update.existingTags.includes(t));
      }
    }

    // 5. Build Chunked Trashing Plan (Max 50 IDs per call)
    const trashedDuplicatesByCollection: CollectionBatchDelete[] = [];
    let deleteCallsCount = 0;

    for (const [colId, ids] of trashedByCollectionMap.entries()) {
      const chunkSize = RAINDROP_LIMITS.MAX_PAGE_SIZE;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        trashedDuplicatesByCollection.push({
          collectionId: colId,
          duplicateIds: chunk,
        });
        deleteCallsCount++;
      }
    }

    const bookmarksToUpdate = Array.from(bookmarkMap.values());
    const totalEstimatedApiCalls = bookmarksToUpdate.length + deleteCallsCount;
    const apiCallsSavedByCoalescing = Math.max(0, rawApiCallsCount - bookmarksToUpdate.length);

    return {
      totalEstimatedApiCalls,
      apiCallsSavedByCoalescing,
      bookmarksToUpdate,
      trashedDuplicatesByCollection,
      totalDuplicatesToTrash: trashedIdSet.size,
      cancelledUpdatesOnTrashCount,
    };
  }
}

export const mutationCoalescer = new MutationCoalescer();
