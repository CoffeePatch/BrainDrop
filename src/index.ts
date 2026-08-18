#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { db } from './clients/firestore.js';
import { raindropClient } from './clients/raindrop.js';
import { ensureCredentials, env } from './config/env.js';
import { duplicateClusterDetector } from './services/duplicate/cluster-detector.js';
import { keeperResolver } from './services/duplicate/keeper-resolver.js';
import { duplicateMutationExecutor } from './services/duplicate/mutation-executor.js';
import { duplicateReporter } from './services/duplicate/reporter.js';
import { orphanCleanerService } from './services/cleaner/orphan-cleaner.js';
import { cleanerReporter } from './services/cleaner/cleaner-reporter.js';
import { linkAuditorService } from './services/links/link-auditor.js';
import { linkReporter } from './services/links/reporter.js';
import { hierarchicalCategorizerService } from './services/rules/categorizer.js';
import { categorizerReporter } from './services/rules/categorizer-reporter.js';
import { ruleEngineService } from './services/rules/rule-engine.js';
import { ruleReporter } from './services/rules/reporter.js';
import { incrementalSyncService } from './services/sync/incremental-sync.js';
import { syncStateManager } from './services/sync/sync-state.js';
import { tagNormalizerService } from './services/tags/tag-normalizer.js';
import { tagReporter } from './services/tags/reporter.js';
import { KeeperStrategy } from './types/duplicate.js';
import type { DuplicateMutationPlan, DuplicateRunSummary } from './types/duplicate.js';
import { logger } from './utils/logger.js';

const program = new Command();

program
  .name('braindrop')
  .description('💧 Intelligent, zero-cost personal bookmark automation platform for Raindrop.io')
  .version('1.0.0');

// ==============================================================================
// Command: sync (Feature 02 - Incremental Sync Engine)
// ==============================================================================
program
  .command('sync')
  .description('Incrementally synchronize modified bookmarks from Raindrop to Firestore')
  .option('-f, --full', 'Perform a full library scan ignoring sync checkpoint', false)
  .action(async (options) => {
    ensureCredentials(true);
    logger.header('💧 BrainDrop: Incremental Sync');
    logger.info(`Mode: ${options.full ? 'Full Scan' : 'Incremental Delta'}`);

    try {
      const result = await incrementalSyncService.runSync({
        forceFullScan: options.full,
      });

      console.log(`\n  ${pc.bold('Sync Mode:')}       ${result.mode}`);
      console.log(`  ${pc.bold('Fetched Items:')}   ${result.totalFetched}`);
      console.log(`  ${pc.bold('Committed Items:')} ${result.totalCommitted}`);
      console.log(`  ${pc.bold('Duration:')}        ${(result.durationMs / 1000).toFixed(2)}s`);
      if (result.latestTimestamp) {
        console.log(`  ${pc.bold('Latest Delta:')}    ${result.latestTimestamp}\n`);
      }
    } catch (error) {
      logger.error(`Sync execution aborted: ${error}`);
      process.exit(1);
    }
  });

// ==============================================================================
// Command: duplicates (Feature 01 - Intelligent Duplicate Remover)
// ==============================================================================
program
  .command('duplicates')
  .description('Detect duplicate bookmarks and merge metadata non-destructively')
  .option('-d, --dry-run', 'Generate audit report without applying mutations to Raindrop', true)
  .option('-l, --live', 'Apply mutations directly to Raindrop API and Trash duplicate copies', false)
  .option(
    '-s, --strategy <strategy>',
    'Keeper strategy: KEEP_NEWEST_INHERIT_OLD | KEEP_OLDEST_MERGE_NEW | KEEP_RICHEST',
    env.DEFAULT_KEEPER_STRATEGY
  )
  .action(async (options) => {
    const isDryRun = !options.live;
    if (!isDryRun) {
      ensureCredentials(true);
    }

    const strategy =
      (options.strategy as KeeperStrategy) || KeeperStrategy.KEEP_NEWEST_INHERIT_OLD;

    try {
      const clusters = await duplicateClusterDetector.detectClusters();
      const plans: DuplicateMutationPlan[] = [];
      let totalDuplicatesToTrash = 0;
      let keepersRequiringTagMerge = 0;
      let keepersRequiringCollectionMove = 0;

      for (const cluster of clusters) {
        const plan = keeperResolver.resolveCluster(cluster, strategy);
        plans.push(plan);
        totalDuplicatesToTrash += plan.duplicatesToTrash.length;
        if (plan.keeper.mergedTags.length !== plan.keeper.existingTags.length) {
          keepersRequiringTagMerge++;
        }
        if (plan.keeper.targetCollectionId !== plan.keeper.currentCollectionId) {
          keepersRequiringCollectionMove++;
        }
      }

      const summary: DuplicateRunSummary = {
        totalScanned: clusters.reduce((sum, c) => sum + c.bookmarks.length, 0),
        clustersDetected: clusters.length,
        duplicatesTargetedForTrash: totalDuplicatesToTrash,
        keepersRequiringTagMerge,
        keepersRequiringCollectionMove,
        plans,
      };

      duplicateReporter.printReport(summary, isDryRun);

      if (!isDryRun && plans.length > 0) {
        logger.info(`Applying live mutations to Raindrop API across ${plans.length} clusters...`);
        const executionResult = await duplicateMutationExecutor.executeAll(plans, false);
        logger.success(
          `Resolved ${executionResult.successfulClusters}/${plans.length} clusters. ` +
            `Updated ${executionResult.totalKeepersUpdated} Keepers and moved ${executionResult.totalDuplicatesTrashed} duplicate copies to Trash.`
        );
      }
    } catch (error) {
      logger.error(`Duplicate detection error: ${error}`);
      process.exit(1);
    }
  });

// ==============================================================================
// Command: tags (Feature 04 - Tag Normalizer & Taxonomy Cleaner)
// ==============================================================================
program
  .command('tags')
  .description('Audit tag casing conflicts, merge duplicate tags, and prune empty tags')
  .option('-d, --dry-run', 'Preview tag normalization plan without applying mutations', true)
  .option('-l, --live', 'Merge tag casing conflicts and prune empty tags via Raindrop API', false)
  .action(async (options) => {
    const isDryRun = !options.live;
    if (!isDryRun) {
      ensureCredentials(false);
    }

    try {
      const summary = await tagNormalizerService.analyzeTags();
      tagReporter.printReport(summary, isDryRun);

      if (!isDryRun && (summary.caseConflictGroups.length > 0 || summary.emptyTags.length > 0)) {
        await tagNormalizerService.applyTagNormalization(summary, false);
      }
    } catch (error) {
      logger.error(`Tag normalizer error: ${error}`);
      process.exit(1);
    }
  });

// ==============================================================================
// Command: rules (Feature 07 - Deterministic Domain Rule Engine)
// ==============================================================================
program
  .command('rules')
  .description('Evaluate deterministic domain routing and auto-tagging rules')
  .option('-d, --dry-run', 'Preview domain rule actions without modifying bookmarks', true)
  .option('-l, --live', 'Apply domain tags and collection moves directly to Raindrop API', false)
  .action(async (options) => {
    const isDryRun = !options.live;
    if (!isDryRun) {
      ensureCredentials(true);
    }

    try {
      const summary = await ruleEngineService.evaluateAll();
      ruleReporter.printReport(summary, isDryRun);

      if (!isDryRun && summary.actions.length > 0) {
        await ruleEngineService.applyActions(summary.actions, false);
      }
    } catch (error) {
      logger.error(`Rule engine error: ${error}`);
      process.exit(1);
    }
  });

// ==============================================================================
// Command: categorize (Feature 06/07 - Hierarchical Syntax & Collection Categorizer)
// ==============================================================================
program
  .command('categorize')
  .description('Organize bookmarks into collections and add tags via hierarchical rules.json')
  .option('-c, --config <path>', 'Custom path to rules JSON configuration file')
  .option('-o, --overwrite', 'Overwrite collection for bookmarks already in curated folders', false)
  .option('-d, --dry-run', 'Preview categorization plan without applying mutations', true)
  .option('-l, --live', 'Apply collection moves, create missing folders, and add tags in Raindrop', false)
  .action(async (options) => {
    const isDryRun = !options.live;
    if (!isDryRun) {
      ensureCredentials(true);
    }

    try {
      const summary = await hierarchicalCategorizerService.planCategorization({
        rulesPath: options.config,
        overwriteExistingCollections: options.overwrite,
      });

      categorizerReporter.printReport(summary, isDryRun);

      if (!isDryRun && summary.matches.length > 0) {
        await hierarchicalCategorizerService.applyCategorization(summary, false);
      }
    } catch (error) {
      logger.error(`Categorization error: ${error}`);
      process.exit(1);
    }
  });

// ==============================================================================
// Command: links (Feature 03 - Broken Link & Redirect Resolver)
// ==============================================================================
program
  .command('links')
  .description('Probe cached bookmark URLs for 301 redirects and dead 404 links')
  .option('-n, --limit <count>', 'Number of bookmarks to audit in this batch', '50')
  .option('-d, --dry-run', 'Audit links without updating destination URLs or flags', true)
  .option('-l, --live', 'Update destination URLs and flag broken links in Raindrop', false)
  .action(async (options) => {
    const isDryRun = !options.live;
    if (!isDryRun) {
      ensureCredentials(true);
    }

    const limit = parseInt(options.limit, 10) || 50;

    try {
      const summary = await linkAuditorService.auditBookmarks(limit);
      linkReporter.printReport(summary, isDryRun);

      if (!isDryRun && summary.results.some((r) => r.isBroken || r.isRedirect)) {
        await linkAuditorService.applyAuditResults(summary.results, false);
      }
    } catch (error) {
      logger.error(`Link auditor error: ${error}`);
      process.exit(1);
    }
  });

// ==============================================================================
// Command: clean (Feature 09 - Orphan Collection & Empty Resource Cleaner)
// ==============================================================================
program
  .command('clean')
  .description('Prune abandoned empty collections and zero-usage tags')
  .option('-p, --protected <titles...>', 'List of collection names to protect from pruning')
  .option('-d, --dry-run', 'Preview empty collections and dead tags without deleting', true)
  .option('-l, --live', 'Delete empty collections and prune zero-usage tags in Raindrop', false)
  .action(async (options) => {
    const isDryRun = !options.live;
    if (!isDryRun) {
      ensureCredentials(false);
    }

    try {
      const summary = await orphanCleanerService.scanOrphanResources({
        protectedCollections: options.protected,
      });

      cleanerReporter.printReport(summary, isDryRun);

      if (!isDryRun && (summary.emptyCollections.length > 0 || summary.emptyTags.length > 0)) {
        await orphanCleanerService.applyCleanup(summary, false);
      }
    } catch (error) {
      logger.error(`Cleaner error: ${error}`);
      process.exit(1);
    }
  });

// ==============================================================================
// Command: check / ping (Read-Only Connectivity Health Check)
// ==============================================================================
program
  .command('check')
  .alias('ping')
  .description('Perform a read-only health check to verify Raindrop API and Firestore connections')
  .action(async () => {
    logger.header('🔌 BrainDrop: Connectivity & Authentication Health Check');

    // 1. Check Raindrop.io API
    console.log(pc.bold('1. Raindrop.io API:'));
    if (!env.RAINDROP_TOKEN) {
      console.log(`  ${pc.red('❌ RAINDROP_TOKEN is missing.')} Set it in .env`);
    } else {
      try {
        const collectionsRes = await raindropClient.getCollections();
        const rootCollections = collectionsRes.items || [];
        const remaining = raindropClient['rateLimiter'].getRemainingTokens();
        console.log(`  ${pc.green('✅ Connected successfully!')}`);
        console.log(`     Authenticated User Collections: ${pc.bold(String(rootCollections.length))}`);
        console.log(`     API Rate Limit Quota Remaining: ${pc.bold(String(remaining))} req/min`);
      } catch (error: any) {
        console.log(`  ${pc.red('❌ Raindrop API Connection Failed:')} ${error.message}`);
      }
    }

    console.log();

    // 2. Check Google Cloud Firestore
    console.log(pc.bold('2. Google Cloud Firestore:'));
    try {
      const firestore = db.raw;
      const testQuery = await db.syncState.limit(1).get();
      console.log(`  ${pc.green('✅ Connected successfully!')}`);
      console.log(`     Project ID: ${pc.bold(env.FIREBASE_PROJECT_ID || 'Connected')}`);
      console.log(`     Database Read Access: ${pc.green('OK (0 writes incurred)')}`);
    } catch (error: any) {
      console.log(`  ${pc.red('❌ Firestore Connection Failed:')} ${error.message}`);
    }

    console.log();
    logger.success('Connectivity check completed.');
  });

// ==============================================================================
// Command: status (System Health & Quota Overview)
// ==============================================================================
program
  .command('status')
  .description('Display library metrics, sync status, and storage budget')
  .action(async () => {
    logger.header('📊 BrainDrop: System Status & Free Tier Quotas');
    console.log(`  ${pc.bold('Raindrop API Base:')}  https://api.raindrop.io/rest/v1`);
    console.log(`  ${pc.bold('Firestore Project:')}  ${env.FIREBASE_PROJECT_ID || '(Not configured)'}`);
    console.log(`  ${pc.bold('Default Strategy:')}   ${env.DEFAULT_KEEPER_STRATEGY}`);
    console.log(`  ${pc.bold('Firestore Batch:')}    ${env.FIRESTORE_BATCH_SIZE} docs/commit`);

    try {
      const checkpoint = await syncStateManager.getSyncCheckpoint();
      if (checkpoint) {
        console.log(`\n  ${pc.bold('Last Sync Status:')}   ${pc.green(checkpoint.status)}`);
        console.log(`  ${pc.bold('Last Sync Date:')}     ${checkpoint.last_sync_timestamp}`);
        console.log(`  ${pc.bold('Synced Bookmarks:')}   ${checkpoint.total_bookmarks_synced}`);
        console.log(`  ${pc.bold('Sync Duration:')}      ${(checkpoint.last_sync_duration_ms / 1000).toFixed(2)}s`);
      } else {
        console.log(`\n  ${pc.gray('No sync checkpoint recorded yet. Run `npm run sync` to initialize.')}`);
      }
    } catch {
      // Ignored if Firestore not connected yet
    }
    console.log();
  });

program.parse(process.argv);
