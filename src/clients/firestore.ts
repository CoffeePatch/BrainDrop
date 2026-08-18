import admin from 'firebase-admin';
import { FIRESTORE_COLLECTIONS } from '../config/constants.js';
import { env } from '../config/env.js';
import type {
  FirestoreBookmark,
  FirestoreCollectionDoc,
  SyncStateDocument,
  TaxonomyIndex,
} from '../types/firestore.js';
import { logger } from '../utils/logger.js';

let firestoreInstance: admin.firestore.Firestore | null = null;

export function getFirestore(): admin.firestore.Firestore {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  if (admin.apps.length === 0) {
    // 1. Check direct env credentials
    if (
      env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY
    ) {
      const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
      });
      logger.debug('Initialized Firebase Admin via environment credentials.');
    } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
      // 2. Local service account JSON path
      process.env.GOOGLE_APPLICATION_CREDENTIALS =
        env.GOOGLE_APPLICATION_CREDENTIALS;
      admin.initializeApp({
        projectId: env.FIREBASE_PROJECT_ID,
      });
      logger.debug(
        `Initialized Firebase Admin via file: ${env.GOOGLE_APPLICATION_CREDENTIALS}`
      );
    } else {
      // 3. Default Application Credentials (ADC) fallback
      admin.initializeApp({
        projectId: env.FIREBASE_PROJECT_ID,
      });
      logger.warn(
        'Initialized Firebase Admin with default ADC fallback. Ensure gcloud is authenticated or set FIREBASE_* env keys.'
      );
    }
  }

  firestoreInstance = admin.firestore();
  firestoreInstance.settings({ ignoreUndefinedProperties: true });
  return firestoreInstance;
}

/**
 * Typed Firestore collection helpers
 */
export const db = {
  get raw(): admin.firestore.Firestore {
    return getFirestore();
  },
  get bookmarks(): admin.firestore.CollectionReference<FirestoreBookmark> {
    return getFirestore().collection(
      FIRESTORE_COLLECTIONS.BOOKMARKS
    ) as admin.firestore.CollectionReference<FirestoreBookmark>;
  },
  get syncState(): admin.firestore.CollectionReference<SyncStateDocument> {
    return getFirestore().collection(
      FIRESTORE_COLLECTIONS.SYNC_STATE
    ) as admin.firestore.CollectionReference<SyncStateDocument>;
  },
  get collectionsMeta(): admin.firestore.CollectionReference<FirestoreCollectionDoc> {
    return getFirestore().collection(
      FIRESTORE_COLLECTIONS.COLLECTIONS_META
    ) as admin.firestore.CollectionReference<FirestoreCollectionDoc>;
  },
  get taxonomy(): admin.firestore.CollectionReference<TaxonomyIndex> {
    return getFirestore().collection(
      FIRESTORE_COLLECTIONS.TAXONOMY
    ) as admin.firestore.CollectionReference<TaxonomyIndex>;
  },
  get auditLogs(): admin.firestore.CollectionReference<admin.firestore.DocumentData> {
    return getFirestore().collection(FIRESTORE_COLLECTIONS.AUDIT_LOGS);
  },
};
