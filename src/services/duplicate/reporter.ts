import pc from 'picocolors';
import type { DuplicateMutationPlan, DuplicateRunSummary } from '../../types/duplicate.js';
import { logger } from '../../utils/logger.js';

export class DuplicateReporter {
  /**
   * Prints structured terminal summary and plan details.
   */
  printReport(summary: DuplicateRunSummary, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '🔍 BrainDrop Duplicate Detection Plan (DRY-RUN)'
        : '🚀 BrainDrop Duplicate Resolution Results (LIVE)'
    );

    console.log(`  ${pc.bold('Total Bookmarks Scanned:')}         ${summary.totalScanned}`);
    console.log(
      `  ${pc.bold('Duplicate Clusters Found:')}        ${
        summary.clustersDetected > 0
          ? pc.yellow(String(summary.clustersDetected))
          : pc.green('0')
      }`
    );
    console.log(
      `  ${pc.bold('Redundant Copies to Trash:')}       ${
        summary.duplicatesTargetedForTrash > 0
          ? pc.red(String(summary.duplicatesTargetedForTrash))
          : pc.green('0')
      }`
    );
    console.log(
      `  ${pc.bold('Keepers Requiring Tag Merge:')}     ${summary.keepersRequiringTagMerge}`
    );
    console.log(
      `  ${pc.bold('Keepers Inheriting Collection:')}   ${summary.keepersRequiringCollectionMove}\n`
    );

    if (summary.plans.length === 0) {
      logger.success('No duplicate bookmarks found! Your library is clean.');
      return;
    }

    const line = pc.gray('─'.repeat(60));

    summary.plans.forEach((plan, index) => {
      console.log(line);
      console.log(
        `${pc.bold(pc.cyan(`Cluster #${index + 1}:`))} ${pc.bold(plan.canonicalUrl)}`
      );
      console.log(`  ${pc.gray('Strategy:')} ${plan.strategy}`);
      console.log(
        `  ${pc.green('👑 Selected Keeper:')} ID ${pc.bold(String(plan.keeper.id))} (Col #${
          plan.keeper.targetCollectionId
        })`
      );
      console.log(`     Existing Tags: [${plan.keeper.existingTags.join(', ')}]`);
      if (plan.keeper.mergedTags.length !== plan.keeper.existingTags.length) {
        console.log(
          `     ✨ ${pc.magenta('Merged Tags:')}   [${pc.bold(
            plan.keeper.mergedTags.join(', ')
          )}]`
        );
      }
      if (plan.keeper.targetCollectionId !== plan.keeper.currentCollectionId) {
        console.log(
          `     📁 ${pc.yellow('Inherited Collection:')} Moved from Col #${
            plan.keeper.currentCollectionId
          } -> Col #${plan.keeper.targetCollectionId}`
        );
      }

      console.log(`  ${pc.red('🗑️ Targeted for Raindrop Trash:')}`);
      plan.duplicatesToTrash.forEach((dup) => {
        console.log(
          `     - ID ${dup.id} | Col #${dup.collectionId} | Created: ${
            dup.created ? dup.created.split('T')[0] : 'N/A'
          } | "${dup.title.slice(0, 40)}"`
        );
      });
      console.log();
    });

    console.log(line);
    if (isDryRun) {
      console.log(
        pc.yellow(
          `\nℹ️  This was a DRY-RUN preview. No changes were made to Raindrop or Firestore.`
        )
      );
      console.log(
        `   To apply these changes and trash duplicate copies, run:\n   ${pc.bold(
          pc.green('npm run duplicates:apply')
        )}\n`
      );
    } else {
      logger.success(`Live duplicate resolution completed successfully.`);
    }
  }

  /**
   * Generates a markdown representation of the audit plan.
   */
  generateMarkdown(summary: DuplicateRunSummary): string {
    const lines: string[] = [
      `# 🔍 BrainDrop Duplicate Detection Report`,
      ``,
      `- **Generated:** ${new Date().toISOString()}`,
      `- **Total Scanned:** ${summary.totalScanned}`,
      `- **Duplicate Clusters:** ${summary.clustersDetected}`,
      `- **Redundant Bookmarks to Trash:** ${summary.duplicatesTargetedForTrash}`,
      `- **Keepers Updated:** ${summary.keepersRequiringTagMerge}`,
      ``,
      `---`,
      ``,
    ];

    summary.plans.forEach((plan, i) => {
      lines.push(`### Cluster #${i + 1}: \`${plan.canonicalUrl}\``);
      lines.push(`- **Strategy:** \`${plan.strategy}\``);
      lines.push(
        `- **👑 Keeper:** ID \`${plan.keeper.id}\` (Target Collection: #${plan.keeper.targetCollectionId})`
      );
      lines.push(`  - Existing Tags: \`[${plan.keeper.existingTags.join(', ')}]\``);
      lines.push(`  - **Merged Tags:** \`[${plan.keeper.mergedTags.join(', ')}]\``);
      lines.push(`- **🗑️ Trashed Copies:**`);
      plan.duplicatesToTrash.forEach((dup) => {
        lines.push(
          `  - ID \`${dup.id}\` | Collection #${dup.collectionId} | Created: ${dup.created} | *${dup.title}*`
        );
      });
      lines.push(``);
    });

    return lines.join('\n');
  }
}

export const duplicateReporter = new DuplicateReporter();
