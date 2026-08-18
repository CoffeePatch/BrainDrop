import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { RaindropCollection } from '../../types/raindrop.js';
import { logger } from '../../utils/logger.js';

export class CollectionSyncService {
  /**
   * Fetches all user collections (root + nested) and syncs them to Firestore.
   */
  async syncCollections(): Promise<Map<number, RaindropCollection>> {
    logger.info('Fetching collections from Raindrop API...');
    const collectionMap = new Map<number, RaindropCollection>();

    try {
      // 1. Fetch root collections
      const rootRes = await raindropClient.getCollections();
      const rootItems = rootRes.items || [];
      for (const col of rootItems) {
        collectionMap.set(col._id, col);
      }

      // 2. Fetch nested child collections
      const childRes = await raindropClient.getChildCollections();
      const childItems = childRes.items || [];
      for (const col of childItems) {
        collectionMap.set(col._id, col);
      }

      logger.info(`Discovered ${collectionMap.size} user collections.`);

      // 3. Batch commit to Firestore collections_meta
      if (collectionMap.size > 0) {
        const batch = db.raw.batch();
        for (const [id, col] of collectionMap.entries()) {
          const docRef = db.collectionsMeta.doc(String(id));
          batch.set(docRef, col, { merge: true });
        }
        await batch.commit();
        logger.success(`Synchronized ${collectionMap.size} collections to Firestore.`);
      }

      return collectionMap;
    } catch (error) {
      logger.warn(`Collection synchronization warning: ${error}`);
      return collectionMap;
    }
  }

  /**
   * Get collection title by ID, with fallbacks for system collections.
   */
  getCollectionTitle(colId: number, map: Map<number, RaindropCollection>): string {
    if (colId === -1) return 'Unsorted';
    if (colId === 0) return 'All Bookmarks';
    if (colId === -99) return 'Trash';
    return map.get(colId)?.title || `Collection #${colId}`;
  }
}

export const collectionSyncService = new CollectionSyncService();
