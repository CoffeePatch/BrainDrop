import pc from 'picocolors';
import type { CategorizationSummary } from '../../types/rules.js';
import { logger } from '../../utils/logger.js';

export class CategorizerReporter {
  printReport(summary: CategorizationSummary, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '🗂️  BrainDrop Hierarchical Auto-Categorization Plan (DRY-RUN)'
        : '🗂️  BrainDrop Categorization Results (LIVE)'
    );

    console.log(`  ${pc.bold('Total Bookmarks Scanned:')}       ${summary.totalScanned}`);
    console.log(
      `  ${pc.bold('Bookmarks Matching Rules:')}      ${
        summary.totalMatched > 0 ? pc.yellow(String(summary.totalMatched)) : pc.green('0')
      }`
    );
    console.log(
      `  ${pc.bold('New Collections to Provision:')}  ${
        summary.collectionsToCreate.length > 0
          ? pc.cyan(summary.collectionsToCreate.join(', '))
          : pc.gray('None (all collections exist)')
      }\n`
    );

    if (summary.matches.length === 0) {
      logger.success('All bookmarks are already categorized and tagged! No changes needed.');
      return;
    }

    const line = pc.gray('─'.repeat(60));
    console.log(line);

    summary.matches.slice(0, 20).forEach((match, i) => {
      console.log(
        `  ${pc.bold(`#${i + 1}`)} ID ${pc.bold(String(match.bookmarkId))} | ${pc.cyan(
          match.matchedPattern
        )} | ${pc.gray(match.matchedRuleName)}`
      );
      console.log(`     Link: ${match.originalLink}`);

      if (match.tagsToAdd.length > 0) {
        console.log(`     🏷️  Add Tags: [${pc.green(match.tagsToAdd.join(', '))}]`);
      }

      if (match.targetCollectionName) {
        const badge = match.isNewCollection
          ? pc.magenta(`✨ [NEW] ${match.targetCollectionName}`)
          : pc.yellow(`${match.targetCollectionName} (#${match.targetCollectionId})`);
        console.log(`     📁 Move to Collection: ${badge}`);
      }

      console.log();
    });

    if (summary.matches.length > 20) {
      console.log(pc.gray(`  ... and ${summary.matches.length - 20} more bookmarks.`));
    }

    console.log(line);
    if (isDryRun) {
      console.log(
        pc.yellow(
          '\nℹ️  This was a DRY-RUN preview. To apply these categorizations and tags, run:\n' +
            pc.bold(pc.green('   npm run categorize:apply\n'))
        )
      );
    }
  }
}

export const categorizerReporter = new CategorizerReporter();
