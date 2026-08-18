import type { RaindropBookmark, RaindropCollection } from './raindrop.js';

/**
 * Full-fidelity Raindrop Bookmark document stored in Firestore.
 * Contains 100% of Raindrop fields + BrainDrop computed indexes.
 */
export interface FirestoreBookmark extends RaindropBookmark {
  // Computed indexing fields
  canonical_url: string;
  url_hash: string;
  synced_at: string;
}

/**
 * Synchronization state document in `sync_state/raindrop_master`.
 */
export interface SyncStateDocument {
  last_sync_timestamp: string;
  last_sync_duration_ms: number;
  total_bookmarks_synced: number;
  last_full_sweep_timestamp?: string;
  status: 'IDLE' | 'SYNCING' | 'ERROR';
  error_message?: string;
  rate_limit_remaining?: number;
  rate_limit_reset_epoch?: number;
  updated_at: string;
}

/**
 * Global Taxonomy Index document in `taxonomy/global`.
 */
export interface TaxonomyIndex {
  all_tags: string[];
  tag_counts: Record<string, number>;
  updated_at: string;
}

export type FirestoreCollectionDoc = RaindropCollection;
