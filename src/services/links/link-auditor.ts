import { db } from '../../clients/firestore.js';
import { raindropClient } from '../../clients/raindrop.js';
import type { FirestoreBookmark } from '../../types/firestore.js';
import { logger } from '../../utils/logger.js';

export interface LinkProbeResult {
  bookmarkId: number;
  originalUrl: string;
  finalUrl: string;
  httpStatus: number;
  isRedirect: boolean;
  isBroken: boolean;
  error?: string;
}

export interface LinkAuditSummary {
  totalAudited: number;
  brokenCount: number;
  redirectCount: number;
  healthyCount: number;
  results: LinkProbeResult[];
}

export class LinkAuditorService {
  private timeoutMs: number = 5000;
  private maxConcurrency: number = 10;

  /**
   * Probes a single URL with 5-second timeout and fallback.
   */
  async probeUrl(bookmark: FirestoreBookmark): Promise<LinkProbeResult> {
    const rawUrl = bookmark.link;

    try {
      // 1. Try HTTP HEAD probe
      let response = await fetch(rawUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BrainDropAuditor/1.0)',
        },
        redirect: 'follow',
      });

      // 2. If HEAD returns 405 Method Not Allowed, fallback to minimal GET range
      if (response.status === 405) {
        response = await fetch(rawUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BrainDropAuditor/1.0)',
            Range: 'bytes=0-512',
          },
          redirect: 'follow',
        });
      }

      const finalUrl = response.url || rawUrl;
      const isRedirect =
        finalUrl !== rawUrl &&
        !finalUrl.includes('login') &&
        !finalUrl.includes('auth');
      const isBroken = response.status === 404 || response.status === 410;

      return {
        bookmarkId: bookmark._id,
        originalUrl: rawUrl,
        finalUrl,
        httpStatus: response.status,
        isRedirect,
        isBroken,
      };
    } catch (error: any) {
      const isDnsOrTimeout =
        error.name === 'TimeoutError' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('fetch failed');

      return {
        bookmarkId: bookmark._id,
        originalUrl: rawUrl,
        finalUrl: rawUrl,
        httpStatus: 0,
        isRedirect: false,
        isBroken: isDnsOrTimeout,
        error: error.message || 'Connection failed',
      };
    }
  }

  /**
   * Concurrently audits batches of bookmarks.
   */
  async auditBookmarks(limit: number = 50): Promise<LinkAuditSummary> {
    logger.info(`Auditing links for ${limit} cached bookmarks (concurrency: ${this.maxConcurrency})...`);

    const snapshot = await db.bookmarks.limit(limit).get();
    const bookmarks: FirestoreBookmark[] = [];
    snapshot.forEach((doc) => bookmarks.push(doc.data()));

    const results: LinkProbeResult[] = [];
    let brokenCount = 0;
    let redirectCount = 0;
    let healthyCount = 0;

    // Process in concurrency chunks
    for (let i = 0; i < bookmarks.length; i += this.maxConcurrency) {
      const chunk = bookmarks.slice(i, i + this.maxConcurrency);
      const chunkResults = await Promise.all(chunk.map((b) => this.probeUrl(b)));

      for (const res of chunkResults) {
        results.push(res);
        if (res.isBroken) brokenCount++;
        else if (res.isRedirect) redirectCount++;
        else healthyCount++;
      }

      logger.debug(`Audited ${Math.min(i + this.maxConcurrency, bookmarks.length)}/${bookmarks.length} links...`);
    }

    return {
      totalAudited: bookmarks.length,
      brokenCount,
      redirectCount,
      healthyCount,
      results,
    };
  }

  /**
   * Applies link updates (redirected destination URLs & broken flags) to Raindrop and Firestore.
   */
  async applyAuditResults(results: LinkProbeResult[], dryRun = true): Promise<void> {
    const mutableResults = results.filter((r) => r.isBroken || r.isRedirect);

    if (dryRun) {
      logger.info(`[DRY-RUN] Would update ${mutableResults.length} bookmark links in Raindrop.`);
      return;
    }

    const batch = db.raw.batch();
    let updatedCount = 0;

    for (const res of mutableResults) {
      try {
        const payload: Record<string, any> = {};
        if (res.isRedirect && res.finalUrl) {
          payload.link = res.finalUrl;
          payload.broken = false;
        } else if (res.isBroken) {
          payload.broken = true;
        }

        await raindropClient.updateRaindrop(res.bookmarkId, payload);

        const docRef = db.bookmarks.doc(String(res.bookmarkId));
        batch.update(docRef, {
          ...payload,
          http_status: res.httpStatus,
          synced_at: new Date().toISOString(),
        });

        updatedCount++;
      } catch (error) {
        logger.error(`Failed to update link #${res.bookmarkId}: ${error}`);
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
      logger.success(`Successfully updated ${updatedCount} links in Raindrop & Firestore.`);
    }
  }
}

export const linkAuditorService = new LinkAuditorService();
