import type { FirestoreBookmark } from './firestore.js';

export enum KeeperStrategy {
  KEEP_NEWEST_INHERIT_OLD = 'KEEP_NEWEST_INHERIT_OLD',
  KEEP_OLDEST_MERGE_NEW = 'KEEP_OLDEST_MERGE_NEW',
  KEEP_RICHEST = 'KEEP_RICHEST',
}

export interface DuplicateCluster {
  clusterHash: string;
  canonicalUrl: string;
  bookmarks: FirestoreBookmark[];
}

export interface DuplicateMutationPlan {
  clusterHash: string;
  canonicalUrl: string;
  strategy: KeeperStrategy;
  keeper: {
    id: number;
    currentCollectionId: number;
    targetCollectionId: number;
    existingTags: string[];
    mergedTags: string[];
    mergedNote: string;
    mergedImportant: boolean;
    requiresUpdate: boolean;
  };
  duplicatesToTrash: Array<{
    id: number;
    collectionId: number;
    title: string;
    link: string;
    created: string;
    rawPayload: FirestoreBookmark;
  }>;
}

export interface DuplicateRunSummary {
  totalScanned: number;
  clustersDetected: number;
  duplicatesTargetedForTrash: number;
  keepersRequiringTagMerge: number;
  keepersRequiringCollectionMove: number;
  plans: DuplicateMutationPlan[];
}
