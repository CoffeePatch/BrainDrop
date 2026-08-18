import { DEFAULT_DOMAIN_RULES } from '../../config/rules.js';
import type { DomainRule } from '../../config/rules.js';
import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { FirestoreBookmark } from '../../types/firestore.js';
import { logger } from '../../utils/logger.js';

export interface RuleMatchAction {
  bookmarkId: number;
  title: string;
  link: string;
  domain: string;
  ruleName: string;
  existingTags: string[];
  tagsToAdd: string[];
  targetTags: string[];
  currentCollectionId: number;
  targetCollectionId?: number;
  targetCollectionName?: string;
  requiresUpdate: boolean;
}

export interface RuleRunSummary {
  totalEvaluated: number;
  totalMatches: number;
  actions: RuleMatchAction[];
}

export class RuleEngineService {
  /**
   * Evaluates rules on a single bookmark.
   */
  evaluateBookmark(
    b: FirestoreBookmark,
    rules: DomainRule[] = DEFAULT_DOMAIN_RULES,
    collectionNameToIdMap: Map<string, number> = new Map()
  ): RuleMatchAction | null {
    const domain = (b.domain || '').toLowerCase();
    if (!domain) return null;

    for (const rule of rules) {
      const matchesDomain = rule.domains.some((d) => {
        const lowerD = d.toLowerCase();
        return domain === lowerD || domain.endsWith(`.${lowerD}`);
      });

      if (!matchesDomain) continue;

      // Calculate tags to add
      const existingTags = b.tags || [];
      const newTags = (rule.tagsToAdd || []).filter(
        (t) => !existingTags.map((et) => et.toLowerCase()).includes(t.toLowerCase())
      );

      // Check collection mapping
      let targetCollectionId: number | undefined = undefined;
      if (rule.targetCollectionName && collectionNameToIdMap.has(rule.targetCollectionName.toLowerCase())) {
        const mappedId = collectionNameToIdMap.get(rule.targetCollectionName.toLowerCase())!;
        // Only suggest collection move if bookmark is currently Unsorted (-1)
        if ((b.collection?.$id ?? -1) <= 0) {
          targetCollectionId = mappedId;
        }
      }

      if (newTags.length > 0 || targetCollectionId !== undefined) {
        return {
          bookmarkId: b._id,
          title: b.title || 'Untitled',
          link: b.link,
          domain,
          ruleName: rule.name,
          existingTags,
          tagsToAdd: newTags,
          targetTags: [...existingTags, ...newTags],
          currentCollectionId: b.collection?.$id ?? -1,
          targetCollectionId,
          targetCollectionName: rule.targetCollectionName,
          requiresUpdate: true,
        };
      }
    }

    return null;
  }

  /**
   * Scans all bookmarks in Firestore and evaluates rules.
   */
  async evaluateAll(rules: DomainRule[] = DEFAULT_DOMAIN_RULES): Promise<RuleRunSummary> {
    logger.info('Evaluating deterministic domain rules against cached bookmarks...');

    // Load collections to map names -> IDs
    const colSnapshot = await db.collectionsMeta.get();
    const collectionNameToIdMap = new Map<string, number>();
    colSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.title) {
        collectionNameToIdMap.set(data.title.trim().toLowerCase(), data._id);
      }
    });

    const snapshot = await db.bookmarks.get();
    const actions: RuleMatchAction[] = [];

    snapshot.forEach((doc) => {
      const b = doc.data();
      const match = this.evaluateBookmark(b, rules, collectionNameToIdMap);
      if (match) {
        actions.push(match);
      }
    });

    logger.info(`Rule evaluation complete: ${actions.length} bookmarks match rules.`);

    return {
      totalEvaluated: snapshot.size,
      totalMatches: actions.length,
      actions,
    };
  }

  /**
   * Executes rule actions via Raindrop API and updates Firestore.
   */
  async applyActions(actions: RuleMatchAction[], dryRun = true): Promise<void> {
    if (dryRun) {
      logger.info(`[DRY-RUN] Would apply rule updates to ${actions.length} bookmarks.`);
      return;
    }

    let successCount = 0;
    const batch = db.raw.batch();

    for (const action of actions) {
      try {
        const updatePayload: Record<string, any> = {
          tags: action.targetTags,
        };
        if (action.targetCollectionId) {
          updatePayload.collection = { $id: action.targetCollectionId };
        }

        await raindropClient.updateRaindrop(action.bookmarkId, updatePayload);

        // Update Firestore
        const docRef = db.bookmarks.doc(String(action.bookmarkId));
        batch.update(docRef, {
          tags: action.targetTags,
          ...(action.targetCollectionId ? { 'collection.$id': action.targetCollectionId } : {}),
          synced_at: new Date().toISOString(),
        });

        successCount++;
      } catch (error) {
        logger.error(`Failed to apply rule on bookmark #${action.bookmarkId}: ${error}`);
      }
    }

    if (successCount > 0) {
      await batch.commit();
      logger.success(`Applied domain rules to ${successCount} bookmarks.`);
    }
  }
}

export const ruleEngineService = new RuleEngineService();
