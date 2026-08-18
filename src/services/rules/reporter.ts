import pc from 'picocolors';
import type { RuleRunSummary } from './rule-engine.js';
import { logger } from '../../utils/logger.js';

export class RuleReporter {
  printReport(summary: RuleRunSummary, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '⚡ BrainDrop Domain Rule Evaluation (DRY-RUN)'
        : '⚡ BrainDrop Domain Rule Execution (LIVE)'
    );

    console.log(`  ${pc.bold('Total Bookmarks Scanned:')}     ${summary.totalEvaluated}`);
    console.log(
      `  ${pc.bold('Bookmarks Matching Rules:')}    ${
        summary.totalMatches > 0 ? pc.yellow(String(summary.totalMatches)) : pc.green('0')
      }\n`
    );

    if (summary.actions.length === 0) {
      logger.success('All bookmarks already conform to domain rules! No updates required.');
      return;
    }

    const line = pc.gray('─'.repeat(60));
    console.log(line);

    summary.actions.slice(0, 15).forEach((action, i) => {
      console.log(
        `  ${pc.bold(`#${i + 1}`)} ID ${pc.bold(String(action.bookmarkId))} | ${pc.cyan(
          action.domain
        )} | ${pc.gray(action.ruleName)}`
      );
      console.log(`     Link: ${action.link}`);
      if (action.tagsToAdd.length > 0) {
        console.log(`     🏷️  Add Tags: [${pc.green(action.tagsToAdd.join(', '))}]`);
      }
      if (action.targetCollectionName && action.targetCollectionId) {
        console.log(
          `     📁 Move to Collection: ${pc.yellow(action.targetCollectionName)} (#${
            action.targetCollectionId
          })`
        );
      }
      console.log();
    });

    if (summary.actions.length > 15) {
      console.log(pc.gray(`  ... and ${summary.actions.length - 15} more matches.`));
    }

    console.log(line);
    if (isDryRun) {
      console.log(
        pc.yellow(
          '\nℹ️  This was a DRY-RUN preview. To apply these rule categorizations, run:\n' +
            pc.bold(pc.green('   npm run rules:apply\n'))
        )
      );
    }
  }
}

export const ruleReporter = new RuleReporter();
