import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../src/utils/canonicalizer.js';

describe('URL Canonicalization Engine', () => {
  it('strips marketing and UTM tracking parameters', () => {
    const raw = 'https://example.com/blog/article?utm_source=newsletter&utm_medium=email&utm_campaign=launch';
    const result = canonicalizeUrl(raw);
    expect(result.canonicalUrl).toBe('https://example.com/blog/article');
  });

  it('normalizes scheme and host casing and www prefix', () => {
    const raw = 'HTTP://WWW.GitHub.com/facebook/react';
    const result = canonicalizeUrl(raw);
    expect(result.canonicalUrl).toBe('https://github.com/facebook/react');
    expect(result.domain).toBe('github.com');
  });

  it('strips default HTTP and HTTPS ports', () => {
    const raw1 = 'https://example.com:443/docs';
    const raw2 = 'http://example.com:80/docs';
    expect(canonicalizeUrl(raw1).canonicalUrl).toBe('https://example.com/docs');
    expect(canonicalizeUrl(raw2).canonicalUrl).toBe('https://example.com/docs');
  });

  it('normalizes trailing slashes and index.html files', () => {
    const raw1 = 'https://example.com/guide/';
    const raw2 = 'https://example.com/guide/index.html';
    expect(canonicalizeUrl(raw1).canonicalUrl).toBe('https://example.com/guide');
    expect(canonicalizeUrl(raw2).canonicalUrl).toBe('https://example.com/guide');
  });

  it('sorts functional query parameters alphabetically', () => {
    const raw1 = 'https://example.com/search?b=2&a=1';
    const raw2 = 'https://example.com/search?a=1&b=2';
    const res1 = canonicalizeUrl(raw1);
    const res2 = canonicalizeUrl(raw2);
    expect(res1.canonicalUrl).toBe('https://example.com/search?a=1&b=2');
    expect(res1.urlHash).toBe(res2.urlHash);
  });

  it('strips standard anchor fragments but keeps SPA routes', () => {
    const anchor = 'https://example.com/page#section-2';
    const spa = 'https://example.com/app#/dashboard/metrics';
    expect(canonicalizeUrl(anchor).canonicalUrl).toBe('https://example.com/page');
    expect(canonicalizeUrl(spa).canonicalUrl).toBe('https://example.com/app#/dashboard/metrics');
  });
});
