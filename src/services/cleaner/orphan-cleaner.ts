import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { RaindropCollection } from '../../types/raindrop.js';
import { logger } from '../../utils/logger.js';

export interface CollectionTreeNode {
  id: number;
  title: string;
  count: number; // Direct bookmarks count
  parentId?: number;
  children: number[]; // Child collection IDs
  subtreeCount: number; // Direct count + all descendants count
  depth: number;
  isProtected: boolean;
}

export interface EmptyCollectionCandidate {
  id: number;
  title: string;
  directCount: number;
  subtreeCount: number;
  depth: number;
  parentId?: number;
  parentTitle?: string;
}

export interface CleanupSummary {
  totalCollectionsScanned: number;
  totalEmptyCollections: number;
  emptyCollections: EmptyCollectionCandidate[];
  totalTagsScanned: number;
  emptyTags: string[];
}

export interface CleanerOptions {
  protectedCollections?: string[];
  includeEmptyTags?: boolean;
}

const SYSTEM_COLLECTION_IDS = new Set([-1, 0, -99]);
const DEFAULT_PROTECTED_TITLES = new Set(['unsorted', 'trash', 'all bookmarks']);

export class OrphanCleanerService {
  /**
   * Builds the collection hierarchy tree and computes recursive subtree bookmark counts.
   */
  buildCollectionTree(
    collections: RaindropCollection[],
    protectedTitles: Set<string> = new Set()
  ): Map<number, CollectionTreeNode> {
    const nodeMap = new Map<number, CollectionTreeNode>();

    // 1. Initialize nodes
    for (const col of collections) {
      const lowerTitle = (col.title || '').trim().toLowerCase();
      const isSystem = SYSTEM_COLLECTION_IDS.has(col._id) || DEFAULT_PROTECTED_TITLES.has(lowerTitle);
      const isUserProtected = protectedTitles.has(lowerTitle);

      nodeMap.set(col._id, {
        id: col._id,
        title: col.title || `Collection #${col._id}`,
        count: col.count || 0,
        parentId: col.parent?.$id,
        children: [],
        subtreeCount: col.count || 0,
        depth: 0,
        isProtected: isSystem || isUserProtected,
      });
    }

    // 2. Link children to parents
    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node.id);
      }
    }

    // 3. Compute depths (root = 0, child = 1, etc.)
    const computeDepth = (id: number, currentDepth: number) => {
      const node = nodeMap.get(id);
      if (!node) return;
      node.depth = currentDepth;
      for (const childId of node.children) {
        computeDepth(childId, currentDepth + 1);
      }
    };

    for (const node of nodeMap.values()) {
      if (!node.parentId) {
        computeDepth(node.id, 0);
      }
    }

    // 4. Compute recursive subtree bookmark count (post-order traversal)
    const computeSubtree = (id: number): number => {
      const node = nodeMap.get(id);
      if (!node) return 0;

      let sum = node.count;
      for (const childId of node.children) {
        sum += computeSubtree(childId);
      }
      node.subtreeCount = sum;
      return sum;
    };

    for (const node of nodeMap.values()) {
      if (!node.parentId) {
        computeSubtree(node.id);
      }
    }

    return nodeMap;
  }

  /**
   * Scans for empty collections and zero-usage tags.
   */
  async scanOrphanResources(options: CleanerOptions = {}): Promise<CleanupSummary> {
    logger.info('Scanning Raindrop collections and tags for empty / orphan resources...');

    const protectedTitles = new Set(
      (options.protectedCollections || []).map((t) => t.trim().toLowerCase())
    );

    // 1. Fetch root & nested child collections
    let allCollections: RaindropCollection[] = [];
    try {
      const rootRes = await raindropClient.getCollections();
      const childRes = await raindropClient.getChildCollections();
      allCollections = [...(rootRes.items || []), ...(childRes.items || [])];
    } catch {
      // Fallback to Firestore collections_meta
      logger.warn('Could not fetch live collections. Reading from Firestore cache...');
      const snapshot = await db.collectionsMeta.get();
      snapshot.forEach((doc) => allCollections.push(doc.data() as RaindropCollection));
    }

    // 2. Build tree and calculate subtree counts
    const tree = this.buildCollectionTree(allCollections, protectedTitles);

    // 3. Identify empty collections (subtreeCount === 0 and not protected)
    const candidates: EmptyCollectionCandidate[] = [];
    for (const node of tree.values()) {
      if (!node.isProtected && node.subtreeCount === 0 && node.id > 0) {
        const parentNode = node.parentId ? tree.get(node.parentId) : undefined;
        candidates.push({
          id: node.id,
          title: node.title,
          directCount: node.count,
          subtreeCount: node.subtreeCount,
          depth: node.depth,
          parentId: node.parentId,
          parentTitle: parentNode?.title,
        });
      }
    }

    // 4. Sort bottom-up (deepest child collections first, then parents)
    candidates.sort((a, b) => b.depth - a.depth);

    // 5. Scan zero-usage tags if requested
    const emptyTags: string[] = [];
    let totalTagsScanned = 0;
    if (options.includeEmptyTags !== false) {
      try {
        const tagsRes = await raindropClient.getTags(0);
        const tags = tagsRes.items || [];
        totalTagsScanned = tags.length;
        for (const tag of tags) {
          if (tag.count === 0) {
            emptyTags.push(tag._id);
          }
        }
      } catch {
        // Tag scan fallback
      }
    }

    logger.info(
      `Found ${candidates.length} empty collections and ${emptyTags.length} zero-usage tags.`
    );

    return {
      totalCollectionsScanned: allCollections.length,
      totalEmptyCollections: candidates.length,
      emptyCollections: candidates,
      totalTagsScanned,
      emptyTags,
    };
  }

  /**
   * Applies deletions to Raindrop and cleans Firestore collections_meta.
   */
  async applyCleanup(summary: CleanupSummary, dryRun = true): Promise<void> {
    if (dryRun) {
      logger.info(
        `[DRY-RUN] Previewed ${summary.emptyCollections.length} empty collections and ${summary.emptyTags.length} empty tags.`
      );
      return;
    }

    // 1. Delete empty collections in bottom-up order
    let deletedCollectionsCount = 0;
    const batch = db.raw.batch();

    for (const candidate of summary.emptyCollections) {
      try {
        logger.info(`Deleting empty collection "${candidate.title}" (ID #${candidate.id})...`);
        await raindropClient.deleteCollection(candidate.id);

        // Delete from Firestore cache
        const docRef = db.collectionsMeta.doc(String(candidate.id));
        batch.delete(docRef);
        deletedCollectionsCount++;
      } catch (error) {
        logger.error(`Failed to delete collection #${candidate.id} (${candidate.title}): ${error}`);
      }
    }

    if (deletedCollectionsCount > 0) {
      await batch.commit();
      logger.success(`Pruned ${deletedCollectionsCount} empty collections from Raindrop & Firestore.`);
    }

    // 2. Delete empty tags
    if (summary.emptyTags.length > 0) {
      try {
        logger.info(`Pruning ${summary.emptyTags.length} zero-usage tags via Raindrop API...`);
        await fetch('https://api.raindrop.io/rest/v1/tags/0', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tags: summary.emptyTags }),
        });
        logger.success(`Pruned ${summary.emptyTags.length} unused tags.`);
      } catch (error) {
        logger.error(`Failed to prune empty tags: ${error}`);
      }
    }
  }
}

export const orphanCleanerService = new OrphanCleanerService();
