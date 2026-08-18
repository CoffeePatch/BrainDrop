import pc from 'picocolors';
import type { TagAnalysisSummary } from './tag-normalizer.js';
import { logger } from '../../utils/logger.js';

export class TagReporter {
  printReport(summary: TagAnalysisSummary, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '🏷️  BrainDrop Tag Normalization Plan (DRY-RUN)'
        : '🏷️  BrainDrop Tag Normalization Results (LIVE)'
    );

    console.log(`  ${pc.bold('Total Unique Tags:')}          ${summary.totalUniqueTags}`);
    console.log(
      `  ${pc.bold('Casing Conflict Groups:')}    ${
        summary.caseConflictGroups.length > 0
          ? pc.yellow(String(summary.caseConflictGroups.length))
          : pc.green('0')
      }`
    );
    console.log(
      `  ${pc.bold('Empty Tags to Prune:')}       ${
        summary.emptyTags.length > 0
          ? pc.red(String(summary.emptyTags.length))
          : pc.green('0')
      }\n`
    );

    if (summary.caseConflictGroups.length === 0 && summary.emptyTags.length === 0) {
      logger.success('All tags are perfectly normalized! No conflicts found.');
      return;
    }

    const line = pc.gray('─'.repeat(60));

    if (summary.caseConflictGroups.length > 0) {
      console.log(pc.bold(pc.cyan('Tag Casing Conflict Groups:')));
      console.log(line);
      summary.caseConflictGroups.forEach((group, idx) => {
        console.log(
          `  ${pc.bold(`#${idx + 1}`)} Target: ${pc.green(
            pc.bold(group.canonicalTag)
          )} (Usage: ${group.totalUsageCount} bookmarks)`
        );
        console.log(`     Variations to merge: [${pc.gray(group.sourceTags.join(', '))}]`);
      });
      console.log();
    }

    if (summary.emptyTags.length > 0) {
      console.log(pc.bold(pc.red('Empty Tags (0 bookmarks):')));
      console.log(`  [${summary.emptyTags.join(', ')}]\n`);
    }

    console.log(line);
    if (isDryRun) {
      console.log(
        pc.yellow(
          '\nℹ️  This was a DRY-RUN preview. To apply these tag mergers live, run:\n' +
            pc.bold(pc.green('   npm run tags:apply\n'))
        )
      );
    }
  }
}

export const tagReporter = new TagReporter();
