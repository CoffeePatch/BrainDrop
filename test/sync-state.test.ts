import { describe, it, expect } from 'vitest';
import { syncStateManager } from '../src/services/sync/sync-state.js';
import type { SyncStateDocument } from '../src/types/firestore.js';

describe('SyncStateManager', () => {
  it('returns null timestamp when no checkpoint exists', () => {
    const timestamp = syncStateManager.getSearchQueryTimestamp(null);
    expect(timestamp).toBeNull();
  });

  it('applies a 60-second safety overlap buffer to last_sync_timestamp', () => {
    const checkpoint: SyncStateDocument = {
      last_sync_timestamp: '2026-08-17T12:01:00.000Z',
      last_sync_duration_ms: 1200,
      total_bookmarks_synced: 50,
      status: 'IDLE',
      updated_at: '2026-08-17T12:01:00.000Z',
    };

    const searchTimestamp = syncStateManager.getSearchQueryTimestamp(checkpoint);
    expect(searchTimestamp).toBe('2026-08-17T12:00:00.000Z'); // 60s earlier
  });
});
