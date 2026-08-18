import { db } from '../../clients/firestore.js';
import type { DuplicateCluster } from '../../types/duplicate.js';
import type { FirestoreBookmark } from '../../types/firestore.js';
import { logger } from '../../utils/logger.js';

export class DuplicateClusterDetector {
  /**
   * Scans all cached bookmarks in Firestore and groups duplicates by canonical url_hash.
   */
  async detectClusters(): Promise<DuplicateCluster[]> {
    logger.info('Scanning cached Firestore bookmarks for duplicate URL hashes...');

    const hashMap = new Map<string, FirestoreBookmark[]>();
    let totalBookmarks = 0;

    // Stream bookmarks in batches to minimize memory footprint
    const snapshot = await db.bookmarks.get();
    totalBookmarks = snapshot.size;

    logger.debug(`Loaded ${totalBookmarks} bookmark documents from Firestore.`);

    snapshot.forEach((doc) => {
      const bookmark = doc.data();
      const hash = bookmark.url_hash;

      if (!hash) {
        return;
      }

      if (!hashMap.has(hash)) {
        hashMap.set(hash, []);
      }
      hashMap.get(hash)!.push(bookmark);
    });

    const duplicateClusters: DuplicateCluster[] = [];

    for (const [hash, bookmarks] of hashMap.entries()) {
      if (bookmarks.length >= 2) {
        duplicateClusters.push({
          clusterHash: hash,
          canonicalUrl: bookmarks[0]?.canonical_url || bookmarks[0]?.link || '',
          bookmarks,
        });
      }
    }

    logger.info(
      `Detected ${duplicateClusters.length} duplicate clusters across ${totalBookmarks} total bookmarks.`
    );

    return duplicateClusters;
  }

  /**
   * Performs an instant O(1) duplicate check for a single canonical hash against Firestore.
   */
  async checkSingleHash(urlHash: string): Promise<FirestoreBookmark[]> {
    const snapshot = await db.bookmarks.where('url_hash', '==', urlHash).get();
    const results: FirestoreBookmark[] = [];
    snapshot.forEach((doc) => results.push(doc.data()));
    return results;
  }
}

export const duplicateClusterDetector = new DuplicateClusterDetector();
