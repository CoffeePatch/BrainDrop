import { FIRESTORE_LIMITS, RAINDROP_LIMITS } from '../../config/constants.js';
import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { FirestoreBookmark } from '../../types/firestore.js';
import type { RaindropBookmark } from '../../types/raindrop.js';
import { canonicalizeUrl } from '../../utils/canonicalizer.js';
import { logger } from '../../utils/logger.js';
import { collectionSyncService } from './collection-sync.js';
import { syncStateManager } from './sync-state.js';

export interface SyncOptions {
  forceFullScan?: boolean;
}

export interface SyncResult {
  totalFetched: number;
  totalCommitted: number;
  durationMs: number;
  latestTimestamp: string | null;
  mode: 'FULL' | 'INCREMENTAL';
}

export class IncrementalSyncService {
  /**
   * Transforms raw Raindrop bookmark entity into full-fidelity FirestoreBookmark with computed canonical hash.
   */
  transformBookmark(item: RaindropBookmark, syncedAt: string): FirestoreBookmark {
    const canonical = canonicalizeUrl(item.link);

    return {
      ...item,
      canonical_url: canonical.canonicalUrl,
      url_hash: canonical.urlHash,
      domain: item.domain || canonical.domain,
      synced_at: syncedAt,
    };
  }

  /**
   * Executes the Incremental Delta or Full synchronization pipeline.
   */
  async runSync(options: SyncOptions = {}): Promise<SyncResult> {
    const startTime = Date.now();
    await syncStateManager.setStatus('SYNCING');

    try {
      // 1. Sync collections metadata first
      await collectionSyncService.syncCollections();

      // 2. Check sync checkpoint
      const checkpoint = options.forceFullScan
        ? null
        : await syncStateManager.getSyncCheckpoint();

      const searchTimestamp = syncStateManager.getSearchQueryTimestamp(checkpoint);
      const isIncremental = !options.forceFullScan && searchTimestamp !== null;

      let searchQuery: string | undefined = undefined;
      if (isIncremental && searchTimestamp) {
        // Format ISO string to date/time format supported by Raindrop
        const datePart = searchTimestamp.split('T')[0];
        searchQuery = `lastUpdate:>${datePart}`;
        logger.info(`Running INCREMENTAL sync with filter: ${searchQuery}`);
      } else {
        logger.info('Running FULL library sync (initial or forced).');
      }

      const syncedAt = new Date().toISOString();
      let page = 0;
      let totalFetched = 0;
      let totalCommitted = 0;
      let latestLastUpdate: string | null = null;
      const tagSet = new Set<string>();

      let pendingBatch = db.raw.batch();
      let pendingBatchSize = 0;

      while (true) {
        logger.debug(`Fetching page ${page} (search: ${searchQuery || 'none'})...`);

        const response = await raindropClient.getRaindrops(0, {
          search: searchQuery,
          sort: '-lastUpdate',
          page,
          perpage: RAINDROP_LIMITS.MAX_PAGE_SIZE,
        });

        const items = response.items || [];
        if (items.length === 0) {
          break;
        }

        totalFetched += items.length;

        for (const item of items) {
          // Track highest lastUpdate timestamp seen
          if (!latestLastUpdate || (item.lastUpdate && item.lastUpdate > latestLastUpdate)) {
            latestLastUpdate = item.lastUpdate;
          }

          // Track tags for taxonomy index
          if (item.tags && Array.isArray(item.tags)) {
            item.tags.forEach((t) => tagSet.add(t.trim().toLowerCase()));
          }

          const firestoreDoc = this.transformBookmark(item, syncedAt);
          const docRef = db.bookmarks.doc(String(item._id));
          pendingBatch.set(docRef, firestoreDoc, { merge: true });
          pendingBatchSize++;

          // Commit when batch reaches 500 documents
          if (pendingBatchSize >= FIRESTORE_LIMITS.MAX_BATCH_WRITE_SIZE) {
            await pendingBatch.commit();
            totalCommitted += pendingBatchSize;
            logger.info(`Committed batch of ${pendingBatchSize} bookmarks to Firestore.`);
            pendingBatch = db.raw.batch();
            pendingBatchSize = 0;
          }
        }

        logger.info(
          `Synced page ${page} (${totalFetched} / ${response.count || totalFetched} items processed)`
        );

        // Check if last page reached
        if (items.length < RAINDROP_LIMITS.MAX_PAGE_SIZE) {
          break;
        }

        page++;
      }

      // Commit remaining batch
      if (pendingBatchSize > 0) {
        await pendingBatch.commit();
        totalCommitted += pendingBatchSize;
        logger.info(`Committed final batch of ${pendingBatchSize} bookmarks to Firestore.`);
      }

      // 3. Update Taxonomy Index if tags were discovered
      if (tagSet.size > 0) {
        const taxonomyRef = db.taxonomy.doc('global');
        await taxonomyRef.set(
          {
            all_tags: Array.from(tagSet).sort(),
            updated_at: syncedAt,
          },
          { merge: true }
        );
      }

      const durationMs = Date.now() - startTime;

      // 4. Update sync state checkpoint
      if (latestLastUpdate) {
        await syncStateManager.updateCheckpoint(latestLastUpdate, totalCommitted, durationMs);
      }

      logger.success(
        `Sync completed in ${(durationMs / 1000).toFixed(2)}s: ${totalCommitted} bookmarks synced.`
      );

      return {
        totalFetched,
        totalCommitted,
        durationMs,
        latestTimestamp: latestLastUpdate,
        mode: isIncremental ? 'INCREMENTAL' : 'FULL',
      };
    } catch (error) {
      await syncStateManager.setStatus('ERROR', String(error));
      logger.error(`Sync pipeline failed: ${error}`);
      throw error;
    }
  }
}

export const incrementalSyncService = new IncrementalSyncService();
