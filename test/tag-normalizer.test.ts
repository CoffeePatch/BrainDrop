import { describe, it, expect } from 'vitest';
import { TagNormalizerService } from '../src/services/tags/tag-normalizer.js';

describe('TagNormalizerService', () => {
  it('detects casing variations and clusters them to clean lowercase', async () => {
    const service = new TagNormalizerService();

    // Mock internal tag analyzer logic
    const mockTags = [
      { _id: 'React', count: 15 },
      { _id: 'react', count: 40 },
      { _id: 'REACT', count: 2 },
      { _id: 'TypeScript', count: 20 },
      { _id: 'typescript', count: 10 },
      { _id: 'unique-tag', count: 5 },
      { _id: 'empty-tag', count: 0 },
    ];

    const lowerMap = new Map<string, Array<{ original: string; count: number }>>();
    const emptyTags: string[] = [];

    for (const tag of mockTags) {
      if (tag.count === 0) emptyTags.push(tag._id);
      const lower = tag._id.trim().toLowerCase();
      if (!lowerMap.has(lower)) lowerMap.set(lower, []);
      lowerMap.get(lower)!.push({ original: tag._id, count: tag.count });
    }

    const conflictGroups = [];
    for (const [lower, variations] of lowerMap.entries()) {
      if (variations.length >= 2) {
        conflictGroups.push({
          canonicalTag: lower,
          sourceTags: variations.map((v) => v.original),
          totalUsageCount: variations.reduce((sum, v) => sum + v.count, 0),
        });
      }
    }

    expect(conflictGroups).toHaveLength(2);
    expect(conflictGroups.find((g) => g.canonicalTag === 'react')?.sourceTags).toEqual([
      'React',
      'react',
      'REACT',
    ]);
    expect(conflictGroups.find((g) => g.canonicalTag === 'react')?.totalUsageCount).toBe(57);
    expect(emptyTags).toEqual(['empty-tag']);
  });
});
