import { createHash } from 'node:crypto';
import { TRACKING_QUERY_PARAMS } from '../config/constants.js';

export interface CanonicalResult {
  rawUrl: string;
  canonicalUrl: string;
  urlHash: string;
  domain: string;
}

/**
 * Normalizes an arbitrary bookmark URL and generates a deterministic SHA-256 hash.
 */
export function canonicalizeUrl(rawUrl: string): CanonicalResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      rawUrl: rawUrl || '',
      canonicalUrl: '',
      urlHash: createHash('sha256').update('').digest('hex'),
      domain: '',
    };
  }

  const trimmed = rawUrl.trim();

  try {
    const parsed = new URL(trimmed);

    // 1. Protocol normalization
    let protocol = parsed.protocol.toLowerCase();
    if (protocol === 'http:') {
      protocol = 'https:';
    }

    // 2. Hostname normalization
    let hostname = parsed.hostname.toLowerCase();
    // Strip default www prefix
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }
    // Strip mobile prefix for video/media sites where content is identical
    if (hostname === 'm.youtube.com') {
      hostname = 'youtube.com';
    }

    // 3. Port stripping (ignore 80 and 443)
    let port = parsed.port;
    if (port === '80' || port === '443') {
      port = '';
    }

    // 4. Path normalization
    let pathname = parsed.pathname;
    // Replace multiple consecutive slashes
    pathname = pathname.replace(/\/+/g, '/');
    // Strip common default index files
    pathname = pathname.replace(/\/(index|default)\.(html?|php|asp[x]?)$/i, '');
    // Trim trailing slash unless it is root '/'
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // 5. Query parameter sanitization & alphabetical sorting
    const searchParams = new URLSearchParams();
    const sortedKeys = Array.from(parsed.searchParams.keys()).sort();

    for (const key of sortedKeys) {
      const lowerKey = key.toLowerCase();
      // Skip tracking and analytics parameters
      if (TRACKING_QUERY_PARAMS.has(lowerKey)) {
        continue;
      }
      const values = parsed.searchParams.getAll(key);
      for (const val of values) {
        searchParams.append(key, val);
      }
    }

    const queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';

    // 6. Fragment evaluation (retain hash only if it represents an SPA route '#/')
    let fragment = '';
    if (parsed.hash.startsWith('#/')) {
      fragment = parsed.hash;
    }

    // Assemble canonical URL
    const hostWithPort = port ? `${hostname}:${port}` : hostname;
    const canonicalUrl = `${protocol}//${hostWithPort}${pathname}${queryString}${fragment}`;

    // 7. Compute SHA-256 Canonical Hash
    const urlHash = createHash('sha256').update(canonicalUrl).digest('hex');

    return {
      rawUrl: trimmed,
      canonicalUrl,
      urlHash,
      domain: hostname,
    };
  } catch {
    // If URL parsing fails, fallback to sanitized raw string
    const fallback = trimmed.toLowerCase().replace(/\/+$/, '');
    const urlHash = createHash('sha256').update(fallback).digest('hex');
    return {
      rawUrl: trimmed,
      canonicalUrl: fallback,
      urlHash,
      domain: '',
    };
  }
}
