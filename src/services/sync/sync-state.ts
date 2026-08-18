import { FIRESTORE_COLLECTIONS } from '../../config/constants.js';
import { db } from '../../clients/firestore.js';
import type { SyncStateDocument } from '../../types/firestore.js';
import { logger } from '../../utils/logger.js';

const MASTER_SYNC_DOC_ID = 'raindrop_master';
const SAFETY_OVERLAP_SECONDS = 60; // 60s overlap buffer to prevent clock skew missing deltas

export class SyncStateManager {
  /**
   * Reads current sync checkpoint from Firestore.
   */
  async getSyncCheckpoint(): Promise<SyncStateDocument | null> {
    try {
      const docRef = db.syncState.doc(MASTER_SYNC_DOC_ID);
      const snapshot = await docRef.get();

      if (!snapshot.exists) {
        logger.debug('No existing sync checkpoint found. A full initial sync will run.');
        return null;
      }

      return snapshot.data() || null;
    } catch (error) {
      logger.warn(`Could not read sync state from Firestore: ${error}`);
      return null;
    }
  }

  /**
   * Calculates the search timestamp query string for Raindrop API.
   * If a checkpoint exists, applies a 60-second safety overlap buffer.
   */
  getSearchQueryTimestamp(checkpoint: SyncStateDocument | null): string | null {
    if (!checkpoint?.last_sync_timestamp) {
      return null;
    }

    try {
      const lastSyncDate = new Date(checkpoint.last_sync_timestamp);
      // Subtract safety buffer
      const safeTimeMs = lastSyncDate.getTime() - SAFETY_OVERLAP_SECONDS * 1000;
      const safeDate = new Date(safeTimeMs);
      return safeDate.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Updates sync checkpoint in Firestore after successful batch commits.
   */
  async updateCheckpoint(
    latestTimestamp: string,
    syncedCount: number,
    durationMs: number
  ): Promise<void> {
    try {
      const docRef = db.syncState.doc(MASTER_SYNC_DOC_ID);
      const payload: Partial<SyncStateDocument> = {
        last_sync_timestamp: latestTimestamp,
        last_sync_duration_ms: durationMs,
        total_bookmarks_synced: syncedCount,
        status: 'IDLE',
        updated_at: new Date().toISOString(),
      };

      await docRef.set(payload as SyncStateDocument, { merge: true });
      logger.debug(`Updated sync checkpoint: ${latestTimestamp}`);
    } catch (error) {
      logger.error(`Failed to update sync checkpoint in Firestore: ${error}`);
    }
  }

  /**
   * Set sync state status to SYNCING or ERROR.
   */
  async setStatus(status: 'SYNCING' | 'ERROR', errorMessage?: string): Promise<void> {
    try {
      const docRef = db.syncState.doc(MASTER_SYNC_DOC_ID);
      await docRef.set(
        {
          status,
          error_message: errorMessage || '',
          updated_at: new Date().toISOString(),
        } as SyncStateDocument,
        { merge: true }
      );
    } catch (error) {
      logger.debug(`Could not update sync state status: ${error}`);
    }
  }
}

export const syncStateManager = new SyncStateManager();
