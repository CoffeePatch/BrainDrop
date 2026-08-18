import { describe, it, expect } from 'vitest';
import { TagNormalizerService } from '../src/services/tags/tag-normalizer.js';
import type { TaxonomyConfig } from '../src/types/rules.js';

describe('TagNormalizerService', () => {
  const service = new TagNormalizerService();

  it('formats canonical tags while preserving uppercase acronyms', () => {
    const acronyms = new Set(['AI', 'JAV', 'LLM', 'AWS', 'GCP', 'API', 'UI', 'UX', 'PDF']);

    expect(service.formatCanonicalTag('ai', acronyms, 'lowercase')).toBe('AI');
    expect(service.formatCanonicalTag('AI', acronyms, 'lowercase')).toBe('AI');
    expect(service.formatCanonicalTag('jav', acronyms, 'lowercase')).toBe('JAV');
    expect(service.formatCanonicalTag('React', acronyms, 'lowercase')).toBe('react');
    expect(service.formatCanonicalTag('Machine Learning', acronyms, 'kebab-case')).toBe('machine-learning');
  });

  it('correctly maps synonym aliases and generates global replace map', () => {
    const taxonomy: TaxonomyConfig = {
      casing: 'lowercase',
      acronyms: ['AI', 'JAV'],
      aliases: {
        reactjs: 'react',
        'react.js': 'react',
        k8s: 'kubernetes',
      },
      bannedTags: ['pocket-import', 'temp'],
    };

    const mockTags = [
      { _id: 'React', count: 15 },
      { _id: 'react', count: 40 },
      { _id: 'reactjs', count: 8 },
      { _id: 'react.js', count: 3 },
      { _id: 'k8s', count: 12 },
      { _id: 'pocket-import', count: 25 },
      { _id: 'temp', count: 5 },
      { _id: 'ai', count: 10 },
      { _id: 'AI', count: 20 },
      { _id: 'dead-tag', count: 0 },
    ];

    const acronymsSet = new Set((taxonomy.acronyms || []).map((a) => a.toUpperCase()));
    const aliasMap = new Map(Object.entries(taxonomy.aliases || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const bannedSet = new Set((taxonomy.bannedTags || []).map((t) => t.toLowerCase()));

    const lowerMap = new Map<string, Array<{ original: string; count: number }>>();
    const emptyTags: string[] = [];
    const bannedTagsFound: Array<{ tag: string; count: number }> = [];

    for (const tag of mockTags) {
      if (tag.count === 0) emptyTags.push(tag._id);
      const lower = tag._id.trim().toLowerCase();
      if (bannedSet.has(lower)) bannedTagsFound.push({ tag: tag._id, count: tag.count });
      if (!lowerMap.has(lower)) lowerMap.set(lower, []);
      lowerMap.get(lower)!.push({ original: tag._id, count: tag.count });
    }

    const globalReplaceMap: Record<string, string> = {};

    // Casing
    for (const [lower, variations] of lowerMap.entries()) {
      if (variations.length >= 2) {
        const canonical = service.formatCanonicalTag(lower, acronymsSet, taxonomy.casing);
        for (const v of variations) {
          if (v.original !== canonical) globalReplaceMap[v.original] = canonical;
        }
      }
    }

    // Aliases
    for (const [sourceLower, target] of aliasMap.entries()) {
      const variations = lowerMap.get(sourceLower);
      if (variations) {
        for (const v of variations) {
          if (v.original !== target) globalReplaceMap[v.original] = target;
        }
      }
    }

    // Assertions
    expect(globalReplaceMap['React']).toBe('react');
    expect(globalReplaceMap['reactjs']).toBe('react');
    expect(globalReplaceMap['react.js']).toBe('react');
    expect(globalReplaceMap['k8s']).toBe('kubernetes');
    expect(globalReplaceMap['ai']).toBe('AI'); // Preserves AI acronym

    expect(bannedTagsFound.map((b) => b.tag)).toEqual(['pocket-import', 'temp']);
    expect(emptyTags).toEqual(['dead-tag']);
  });
});
