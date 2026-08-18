import pc from 'picocolors';
import type { CleanupSummary } from './orphan-cleaner.js';
import { logger } from '../../utils/logger.js';

export class CleanerReporter {
  printReport(summary: CleanupSummary, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '🧹 BrainDrop Empty Resource & Orphan Cleaner (DRY-RUN)'
        : '🧹 BrainDrop Resource Cleanup Results (LIVE)'
    );

    console.log(`  ${pc.bold('Total Collections Scanned:')}     ${summary.totalCollectionsScanned}`);
    console.log(
      `  ${pc.bold('Empty Collections Found:')}        ${
        summary.totalEmptyCollections > 0
          ? pc.yellow(String(summary.totalEmptyCollections))
          : pc.green('0')
      }`
    );
    console.log(
      `  ${pc.bold('Zero-Usage Tags Found:')}          ${
        summary.emptyTags.length > 0 ? pc.yellow(String(summary.emptyTags.length)) : pc.green('0')
      }\n`
    );

    if (summary.totalEmptyCollections === 0 && summary.emptyTags.length === 0) {
      logger.success('Your Raindrop library is completely clean! No orphan folders or dead tags found.');
      return;
    }

    const line = pc.gray('─'.repeat(60));

    if (summary.emptyCollections.length > 0) {
      console.log(pc.bold(pc.cyan('Empty Collections Targeted for Pruning:')));
      console.log(line);

      summary.emptyCollections.forEach((c, idx) => {
        const parentInfo = c.parentTitle ? pc.gray(`(inside: ${c.parentTitle})`) : pc.gray('(root)');
        console.log(
          `  ${pc.bold(`#${idx + 1}`)} ${pc.red('🗑️')} ID ${pc.bold(String(c.id))} | "${pc.yellow(
            c.title
          )}" ${parentInfo}`
        );
        console.log(`     Direct Bookmarks: 0 | Subtree Bookmarks: 0 | Depth: ${c.depth}`);
      });
      console.log();
    }

    if (summary.emptyTags.length > 0) {
      console.log(pc.bold(pc.cyan('Zero-Usage Tags Targeted for Pruning:')));
      console.log(line);
      console.log(`  [${pc.gray(summary.emptyTags.join(', '))}]\n`);
    }

    console.log(line);
    if (isDryRun) {
      console.log(
        pc.yellow(
          '\nℹ️  This was a DRY-RUN preview. To prune these empty collections and unused tags, run:\n' +
            pc.bold(pc.green('   npm run clean:apply\n'))
        )
      );
    }
  }
}

export const cleanerReporter = new CleanerReporter();
