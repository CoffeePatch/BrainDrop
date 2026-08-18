import pc from 'picocolors';
import type { LinkAuditSummary } from './link-auditor.js';
import { logger } from '../../utils/logger.js';

export class LinkReporter {
  printReport(summary: LinkAuditSummary, isDryRun: boolean): void {
    logger.header(
      isDryRun
        ? '🔗 BrainDrop Broken Link & Redirect Audit (DRY-RUN)'
        : '🔗 BrainDrop Link Audit Results (LIVE)'
    );

    console.log(`  ${pc.bold('Total Links Audited:')}        ${summary.totalAudited}`);
    console.log(`  ${pc.bold('Healthy Links (200 OK):')}      ${pc.green(String(summary.healthyCount))}`);
    console.log(
      `  ${pc.bold('Permanent Redirects (301):')}   ${
        summary.redirectCount > 0 ? pc.yellow(String(summary.redirectCount)) : pc.green('0')
      }`
    );
    console.log(
      `  ${pc.bold('Broken / Dead Links (404):')}   ${
        summary.brokenCount > 0 ? pc.red(String(summary.brokenCount)) : pc.green('0')
      }\n`
    );

    const mutableItems = summary.results.filter((r) => r.isBroken || r.isRedirect);
    if (mutableItems.length === 0) {
      logger.success('All audited links are healthy and active! No dead links found.');
      return;
    }

    const line = pc.gray('─'.repeat(60));
    console.log(line);

    mutableItems.forEach((res, idx) => {
      if (res.isBroken) {
        console.log(
          `  ${pc.bold(`#${idx + 1}`)} ${pc.red('❌ BROKEN')} ID ${pc.bold(
            String(res.bookmarkId)
          )} | Status: ${res.httpStatus || 'Failed'} | ${res.error || 'Dead Link'}`
        );
        console.log(`     URL: ${res.originalUrl}`);
      } else if (res.isRedirect) {
        console.log(
          `  ${pc.bold(`#${idx + 1}`)} ${pc.yellow('↪️  REDIRECT')} ID ${pc.bold(
            String(res.bookmarkId)
          )} | Status: ${res.httpStatus}`
        );
        console.log(`     From: ${res.originalUrl}`);
        console.log(`     To:   ${pc.green(res.finalUrl)}`);
      }
      console.log();
    });

    console.log(line);
    if (isDryRun) {
      console.log(
        pc.yellow(
          '\nℹ️  This was a DRY-RUN preview. To apply redirect updates and flag dead links, run:\n' +
            pc.bold(pc.green('   npm run links:apply\n'))
        )
      );
    }
  }
}

export const linkReporter = new LinkReporter();
