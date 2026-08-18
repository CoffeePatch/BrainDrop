import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { RaindropTagItem } from '../../types/raindrop.js';
import { logger } from '../../utils/logger.js';

export interface TagMergeGroup {
  canonicalTag: string; // The selected target tag name (e.g. 'react')
  sourceTags: string[];  // Casing variations (e.g. ['React', 'REACT', 'react'])
  totalUsageCount: number;
}

export interface TagAnalysisSummary {
  totalUniqueTags: number;
  caseConflictGroups: TagMergeGroup[];
  emptyTags: string[];
}

export class TagNormalizerService {
  /**
   * Analyzes all tags in the Raindrop library for casing conflicts and empty tags.
   */
  async analyzeTags(): Promise<TagAnalysisSummary> {
    logger.info('Fetching global tag taxonomy from Raindrop API...');

    let tagItems: RaindropTagItem[] = [];
    try {
      const response = await raindropClient.getTags(0);
      tagItems = response.items || [];
    } catch {
      // Fallback: Read from Firestore taxonomy
      logger.warn('Could not fetch live tags from Raindrop API. Reading Firestore taxonomy...');
      const snapshot = await db.taxonomy.doc('global').get();
      const allTags = snapshot.data()?.all_tags || [];
      tagItems = allTags.map((t) => ({ _id: t, count: 1 }));
    }

    const lowerMap = new Map<string, Array<{ original: string; count: number }>>();
    const emptyTags: string[] = [];

    for (const tag of tagItems) {
      const original = tag._id;
      const count = tag.count;

      if (count === 0) {
        emptyTags.push(original);
      }

      const lower = original.trim().toLowerCase();
      if (!lower) continue;

      if (!lowerMap.has(lower)) {
        lowerMap.set(lower, []);
      }
      lowerMap.get(lower)!.push({ original, count });
    }

    const caseConflictGroups: TagMergeGroup[] = [];

    for (const [lower, variations] of lowerMap.entries()) {
      if (variations.length >= 2) {
        // Pick canonical variation: prefer lowercase or the most frequently used variation
        const sorted = [...variations].sort((a, b) => b.count - a.count);
        const canonical = lower; // Standardize to clean lowercase
        const sourceTags = variations.map((v) => v.original);
        const totalUsageCount = variations.reduce((sum, v) => sum + v.count, 0);

        caseConflictGroups.push({
          canonicalTag: canonical,
          sourceTags,
          totalUsageCount,
        });
      }
    }

    return {
      totalUniqueTags: tagItems.length,
      caseConflictGroups,
      emptyTags,
    };
  }

  /**
   * Applies tag merges and prunes empty tags.
   */
  async applyTagNormalization(summary: TagAnalysisSummary, dryRun = true): Promise<void> {
    if (dryRun) {
      logger.info(`[DRY-RUN] Would merge ${summary.caseConflictGroups.length} tag conflict groups.`);
      if (summary.emptyTags.length > 0) {
        logger.info(`[DRY-RUN] Would prune ${summary.emptyTags.length} empty tags.`);
      }
      return;
    }

    // 1. Merge tag groups via Raindrop API
    for (const group of summary.caseConflictGroups) {
      logger.info(
        `Merging tags [${group.sourceTags.join(', ')}] -> '${group.canonicalTag}'...`
      );
      try {
        // Raindrop PUT /tags/0 to merge tags
        await fetch('https://api.raindrop.io/rest/v1/tags/0', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tags: group.sourceTags,
            name: group.canonicalTag,
          }),
        });
      } catch (error) {
        logger.error(`Failed to merge tag group ${group.canonicalTag}: ${error}`);
      }
    }

    // 2. Prune empty tags if any
    if (summary.emptyTags.length > 0) {
      logger.info(`Removing ${summary.emptyTags.length} empty tags...`);
      try {
        await fetch('https://api.raindrop.io/rest/v1/tags/0', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tags: summary.emptyTags,
          }),
        });
      } catch (error) {
        logger.error(`Failed to prune empty tags: ${error}`);
      }
    }

    logger.success('Tag taxonomy normalization completed.');
  }
}

export const tagNormalizerService = new TagNormalizerService();
