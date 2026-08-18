import fs from 'node:fs';
import path from 'node:path';
import { FIRESTORE_LIMITS } from '../../config/constants.js';
import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import { RootConfigSchema } from '../../types/rules.js';
import type { RaindropTagItem } from '../../types/raindrop.js';
import type { FirestoreBookmark } from '../../types/firestore.js';
import type { TaxonomyConfig } from '../../types/rules.js';
import { logger } from '../../utils/logger.js';

export interface TagMergeGroup {
  canonicalTag: string;
  sourceTags: string[];
  totalUsageCount: number;
  reason: 'casing-conflict' | 'synonym-alias';
}

export interface TagTaxonomyReport {
  totalUniqueTags: number;
  allTags: Array<{ tag: string; count: number }>;
  caseConflictGroups: TagMergeGroup[];
  aliasGroups: TagMergeGroup[];
  bannedTagsFound: Array<{ tag: string; count: number }>;
  emptyTags: string[];
  globalReplaceMap: Record<string, string>;
  tagsToDelete: string[];
}

export type TagAnalysisSummary = TagTaxonomyReport;

export class TagNormalizerService {
  /**
   * Loads taxonomy configuration from environment variable RULES_JSON, rules.json, or defaults.
   */
  loadTaxonomyConfig(customPath?: string): TaxonomyConfig {
    // 1. Check process.env.RULES_JSON (GitHub Secret / Cloud environment)
    if (process.env.RULES_JSON) {
      try {
        const json = JSON.parse(process.env.RULES_JSON);
        const parsed = RootConfigSchema.parse(json);
        if (!Array.isArray(parsed) && parsed.taxonomy) {
          logger.info('Loaded taxonomy configuration from RULES_JSON environment secret.');
          return parsed.taxonomy;
        }
      } catch (error) {
        logger.warn(`Failed to parse RULES_JSON environment secret: ${error}`);
      }
    }

    // 2. Check local files
    const candidates = customPath
      ? [customPath]
      : [
          path.resolve(process.cwd(), 'rules.json'),
          path.resolve(process.cwd(), 'custom-rules.json'),
          path.resolve(process.cwd(), 'rules.example.json'),
        ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf-8');
          const json = JSON.parse(raw);
          const parsed = RootConfigSchema.parse(json);
          if (!Array.isArray(parsed) && parsed.taxonomy) {
            logger.info(`Loaded taxonomy configuration from ${path.basename(p)}`);
            return parsed.taxonomy;
          }
        } catch (error) {
          logger.warn(`Failed to read taxonomy from ${p}: ${error}`);
        }
      }
    }

    // Default fallback taxonomy
    return {
      casing: 'lowercase',
      acronyms: ['AI', 'JAV', 'LLM', 'AWS', 'GCP', 'API', 'UI', 'UX', 'PDF', 'SQL', 'CSS', 'HTML'],
      aliases: {},
      bannedTags: [],
    };
  }

  /**
   * Helper to format a canonical tag while preserving technical acronyms.
   */
  formatCanonicalTag(tag: string, acronyms: Set<string>, casing: 'lowercase' | 'kebab-case' | 'preserve'): string {
    const trimmed = tag.trim();
    const upper = trimmed.toUpperCase();

    if (acronyms.has(upper)) {
      return upper;
    }

    if (casing === 'kebab-case') {
      return trimmed
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_:]/g, '');
    }

    if (casing === 'preserve') {
      return trimmed;
    }

    return trimmed.toLowerCase();
  }

  /**
   * Analyzes all tags in the Raindrop library for casing conflicts, aliases, banned tags, and dead tags.
   */
  async analyzeTaxonomy(customTaxonomy?: TaxonomyConfig): Promise<TagTaxonomyReport> {
    const taxonomy = customTaxonomy || this.loadTaxonomyConfig();
    const acronymsSet = new Set((taxonomy.acronyms || []).map((a) => a.toUpperCase()));
    const aliasMap = new Map<string, string>();
    for (const [source, target] of Object.entries(taxonomy.aliases || {})) {
      aliasMap.set(source.trim().toLowerCase(), target.trim());
    }
    const bannedSet = new Set((taxonomy.bannedTags || []).map((t) => t.trim().toLowerCase()));

    logger.info('Fetching global tag taxonomy from Raindrop API...');

    let tagItems: RaindropTagItem[] = [];
    try {
      const response = await raindropClient.getTags(0);
      tagItems = response.items || [];
    } catch {
      logger.warn('Could not fetch live tags from Raindrop API. Reading Firestore cache...');
      const snapshot = await db.bookmarks.get();
      const tagCountMap = new Map<string, number>();
      snapshot.forEach((doc) => {
        const b = doc.data() as FirestoreBookmark;
        for (const t of b.tags || []) {
          tagCountMap.set(t, (tagCountMap.get(t) || 0) + 1);
        }
      });
      tagItems = Array.from(tagCountMap.entries()).map(([tag, count]) => ({ _id: tag, count }));
    }

    const lowerMap = new Map<string, Array<{ original: string; count: number }>>();
    const emptyTags: string[] = [];
    const bannedTagsFound: Array<{ tag: string; count: number }> = [];

    for (const item of tagItems) {
      const original = item._id;
      const count = item.count;
      const lower = original.trim().toLowerCase();

      if (count === 0) {
        emptyTags.push(original);
      }

      if (bannedSet.has(lower)) {
        bannedTagsFound.push({ tag: original, count });
      }

      if (!lower) continue;

      if (!lowerMap.has(lower)) {
        lowerMap.set(lower, []);
      }
      lowerMap.get(lower)!.push({ original, count });
    }

    const caseConflictGroups: TagMergeGroup[] = [];
    const aliasGroups: TagMergeGroup[] = [];
    const globalReplaceMap: Record<string, string> = {};
    const tagsToDeleteSet = new Set<string>();

    // 1. Process Casing Conflicts
    for (const [lower, variations] of lowerMap.entries()) {
      if (variations.length >= 2) {
        const canonical = this.formatCanonicalTag(lower, acronymsSet, taxonomy.casing);
        const sourceTags = variations.map((v) => v.original);
        const totalUsageCount = variations.reduce((sum, v) => sum + v.count, 0);

        caseConflictGroups.push({
          canonicalTag: canonical,
          sourceTags,
          totalUsageCount,
          reason: 'casing-conflict',
        });

        for (const variant of sourceTags) {
          if (variant !== canonical) {
            globalReplaceMap[variant] = canonical;
          }
        }
      }
    }

    // 2. Process Synonym Aliases
    for (const [sourceLower, target] of aliasMap.entries()) {
      const variations = lowerMap.get(sourceLower);
      if (variations && variations.length > 0) {
        const sourceTags = variations.map((v) => v.original);
        const totalUsageCount = variations.reduce((sum, v) => sum + v.count, 0);

        aliasGroups.push({
          canonicalTag: target,
          sourceTags,
          totalUsageCount,
          reason: 'synonym-alias',
        });

        for (const variant of sourceTags) {
          if (variant !== target) {
            globalReplaceMap[variant] = target;
          }
        }
      }
    }

    // 3. Process Banned Tags & Empty Tags for Deletion
    for (const banned of bannedTagsFound) {
      tagsToDeleteSet.add(banned.tag);
    }
    for (const empty of emptyTags) {
      tagsToDeleteSet.add(empty);
    }

    return {
      totalUniqueTags: tagItems.length,
      allTags: tagItems.map((t) => ({ tag: t._id, count: t.count })),
      caseConflictGroups,
      aliasGroups,
      bannedTagsFound,
      emptyTags,
      globalReplaceMap,
      tagsToDelete: Array.from(tagsToDeleteSet),
    };
  }

  /**
   * Backwards compatible analyzeTags method.
   */
  async analyzeTags(): Promise<{ totalUniqueTags: number; caseConflictGroups: TagMergeGroup[]; emptyTags: string[] }> {
    const report = await this.analyzeTaxonomy();
    return {
      totalUniqueTags: report.totalUniqueTags,
      caseConflictGroups: [...report.caseConflictGroups, ...report.aliasGroups],
      emptyTags: report.emptyTags,
    };
  }

  /**
   * Applies global tag renames via PUT /tags/0 and tag deletes via DELETE /tags/0.
   */
  async applyTagNormalization(report: TagTaxonomyReport, dryRun = true): Promise<void> {
    const replaceCount = Object.keys(report.globalReplaceMap).length;
    const deleteCount = report.tagsToDelete.length;

    if (dryRun) {
      logger.info(
        `[DRY-RUN] Previewed ${replaceCount} tag renames and ${deleteCount} tag deletions.`
      );
      return;
    }

    // 1. Single API Call: Global Tag Replace in Raindrop (PUT /tags/0)
    if (replaceCount > 0) {
      logger.info(`Applying ${replaceCount} global tag renames via Raindrop PUT /tags/0...`);
      try {
        await raindropClient.renameTags(0, report.globalReplaceMap);
        logger.success(`Successfully renamed ${replaceCount} tags across all bookmarks.`);
      } catch (error) {
        logger.error(`Failed to execute global tag rename: ${error}`);
      }
    }

    // 2. Single API Call: Global Tag Deletion in Raindrop (DELETE /tags/0)
    if (deleteCount > 0) {
      logger.info(`Purging ${deleteCount} banned/dead tags via Raindrop DELETE /tags/0...`);
      try {
        await raindropClient.deleteTags(0, report.tagsToDelete);
        logger.success(`Successfully purged ${deleteCount} tags.`);
      } catch (error) {
        logger.error(`Failed to purge tags: ${error}`);
      }
    }

    // 3. Reconcile Firestore Cache
    logger.info('Reconciling Firestore bookmark tags cache...');
    const snapshot = await db.bookmarks.get();
    let fsBatch = db.raw.batch();
    let updatedDocs = 0;

    const renameMapLower = new Map<string, string>();
    for (const [oldTag, newTag] of Object.entries(report.globalReplaceMap)) {
      renameMapLower.set(oldTag.toLowerCase(), newTag);
    }
    const deleteSetLower = new Set(report.tagsToDelete.map((t) => t.toLowerCase()));

    for (const doc of snapshot.docs) {
      const bookmark = doc.data() as FirestoreBookmark;
      let tagsChanged = false;
      const newTags: string[] = [];

      for (const t of bookmark.tags || []) {
        const lower = t.toLowerCase();
        if (deleteSetLower.has(lower)) {
          tagsChanged = true;
          continue; // Strip deleted tag
        }

        if (renameMapLower.has(lower)) {
          newTags.push(renameMapLower.get(lower)!);
          tagsChanged = true;
        } else {
          newTags.push(t);
        }
      }

      if (tagsChanged) {
        // Deduplicate tags
        const uniqueSet = new Set(newTags);
        const deduplicatedTags = Array.from(uniqueSet);

        fsBatch.update(doc.ref, {
          tags: deduplicatedTags,
          synced_at: new Date().toISOString(),
        });
        updatedDocs++;

        if (updatedDocs % FIRESTORE_LIMITS.MAX_BATCH_WRITE_SIZE === 0) {
          await fsBatch.commit();
          fsBatch = db.raw.batch();
        }
      }
    }

    if (updatedDocs % FIRESTORE_LIMITS.MAX_BATCH_WRITE_SIZE !== 0) {
      await fsBatch.commit();
    }

    logger.success(`Reconciled ${updatedDocs} bookmark documents in Firestore cache.`);
  }

  /**
   * Inspects specific bookmarks carrying a given tag.
   */
  async inspectTag(tagName: string): Promise<FirestoreBookmark[]> {
    const clean = tagName.trim().toLowerCase();
    const snapshot = await db.bookmarks.get();
    const matches: FirestoreBookmark[] = [];

    for (const doc of snapshot.docs) {
      const b = doc.data() as FirestoreBookmark;
      if ((b.tags || []).some((t) => t.trim().toLowerCase() === clean)) {
        matches.push(b);
      }
    }

    return matches;
  }

  /**
   * Exports full tag inventory to a local private JSON file.
   */
  async exportInventory(outputPath = 'tags-inventory.json'): Promise<string> {
    const report = await this.analyzeTaxonomy();
    const absPath = path.resolve(process.cwd(), outputPath);

    // Sort all tags by bookmark count descending
    const sortedTags = [...(report.allTags || [])].sort((a, b) => b.count - a.count);

    const data = {
      exportedAt: new Date().toISOString(),
      totalUniqueTags: report.totalUniqueTags,
      tags: sortedTags,
      casingConflicts: report.caseConflictGroups,
      synonymAliases: report.aliasGroups,
      bannedTags: report.bannedTagsFound,
      emptyTags: report.emptyTags,
      suggestedReplaceMap: report.globalReplaceMap,
    };

    fs.writeFileSync(absPath, JSON.stringify(data, null, 2), 'utf-8');
    logger.success(`Tag inventory exported to ${absPath}`);
    return absPath;
  }
}

export const tagNormalizerService = new TagNormalizerService();
