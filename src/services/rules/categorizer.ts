import fs from 'fs';
import path from 'path';
import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { FirestoreBookmark } from '../../types/firestore.js';
import { RuleConfigFileSchema } from '../../types/rules.js';
import type {
  CategorizationMatch,
  CategorizationSummary,
  HierarchicalRule,
  SubpathRule,
} from '../../types/rules.js';
import { logger } from '../../utils/logger.js';
import { collectionResolver } from './collection-resolver.js';

export interface CategorizeOptions {
  rulesPath?: string;
  overwriteExistingCollections?: boolean;
}

export class HierarchicalCategorizerService {
  /**
   * Loads and validates user rules from file (rules.json -> rules.example.json -> fallback).
   */
  loadRules(customPath?: string): HierarchicalRule[] {
    const candidatePaths = customPath
      ? [customPath]
      : [
          path.resolve(process.cwd(), 'rules.json'),
          path.resolve(process.cwd(), 'rules.example.json'),
        ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf-8');
          const parsed = JSON.parse(raw);
          const validation = RuleConfigFileSchema.safeParse(parsed);

          if (validation.success) {
            logger.info(`Loaded ${validation.data.length} rules from ${path.basename(p)}`);
            return validation.data;
          } else {
            logger.warn(
              `Rule validation warnings in ${path.basename(p)}: ${validation.error.message}`
            );
          }
        } catch (error) {
          logger.error(`Could not parse rule file ${p}: ${error}`);
        }
      }
    }

    logger.warn('No valid rules file found. Using empty rule set.');
    return [];
  }

  /**
   * Evaluates a single bookmark against the hierarchical rule tree.
   */
  evaluateBookmark(
    bookmark: FirestoreBookmark,
    rules: HierarchicalRule[],
    overwriteExisting = false
  ): CategorizationMatch | null {
    const rawUrl = bookmark.link || '';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return null;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();
    const currentCollectionId = bookmark.collection?.$id ?? -1;

    // Sort rules by priority descending
    const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
      // 1. Check Matching Criteria
      const domainMatch =
        (rule.domain && (hostname === rule.domain.toLowerCase() || hostname.endsWith(`.${rule.domain.toLowerCase()}`))) ||
        (rule.domains && rule.domains.some((d) => hostname === d.toLowerCase() || hostname.endsWith(`.${d.toLowerCase()}`)));

      const extensionMatch =
        rule.fileExtensions &&
        rule.fileExtensions.some((ext) => pathname.endsWith(ext.toLowerCase()));

      let regexMatch = false;
      if (rule.regex) {
        try {
          const regex = new RegExp(rule.regex, 'i');
          regexMatch = regex.test(rawUrl);
        } catch {
          // Invalid regex skipped safely
        }
      }

      const isMatch = domainMatch || extensionMatch || regexMatch;
      if (!isMatch) continue;

      // 2. Base Rule Properties
      let targetCollection = rule.targetCollection;
      let accumulatedTags = [...(rule.tags || [])];
      let matchedPattern = rule.domain || rule.regex || rule.fileExtensions?.join(',') || 'Base Domain';

      // 3. Hierarchical Subpath Matching
      if (rule.subpaths && rule.subpaths.length > 0) {
        for (const sub of rule.subpaths) {
          if (this.matchSubpath(pathname, sub.pattern)) {
            matchedPattern = `${matchedPattern} -> ${sub.pattern}`;

            // Subpath collection override
            if (sub.targetCollection) {
              targetCollection = sub.targetCollection;
            }

            // Tag inheritance or override
            if (sub.overrideTags && sub.overrideTags.length > 0) {
              accumulatedTags = [...sub.overrideTags];
            } else if (sub.tags && sub.tags.length > 0) {
              accumulatedTags = [...accumulatedTags, ...sub.tags];
            }
            break; // Stop at first matching subpath
          }
        }
      }

      // 4. Set-Union Deduplication for Tags
      const existingTags = bookmark.tags || [];
      const tagMap = new Map<string, string>(); // lower -> original
      existingTags.forEach((t) => tagMap.set(t.trim().toLowerCase(), t.trim()));

      const tagsToAdd: string[] = [];
      accumulatedTags.forEach((t) => {
        const clean = t.trim();
        if (clean && !tagMap.has(clean.toLowerCase())) {
          tagMap.set(clean.toLowerCase(), clean);
          tagsToAdd.push(clean);
        }
      });

      const finalTags = Array.from(tagMap.values());

      // 5. Check Collection Resolution
      let targetCollectionId: number | undefined = undefined;
      let isNewCollection = false;

      if (targetCollection) {
        const resolvedId = collectionResolver.getCollectionId(targetCollection);
        if (resolvedId !== undefined) {
          targetCollectionId = resolvedId;
        } else {
          isNewCollection = true;
        }
      }

      // 6. Safe Collection Move: Only move if in Unsorted (-1) or overwrite flag is enabled
      const shouldMoveCollection =
        targetCollection &&
        (currentCollectionId <= 0 || overwriteExisting) &&
        (targetCollectionId === undefined || targetCollectionId !== currentCollectionId);

      const requiresMutation = tagsToAdd.length > 0 || shouldMoveCollection;

      if (requiresMutation) {
        return {
          bookmarkId: bookmark._id,
          originalLink: rawUrl,
          title: bookmark.title || 'Untitled',
          matchedRuleName: rule.name,
          matchedPattern,
          currentCollectionId,
          targetCollectionName: shouldMoveCollection ? targetCollection : undefined,
          targetCollectionId: shouldMoveCollection ? targetCollectionId : undefined,
          isNewCollection,
          existingTags,
          tagsToAdd,
          finalTags,
          important: rule.important,
          requiresMutation: true,
        };
      }
    }

    return null;
  }

  /**
   * Helper to match path glob patterns (e.g. "/series/*", "/docs/*", "/pdf/*").
   */
  private matchSubpath(pathname: string, pattern: string): boolean {
    const cleanPattern = pattern.toLowerCase();
    if (cleanPattern === '*' || cleanPattern === '/*') return true;

    // Support trailing /* matching exact /prefix (e.g. /search/* matching /search)
    const basePrefix = cleanPattern.endsWith('/*')
      ? cleanPattern.slice(0, -2)
      : cleanPattern.endsWith('*')
      ? cleanPattern.slice(0, -1)
      : null;

    if (basePrefix && (pathname === basePrefix || pathname === `${basePrefix}/`)) {
      return true;
    }

    // Convert simple glob pattern to Regex
    const regexStr = '^' + cleanPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    try {
      const regex = new RegExp(regexStr, 'i');
      return regex.test(pathname);
    } catch {
      return pathname.startsWith(cleanPattern);
    }
  }

  /**
   * Scans all Firestore cached bookmarks and builds a categorization plan.
   */
  async planCategorization(options: CategorizeOptions = {}): Promise<CategorizationSummary> {
    await collectionResolver.init();
    const rules = this.loadRules(options.rulesPath);

    logger.info(`Scanning Firestore bookmarks against ${rules.length} hierarchical rules...`);

    const snapshot = await db.bookmarks.get();
    const matches: CategorizationMatch[] = [];
    const collectionsToCreateSet = new Set<string>();

    snapshot.forEach((doc) => {
      const bookmark = doc.data();
      const match = this.evaluateBookmark(
        bookmark,
        rules,
        options.overwriteExistingCollections
      );

      if (match) {
        matches.push(match);
        if (match.isNewCollection && match.targetCollectionName) {
          collectionsToCreateSet.add(match.targetCollectionName);
        }
      }
    });

    logger.info(`Categorization plan: ${matches.length} matches across ${snapshot.size} bookmarks.`);

    return {
      totalScanned: snapshot.size,
      totalMatched: matches.length,
      collectionsToCreate: Array.from(collectionsToCreateSet),
      matches,
    };
  }

  /**
   * Applies categorization mutations to Raindrop API and reconciles Firestore cache.
   */
  async applyCategorization(summary: CategorizationSummary, dryRun = true): Promise<void> {
    if (dryRun) {
      logger.info(`[DRY-RUN] Previewed ${summary.matches.length} categorization actions.`);
      return;
    }

    // 1. Provision missing collections first
    const collectionNameToId = new Map<string, number>();
    for (const colName of summary.collectionsToCreate) {
      const newId = await collectionResolver.resolveOrProvision(colName, false);
      if (newId) {
        collectionNameToId.set(colName.toLowerCase(), newId);
      }
    }

    // 2. Dispatch updates to Raindrop
    logger.info(`Applying live categorization to ${summary.matches.length} bookmarks...`);
    let successfulUpdates = 0;
    const batch = db.raw.batch();

    for (const match of summary.matches) {
      try {
        let finalColId = match.targetCollectionId;
        if (!finalColId && match.targetCollectionName) {
          finalColId =
            collectionNameToId.get(match.targetCollectionName.toLowerCase()) ||
            collectionResolver.getCollectionId(match.targetCollectionName);
        }

        const updatePayload: Record<string, any> = {
          tags: match.finalTags,
        };

        if (finalColId && finalColId > 0 && finalColId !== match.currentCollectionId) {
          updatePayload.collection = { $id: finalColId };
        }

        if (match.important !== undefined) {
          updatePayload.important = match.important;
        }

        await raindropClient.updateRaindrop(match.bookmarkId, updatePayload);

        // Update Firestore
        const docRef = db.bookmarks.doc(String(match.bookmarkId));
        batch.update(docRef, {
          tags: match.finalTags,
          ...(finalColId ? { 'collection.$id': finalColId } : {}),
          synced_at: new Date().toISOString(),
        });

        successfulUpdates++;
      } catch (error) {
        logger.error(`Failed to categorize bookmark #${match.bookmarkId}: ${error}`);
      }
    }

    if (successfulUpdates > 0) {
      await batch.commit();
      logger.success(`Successfully categorized and tagged ${successfulUpdates} bookmarks.`);
    }
  }
}

export const hierarchicalCategorizerService = new HierarchicalCategorizerService();
