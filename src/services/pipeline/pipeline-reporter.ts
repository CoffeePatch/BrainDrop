import pc from 'picocolors';
import type { CoalescedMutationPlan } from './coalescer.js';
import type { CleanupSummary } from '../cleaner/orphan-cleaner.js';
import type { SyncResult } from '../sync/incremental-sync.js';
import { logger } from '../../utils/logger.js';

export interface PipelineExecutionReport {
  syncResult?: SyncResult;
  mutationPlan: CoalescedMutationPlan;
  orphanSummary?: CleanupSummary;
  durationMs: number;
}

export class PipelineReporter {
  printReport(report: PipelineExecutionReport, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '⚡ BrainDrop Unified Pipeline Execution Plan (DRY-RUN)'
        : '⚡ BrainDrop Unified Pipeline Execution Results (LIVE)'
    );

    const plan = report.mutationPlan;

    if (report.syncResult) {
      console.log(
        `  ${pc.bold('📥 Ingestion Mode:')}           ${pc.cyan(report.syncResult.mode)} (${
          report.syncResult.totalFetched
        } bookmarks synced)`
      );
    }

    console.log(
      `  ${pc.bold('✨ Coalesced Updates:')}        ${
        plan.bookmarksToUpdate.length > 0
          ? pc.green(String(plan.bookmarksToUpdate.length))
          : pc.gray('0')
      }`
    );
    console.log(
      `  ${pc.bold('🗑️  Duplicates to Trash:')}      ${
        plan.totalDuplicatesToTrash > 0
          ? pc.red(String(plan.totalDuplicatesToTrash))
          : pc.gray('0')
      }`
    );
    console.log(
      `  ${pc.bold('🚫 Cancelled Trash Updates:')}  ${
        plan.cancelledUpdatesOnTrashCount > 0
          ? pc.yellow(String(plan.cancelledUpdatesOnTrashCount))
          : pc.gray('0')
      }`
    );
    console.log(
      `  ${pc.bold('🎯 API Calls Saved:')}          ${pc.bold(
        pc.green(String(plan.apiCallsSavedByCoalescing))
      )} redundant requests eliminated`
    );
    console.log(
      `  ${pc.bold('🚀 Total API Calls Needed:')}    ${pc.bold(
        String(plan.totalEstimatedApiCalls)
      )} requests`
    );

    if (report.orphanSummary) {
      console.log(
        `  ${pc.bold('🧹 Empty Folders to Prune:')}   ${report.orphanSummary.totalEmptyCollections}`
      );
      console.log(
        `  ${pc.bold('🏷️  Dead Tags to Prune:')}       ${report.orphanSummary.emptyTags.length}`
      );
    }

    console.log();

    if (plan.bookmarksToUpdate.length === 0 && plan.totalDuplicatesToTrash === 0) {
      logger.success('All bookmarks are fully synchronized, clean, and organized! Zero actions required.');
      return;
    }

    const line = pc.gray('─'.repeat(60));
    console.log(line);
    console.log(pc.bold(pc.cyan('Coalesced Bookmark Actions Sample:')));
    console.log(line);

    plan.bookmarksToUpdate.slice(0, 15).forEach((b, idx) => {
      console.log(
        `  ${pc.bold(`#${idx + 1}`)} ID ${pc.bold(String(b.bookmarkId))} | Engines: [${pc.gray(
          b.sourceEngines.join(', ')
        )}]`
      );
      console.log(`     Link: ${b.originalLink}`);

      if (b.tagsToAdd.length > 0) {
        console.log(`     🏷️  Add Tags: [${pc.green(b.tagsToAdd.join(', '))}]`);
      }

      if (b.targetCollectionId && b.targetCollectionId !== b.currentCollectionId) {
        console.log(
          `     📁 Move Folder: #${b.currentCollectionId} -> ${pc.yellow(
            b.targetCollectionName || `#${b.targetCollectionId}`
          )}`
        );
      }

      if (b.mergedNote) {
        console.log(`     📝 Inherited Note attached`);
      }
      console.log();
    });

    if (plan.bookmarksToUpdate.length > 15) {
      console.log(pc.gray(`  ... and ${plan.bookmarksToUpdate.length - 15} more updates.`));
    }

    console.log(line);
    if (isDryRun) {
      console.log(
        pc.yellow(
          '\nℹ️  This was a DRY-RUN preview. To execute this entire unified pipeline live, run:\n' +
            pc.bold(pc.green('   npm run pipeline:apply\n'))
        )
      );
    } else {
      logger.success(
        `Pipeline execution completed in ${(report.durationMs / 1000).toFixed(2)}s.`
      );
    }
  }
}

export const pipelineReporter = new PipelineReporter();
