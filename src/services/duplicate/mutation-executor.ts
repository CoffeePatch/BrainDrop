import { FIRESTORE_LIMITS, RAINDROP_LIMITS } from '../../config/constants.js';
import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { DuplicateMutationPlan } from '../../types/duplicate.js';
import { logger } from '../../utils/logger.js';

export interface MutationExecutionResult {
  successfulClusters: number;
  failedClusters: number;
  totalDuplicatesTrashed: number;
  totalKeepersUpdated: number;
  batchDeleteRequestsCount: number;
}

export class DuplicateMutationExecutor {
  /**
   * Executes duplicate resolution across all plans using a High-Performance Global Batch Pipeline.
   *
   * Architecture:
   * Phase 1: Update Keepers that require tag merges or collection moves.
   * Phase 2: Aggregate ALL duplicate IDs globally, group by collection, and chunk into 50 IDs per DELETE call.
   * Phase 3: Reconcile Firestore cache and record audit logs in atomic 500-doc batches.
   */
  async executeAll(
    plans: DuplicateMutationPlan[],
    dryRun = true
  ): Promise<MutationExecutionResult> {
    if (dryRun) {
      logger.info(`[DRY-RUN] Previewed ${plans.length} clusters. No writes dispatched.`);
      return {
        successfulClusters: plans.length,
        failedClusters: 0,
        totalDuplicatesTrashed: plans.reduce((sum, p) => sum + p.duplicatesToTrash.length, 0),
        totalKeepersUpdated: plans.filter((p) => p.keeper.requiresUpdate).length,
        batchDeleteRequestsCount: 0,
      };
    }

    let totalKeepersUpdated = 0;
    let totalDuplicatesTrashed = 0;
    let batchDeleteRequestsCount = 0;
    let failedClusters = 0;
    let successfulClusters = 0;

    // =========================================================================
    // Phase 1: Update Keepers requiring metadata changes
    // =========================================================================
    const keepersNeedingUpdate = plans.filter((p) => p.keeper.requiresUpdate);
    logger.info(
      `Phase 1/3: Updating ${keepersNeedingUpdate.length} Keepers with merged tags/collections...`
    );

    for (const plan of keepersNeedingUpdate) {
      try {
        const updatePayload: Record<string, unknown> = {
          tags: plan.keeper.mergedTags,
          important: plan.keeper.mergedImportant,
        };

        if (plan.keeper.targetCollectionId > 0) {
          updatePayload.collection = { $id: plan.keeper.targetCollectionId };
        }

        if (plan.keeper.mergedNote) {
          updatePayload.note = plan.keeper.mergedNote;
        }

        await raindropClient.updateRaindrop(plan.keeper.id, updatePayload);
        totalKeepersUpdated++;
      } catch (error) {
        logger.error(
          `Failed to update Keeper ID ${plan.keeper.id} for cluster ${plan.canonicalUrl}: ${error}`
        );
      }
    }

    // =========================================================================
    // Phase 2: Global Batch Trashing (Grouped by Collection, 50 IDs / request)
    // =========================================================================
    const globalCollectionMap = new Map<number, number[]>();
    for (const plan of plans) {
      for (const dup of plan.duplicatesToTrash) {
        const colId = dup.collectionId;
        if (!globalCollectionMap.has(colId)) {
          globalCollectionMap.set(colId, []);
        }
        globalCollectionMap.get(colId)!.push(dup.id);
      }
    }

    const totalToTrash = Array.from(globalCollectionMap.values()).reduce(
      (sum, ids) => sum + ids.length,
      0
    );
    logger.info(
      `Phase 2/3: Trashing ${totalToTrash} duplicate copies across ${globalCollectionMap.size} collections (max 50 IDs/batch)...`
    );

    for (const [colId, duplicateIds] of globalCollectionMap.entries()) {
      // Chunk IDs into batches of 50 (Raindrop's max batch size)
      const chunkSize = RAINDROP_LIMITS.MAX_PAGE_SIZE;
      for (let i = 0; i < duplicateIds.length; i += chunkSize) {
        const chunk = duplicateIds.slice(i, i + chunkSize);
        try {
          logger.info(
            `Moving batch of ${chunk.length} items in Collection #${colId} to Raindrop Trash...`
          );
          await raindropClient.batchDeleteRaindrops(colId, chunk);
          totalDuplicatesTrashed += chunk.length;
          batchDeleteRequestsCount++;
        } catch (error) {
          logger.error(
            `Failed to batch delete ${chunk.length} duplicates in Collection #${colId}: ${error}`
          );
        }
      }
    }

    // =========================================================================
    // Phase 3: High-Speed Firestore Reconcile & Audit Snapshots
    // =========================================================================
    logger.info('Phase 3/3: Reconciling Firestore working cache and recording audit snapshot...');
    try {
      let batch = db.raw.batch();
      let pendingWrites = 0;

      for (const plan of plans) {
        // Update Keeper in Firestore
        const keeperDocRef = db.bookmarks.doc(String(plan.keeper.id));
        batch.update(keeperDocRef, {
          tags: plan.keeper.mergedTags,
          'collection.$id': plan.keeper.targetCollectionId,
          note: plan.keeper.mergedNote,
          important: plan.keeper.mergedImportant,
          synced_at: new Date().toISOString(),
        });
        pendingWrites++;

        // Delete duplicates from active Firestore bookmarks cache
        for (const dup of plan.duplicatesToTrash) {
          const dupDocRef = db.bookmarks.doc(String(dup.id));
          batch.delete(dupDocRef);
          pendingWrites++;

          if (pendingWrites >= FIRESTORE_LIMITS.MAX_BATCH_WRITE_SIZE) {
            await batch.commit();
            batch = db.raw.batch();
            pendingWrites = 0;
          }
        }

        successfulClusters++;
      }

      // Save global audit log of this execution
      const auditDocRef = db.auditLogs.doc();
      batch.set(auditDocRef, {
        type: 'DUPLICATE_RESOLUTION_BATCH',
        timestamp: new Date().toISOString(),
        totalClusters: plans.length,
        totalKeepersUpdated,
        totalDuplicatesTrashed,
        batchDeleteRequestsCount,
        plans,
      });
      pendingWrites++;

      if (pendingWrites > 0) {
        await batch.commit();
      }

      logger.success('Firestore working cache synchronized successfully.');
    } catch (error) {
      logger.error(`Firestore batch reconcile error: ${error}`);
    }

    return {
      successfulClusters,
      failedClusters,
      totalDuplicatesTrashed,
      totalKeepersUpdated,
      batchDeleteRequestsCount,
    };
  }
}

export const duplicateMutationExecutor = new DuplicateMutationExecutor();
