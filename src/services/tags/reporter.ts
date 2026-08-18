import fs from 'node:fs';
import pc from 'picocolors';
import type { TagTaxonomyReport, TagAnalysisSummary, TagMergeGroup } from './tag-normalizer.js';
import { logger } from '../../utils/logger.js';

export class TagReporter {
  printReport(summary: TagTaxonomyReport, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '🏷️  BrainDrop Tag Taxonomy & Normalization Plan (DRY-RUN)'
        : '🏷️  BrainDrop Tag Taxonomy & Normalization Results (LIVE)'
    );

    const report = summary;
    const aliasGroups = report.aliasGroups || [];
    const bannedTagsFound = report.bannedTagsFound || [];
    const replaceMap = report.globalReplaceMap || {};
    const replaceCount = Object.keys(replaceMap).length;

    console.log(`  ${pc.bold('Total Unique Tags:')}          ${summary.totalUniqueTags}`);
    console.log(
      `  ${pc.bold('Casing Conflict Groups:')}    ${
        summary.caseConflictGroups.length > 0
          ? pc.yellow(String(summary.caseConflictGroups.length))
          : pc.green('0')
      }`
    );
    console.log(
      `  ${pc.bold('Synonym Alias Mergers:')}     ${
        aliasGroups.length > 0 ? pc.cyan(String(aliasGroups.length)) : pc.gray('0')
      }`
    );
    console.log(
      `  ${pc.bold('Banned Tags Detected:')}      ${
        bannedTagsFound.length > 0 ? pc.red(String(bannedTagsFound.length)) : pc.gray('0')
      }`
    );
    console.log(
      `  ${pc.bold('Empty Tags to Prune:')}       ${
        summary.emptyTags.length > 0 ? pc.red(String(summary.emptyTags.length)) : pc.green('0')
      }\n`
    );

    if (
      summary.caseConflictGroups.length === 0 &&
      aliasGroups.length === 0 &&
      bannedTagsFound.length === 0 &&
      summary.emptyTags.length === 0
    ) {
      logger.success('All tags are perfectly normalized and adhere to taxonomy! No actions required.');
      return;
    }

    const line = pc.gray('─'.repeat(60));

    if (summary.caseConflictGroups.length > 0) {
      console.log(pc.bold(pc.cyan('Tag Casing Conflict Groups:')));
      console.log(line);
      summary.caseConflictGroups.forEach((group: TagMergeGroup, idx: number) => {
        console.log(
          `  ${pc.bold(`#${idx + 1}`)} Target: ${pc.green(
            pc.bold(group.canonicalTag)
          )} (Usage: ${group.totalUsageCount} bookmarks)`
        );
        console.log(`     Variations to merge: [${pc.gray(group.sourceTags.join(', '))}]`);
      });
      console.log();
    }

    if (aliasGroups.length > 0) {
      console.log(pc.bold(pc.cyan('Synonym & Alias Mergers:')));
      console.log(line);
      aliasGroups.forEach((group: TagMergeGroup, idx: number) => {
        console.log(
          `  ${pc.bold(`#${idx + 1}`)} Target: ${pc.green(
            pc.bold(group.canonicalTag)
          )} (Usage: ${group.totalUsageCount} bookmarks)`
        );
        console.log(`     Aliases: [${pc.gray(group.sourceTags.join(', '))}]`);
      });
      console.log();
    }

    if (bannedTagsFound.length > 0) {
      console.log(pc.bold(pc.red('Banned / Blacklisted Tags to Strip:')));
      console.log(line);
      bannedTagsFound.forEach((b: { tag: string; count: number }) => {
        console.log(`  🚫 "${pc.yellow(b.tag)}" (found on ${b.count} bookmarks)`);
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
          `\nℹ️  This was a DRY-RUN preview (${replaceCount} renames, ${
            bannedTagsFound.length + summary.emptyTags.length
          } deletions).\n` +
            'To apply these tag mergers live, run:\n' +
            pc.bold(pc.green('   npm run tags:apply\n'))
        )
      );
    }

    // Write to GitHub Step Summary if running in GitHub Actions
    this.writeGitHubSummary(summary, isDryRun);
  }

  /**
   * Writes Markdown summary to $GITHUB_STEP_SUMMARY in GitHub Actions.
   */
  private writeGitHubSummary(summary: TagTaxonomyReport, isDryRun: boolean): void {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile) return;

    try {
      const report = summary;
      const aliasGroups = report.aliasGroups || [];
      const bannedTags = report.bannedTagsFound || [];

      let md = `## 🏷️ BrainDrop Tag Taxonomy & Normalization Report (${isDryRun ? 'DRY-RUN' : 'LIVE'})\n\n`;
      md += `| Metric | Count |\n|---|---|\n`;
      md += `| **Total Unique Tags** | ${summary.totalUniqueTags} |\n`;
      md += `| **Casing Conflicts** | ${summary.caseConflictGroups.length} |\n`;
      md += `| **Synonym Aliases** | ${aliasGroups.length} |\n`;
      md += `| **Banned Tags** | ${bannedTags.length} |\n`;
      md += `| **Dead / Empty Tags** | ${summary.emptyTags.length} |\n\n`;

      if (summary.caseConflictGroups.length > 0 || aliasGroups.length > 0) {
        md += `### 🔄 Tag Renames & Mergers\n\n`;
        md += `| Target Tag | Variations / Aliases | Usage Count | Type |\n|---|---|---|---|\n`;

        for (const g of summary.caseConflictGroups) {
          md += `| \`${g.canonicalTag}\` | ${g.sourceTags.map((t: string) => `\`${t}\``).join(', ')} | ${g.totalUsageCount} | Casing Conflict |\n`;
        }
        for (const g of aliasGroups) {
          md += `| \`${g.canonicalTag}\` | ${g.sourceTags.map((t: string) => `\`${t}\``).join(', ')} | ${g.totalUsageCount} | Synonym Alias |\n`;
        }
        md += `\n`;
      }

      if (bannedTags.length > 0) {
        md += `### 🚫 Banned Tags to Strip\n\n`;
        md += `| Tag | Found on Bookmarks |\n|---|---|\n`;
        for (const b of bannedTags) {
          md += `| \`${b.tag}\` | ${b.count} bookmarks |\n`;
        }
        md += `\n`;
      }

      fs.appendFileSync(summaryFile, md, 'utf-8');
    } catch {
      // Ignored if summary file unwritable
    }
  }
}

export const tagReporter = new TagReporter();
