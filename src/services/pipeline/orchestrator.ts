import { FIRESTORE_LIMITS } from '../../config/constants.js';
import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import { logger } from '../../utils/logger.js';
import { orphanCleanerService } from '../cleaner/orphan-cleaner.js';
import type { CleanupSummary } from '../cleaner/orphan-cleaner.js';
import { duplicateClusterDetector } from '../duplicate/cluster-detector.js';
import { keeperResolver } from '../duplicate/keeper-resolver.js';
import { hierarchicalCategorizerService } from '../rules/categorizer.js';
import { incrementalSyncService } from '../sync/incremental-sync.js';
import type { SyncResult } from '../sync/incremental-sync.js';
import { tagNormalizerService } from '../tags/tag-normalizer.js';
import { mutationCoalescer } from './coalescer.js';
import type { CoalescedMutationPlan } from './coalescer.js';
import type { PipelineExecutionReport } from './pipeline-reporter.js';

export interface PipelineOptions {
  skipSync?: boolean;
  dryRun?: boolean;
  protectedCollections?: string[];
  rulesPath?: string;
  overwriteExistingCollections?: boolean;
}

export class PipelineOrchestrator {
  /**
   * Executes the entire BrainDrop maintenance lifecycle with mutation coalescing.
   */
  async run(options: PipelineOptions = {}): Promise<PipelineExecutionReport> {
    const startTime = Date.now();
    const isDryRun = options.dryRun !== false;

    logger.info(`Starting BrainDrop Unified Maintenance Pipeline (${isDryRun ? 'DRY-RUN' : 'LIVE'})...`);

    // 1. Step 1: Incremental Delta Ingestion (unless skipped)
    let syncResult: SyncResult | undefined = undefined;
    if (!options.skipSync) {
      logger.info('Step 1/5: Running Incremental Delta Sync...');
      try {
        syncResult = await incrementalSyncService.runSync();
      } catch (error) {
        logger.warn(`Incremental sync failed: ${error}. Proceeding with cached library.`);
      }
    }

    // 2. Step 2: Multi-Engine In-Memory Planning (0 API Writes)
    logger.info('Step 2/5: Gathering multi-engine mutation plans in memory...');

    // A. Deduplication Engine Planning
    const clusters = await duplicateClusterDetector.detectClusters();
    const duplicatePlans = clusters.map((c) => keeperResolver.resolveCluster(c));

    // B. Categorization Engine Planning
    const categorizationSummary = await hierarchicalCategorizerService.planCategorization({
      rulesPath: options.rulesPath,
      overwriteExistingCollections: options.overwriteExistingCollections,
    });

    // C. Tag Normalizer Planning
    const tagSummary = await tagNormalizerService.analyzeTaxonomy();

    // D. Orphan Cleaner Planning
    const orphanSummary: CleanupSummary = await orphanCleanerService.scanOrphanResources({
      protectedCollections: options.protectedCollections,
    });

    // 3. Step 3: Mutation Coalescing (Eliminates redundant API calls)
    logger.info('Step 3/5: Coalescing multi-engine updates and discarding trashed mutations...');
    const coalescedPlan: CoalescedMutationPlan = mutationCoalescer.coalesce(
      duplicatePlans,
      categorizationSummary.matches,
      tagSummary
    );

    // 4. Step 4: Dispatch Coalesced Mutations to Raindrop & Reconcile Firestore
    if (!isDryRun) {
      logger.info(`Step 4/5: Dispatching ${coalescedPlan.bookmarksToUpdate.length} updates and trashing ${coalescedPlan.totalDuplicatesToTrash} duplicates...`);

      // A. Dispatch Coalesced Updates
      for (const update of coalescedPlan.bookmarksToUpdate) {
        try {
          const payload: Record<string, any> = {
            tags: update.finalTags,
          };

          if (update.targetCollectionId && update.targetCollectionId > 0 && update.targetCollectionId !== update.currentCollectionId) {
            payload.collection = { $id: update.targetCollectionId };
          }

          if (update.mergedNote) {
            payload.note = update.mergedNote;
          }

          if (update.important !== undefined) {
            payload.important = update.important;
          }

          await raindropClient.updateRaindrop(update.bookmarkId, payload);
        } catch (error) {
          logger.error(`Failed to update bookmark #${update.bookmarkId}: ${error}`);
        }
      }

      // B. Dispatch Batch Deletes to Raindrop Trash (-99)
      for (const batch of coalescedPlan.trashedDuplicatesByCollection) {
        try {
          await raindropClient.batchDeleteRaindrops(batch.collectionId, batch.duplicateIds);
        } catch (error) {
          logger.error(`Failed to delete batch in collection #${batch.collectionId}: ${error}`);
        }
      }

      // C. Reconcile Firestore Cache in atomic 500-doc batches
      let fsBatch = db.raw.batch();
      let pendingWrites = 0;

      for (const update of coalescedPlan.bookmarksToUpdate) {
        const docRef = db.bookmarks.doc(String(update.bookmarkId));
        fsBatch.update(docRef, {
          tags: update.finalTags,
          ...(update.targetCollectionId ? { 'collection.$id': update.targetCollectionId } : {}),
          ...(update.mergedNote ? { note: update.mergedNote } : {}),
          ...(update.important !== undefined ? { important: update.important } : {}),
          synced_at: new Date().toISOString(),
        });
        pendingWrites++;

        if (pendingWrites >= FIRESTORE_LIMITS.MAX_BATCH_WRITE_SIZE) {
          await fsBatch.commit();
          fsBatch = db.raw.batch();
          pendingWrites = 0;
        }
      }

      // Delete trashed bookmarks from Firestore
      for (const batch of coalescedPlan.trashedDuplicatesByCollection) {
        for (const id of batch.duplicateIds) {
          const docRef = db.bookmarks.doc(String(id));
          fsBatch.delete(docRef);
          pendingWrites++;

          if (pendingWrites >= FIRESTORE_LIMITS.MAX_BATCH_WRITE_SIZE) {
            await fsBatch.commit();
            fsBatch = db.raw.batch();
            pendingWrites = 0;
          }
        }
      }

      if (pendingWrites > 0) {
        await fsBatch.commit();
      }

      // 5. Step 5: Prune Empty Collections & Tags
      if (orphanSummary.totalEmptyCollections > 0 || orphanSummary.emptyTags.length > 0) {
        logger.info('Step 5/5: Pruning orphan collections and dead tags...');
        await orphanCleanerService.applyCleanup(orphanSummary, false);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      syncResult,
      mutationPlan: coalescedPlan,
      orphanSummary,
      durationMs,
    };
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
