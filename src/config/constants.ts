/**
 * BrainDrop System Constants & Guardrails
 */

export const RAINDROP_API_BASE_URL = 'https://api.raindrop.io/rest/v1';

export const RAINDROP_SYSTEM_COLLECTIONS = {
  ALL: 0,
  UNSORTED: -1,
  TRASH: -99,
} as const;

export const RAINDROP_LIMITS = {
  MAX_PAGE_SIZE: 50,
  RATE_LIMIT_PER_MINUTE: 120,
  SAFE_RATE_LIMIT_BUFFER: 5,
} as const;

export const FIRESTORE_LIMITS = {
  MAX_BATCH_WRITE_SIZE: 500,
  DAILY_FREE_WRITE_LIMIT: 20000,
  DAILY_FREE_READ_LIMIT: 50000,
} as const;

export const FIRESTORE_COLLECTIONS = {
  BOOKMARKS: 'bookmarks',
  SYNC_STATE: 'sync_state',
  COLLECTIONS_META: 'collections_meta',
  TAXONOMY: 'taxonomy',
  AUDIT_LOGS: 'audit_logs',
} as const;

export const TRACKING_QUERY_PARAMS = new Set([
  // Google / Analytics / UTM
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  
  // Facebook / Meta
  'fbclid',
  'fbadid',
  
  // Google Ads / DoubleClick
  'gclid',
  'gclsrc',
  'dclid',
  'wbraid',
  'gbraid',
  
  // Microsoft / Bing
  'msclkid',
  
  // Yandex
  'yclid',
  
  // Mailchimp / Hubspot / Email campaigns
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  
  // Social / Referrals / Trackers
  'ref',
  'ref_src',
  'ref_url',
  'source',
  'src',
  'igshid',
  'twclid',
  'si',
  'feature',
]);
