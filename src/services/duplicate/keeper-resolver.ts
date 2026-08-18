import { KeeperStrategy } from '../../types/duplicate.js';
import type {
  DuplicateCluster,
  DuplicateMutationPlan,
} from '../../types/duplicate.js';
import type { FirestoreBookmark } from '../../types/firestore.js';

export class KeeperResolver {
  /**
   * Resolves a duplicate cluster into a Keeper and a list of duplicates to trash,
   * performing complete metadata inheritance.
   */
  resolveCluster(
    cluster: DuplicateCluster,
    strategy: KeeperStrategy = KeeperStrategy.KEEP_NEWEST_INHERIT_OLD
  ): DuplicateMutationPlan {
    const bookmarks = [...cluster.bookmarks];
    if (bookmarks.length < 2) {
      throw new Error(`Cluster ${cluster.clusterHash} has fewer than 2 bookmarks.`);
    }

    // 1. Select Keeper based on Strategy
    const keeper = this.selectKeeper(bookmarks, strategy);
    const duplicates = bookmarks.filter((b) => b._id !== keeper._id);

    // 2. Perform Tag Union across all candidates
    const tagSet = new Set<string>();
    for (const b of bookmarks) {
      if (b.tags && Array.isArray(b.tags)) {
        for (const tag of b.tags) {
          const cleanTag = tag.trim();
          if (cleanTag) {
            tagSet.add(cleanTag);
          }
        }
      }
    }
    const mergedTags = Array.from(tagSet);

    // 3. Collection Placement Inheritance:
    // If Keeper is in Unsorted (-1) and any duplicate is in a curated collection (> 0), inherit it!
    let targetCollectionId = keeper.collection?.$id ?? -1;
    if (targetCollectionId <= 0) {
      for (const dup of duplicates) {
        const dupColId = dup.collection?.$id ?? -1;
        if (dupColId > 0) {
          targetCollectionId = dupColId;
          break;
        }
      }
    }

    // 4. Note Concatenation
    let mergedNote = (keeper.note || '').trim();
    for (const dup of duplicates) {
      const dupNote = (dup.note || '').trim();
      if (dupNote) {
        if (!mergedNote) {
          mergedNote = dupNote;
        } else if (!mergedNote.includes(dupNote)) {
          const dateStr = dup.created ? dup.created.split('T')[0] : 'historical';
          mergedNote = `${mergedNote}\n\n---\n*Merged note from previous bookmark (${dateStr}):*\n${dupNote}`;
        }
      }
    }

    // 5. Important / Favorite Flag Union
    const mergedImportant = bookmarks.some((b) => !!b.important);

    // 6. Check if Keeper requires an API update
    const existingTags = keeper.tags || [];
    const tagsChanged =
      mergedTags.length !== existingTags.length ||
      mergedTags.some((t) => !existingTags.includes(t));
    const collectionChanged = targetCollectionId !== (keeper.collection?.$id ?? -1);
    const noteChanged = mergedNote !== (keeper.note || '').trim();
    const importantChanged = mergedImportant !== !!keeper.important;

    const requiresUpdate =
      tagsChanged || collectionChanged || noteChanged || importantChanged;

    return {
      clusterHash: cluster.clusterHash,
      canonicalUrl: cluster.canonicalUrl,
      strategy,
      keeper: {
        id: keeper._id,
        currentCollectionId: keeper.collection?.$id ?? -1,
        targetCollectionId,
        existingTags,
        mergedTags,
        mergedNote,
        mergedImportant,
        requiresUpdate,
      },
      duplicatesToTrash: duplicates.map((dup) => ({
        id: dup._id,
        collectionId: dup.collection?.$id ?? -1,
        title: dup.title || 'Untitled',
        link: dup.link,
        created: dup.created,
        rawPayload: dup,
      })),
    };
  }

  /**
   * Identifies Keeper based on strategy rules.
   */
  private selectKeeper(
    bookmarks: FirestoreBookmark[],
    strategy: KeeperStrategy
  ): FirestoreBookmark {
    switch (strategy) {
      case KeeperStrategy.KEEP_NEWEST_INHERIT_OLD: {
        // Sort by created descending (newest first)
        return bookmarks.reduce((newest, current) => {
          const newestEpoch = new Date(newest.created || 0).getTime();
          const currentEpoch = new Date(current.created || 0).getTime();
          return currentEpoch > newestEpoch ? current : newest;
        });
      }

      case KeeperStrategy.KEEP_OLDEST_MERGE_NEW: {
        // Sort by created ascending (oldest first)
        return bookmarks.reduce((oldest, current) => {
          const oldestEpoch = new Date(oldest.created || 0).getTime();
          const currentEpoch = new Date(current.created || 0).getTime();
          return currentEpoch < oldestEpoch ? current : oldest;
        });
      }

      case KeeperStrategy.KEEP_RICHEST: {
        // Score by annotation density
        return bookmarks.reduce((richest, current) => {
          return this.calculateScore(current) > this.calculateScore(richest)
            ? current
            : richest;
        });
      }
    }
  }

  /**
   * Heuristic annotation richness score.
   */
  private calculateScore(b: FirestoreBookmark): number {
    let score = 0;
    score += (b.highlights?.length || 0) * 200;
    if (b.note && b.note.trim().length > 0) {
      score += 150 + Math.min(b.note.trim().length, 100);
    }
    score += (b.tags?.length || 0) * 100;
    if (b.collection?.$id && b.collection.$id > 0) score += 50;
    if (b.important) score += 25;
    return score;
  }
}

export const keeperResolver = new KeeperResolver();
