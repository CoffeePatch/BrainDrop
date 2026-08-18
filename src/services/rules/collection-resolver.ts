import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import { logger } from '../../utils/logger.js';

export class CollectionResolver {
  private titleToIdMap = new Map<string, number>();
  private initialized = false;

  /**
   * Initializes the collection resolver by loading all user collections from Firestore.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const snapshot = await db.collectionsMeta.get();
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.title && data._id) {
          this.titleToIdMap.set(data.title.trim().toLowerCase(), data._id);
        }
      });
      this.initialized = true;
      logger.debug(`CollectionResolver loaded ${this.titleToIdMap.size} collections into memory.`);
    } catch (error) {
      logger.warn(`Could not load collections from Firestore: ${error}`);
    }
  }

  /**
   * Checks if a collection title exists in the cache.
   */
  hasCollection(title: string): boolean {
    return this.titleToIdMap.has(title.trim().toLowerCase());
  }

  /**
   * Resolves a collection title to its Raindrop Collection ID, with fallback for system folders.
   */
  getCollectionId(title: string): number | undefined {
    const clean = title.trim().toLowerCase();
    if (clean === 'unsorted' || clean === '-1') return -1;
    if (clean === 'all' || clean === '0') return 0;
    if (clean === 'trash' || clean === '-99') return -99;
    return this.titleToIdMap.get(clean);
  }

  /**
   * Resolves or provisions a collection in Raindrop, supporting nested paths ("Engineering / React").
   */
  async resolveOrProvision(title: string, dryRun = true): Promise<number | null> {
    await this.init();

    const cleanTitle = title.trim();
    const lower = cleanTitle.toLowerCase();

    // 1. Check if already exists
    if (this.titleToIdMap.has(lower)) {
      return this.titleToIdMap.get(lower)!;
    }

    // 2. Handle nested path ("Parent / Child")
    if (cleanTitle.includes('/')) {
      const parts = cleanTitle.split('/').map((p) => p.trim());
      let parentId: number | undefined = undefined;

      for (let i = 0; i < parts.length; i++) {
        const partName = parts[i]!;
        const partLower = partName.toLowerCase();

        if (this.titleToIdMap.has(partLower)) {
          parentId = this.titleToIdMap.get(partLower)!;
        } else {
          if (dryRun) {
            logger.debug(`[DRY-RUN] Would create nested collection "${partName}" (parent: ${parentId || 'root'})`);
            return null;
          }

          logger.info(`Creating nested collection "${partName}" in Raindrop...`);
          const res = await raindropClient.createCollection(partName, parentId);
          if (res.item?._id) {
            parentId = res.item._id;
            this.titleToIdMap.set(partLower, res.item._id);

            // Cache in Firestore
            await db.collectionsMeta.doc(String(parentId)).set(res.item, { merge: true });
          }
        }
      }

      if (parentId) {
        this.titleToIdMap.set(lower, parentId);
        return parentId;
      }
    }

    // 3. Simple root collection provisioning
    if (dryRun) {
      logger.debug(`[DRY-RUN] Would create collection "${cleanTitle}"`);
      return null;
    }

    logger.info(`Creating new collection "${cleanTitle}" in Raindrop...`);
    const res = await raindropClient.createCollection(cleanTitle);
    if (res.item?._id) {
      const newId = res.item._id;
      this.titleToIdMap.set(lower, newId);
      await db.collectionsMeta.doc(String(newId)).set(res.item, { merge: true });
      return newId;
    }

    return null;
  }
}

export const collectionResolver = new CollectionResolver();
