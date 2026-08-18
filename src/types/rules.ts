import { z } from 'zod';

export const SubpathRuleSchema = z.object({
  pattern: z.string().describe('URL path glob or prefix (e.g. /series/* or /docs)'),
  tags: z.array(z.string()).optional().default([]).describe('Tags to append to parent tags'),
  overrideTags: z.array(z.string()).optional().describe('Tags to replace parent tags entirely'),
  targetCollection: z.string().optional().describe('Override target collection for this subpath'),
  action: z.enum(['organize', 'trash']).optional().default('organize').describe('Action: organize or trash'),
});

export const HierarchicalRuleSchema = z.object({
  name: z.string().optional().default('Custom Rule'),
  domain: z.string().optional().describe('Domain or hostname match (e.g. github.com)'),
  domains: z.array(z.string()).optional().describe('List of domains matching this rule'),
  fileExtensions: z.array(z.string()).optional().describe('File extensions matching this rule (e.g. [.pdf])'),
  regex: z.string().optional().describe('Regular expression pattern matching URL'),
  targetCollection: z.string().optional().describe('Target Raindrop collection name'),
  tags: z.array(z.string()).optional().default([]).describe('Base tags for matching URLs'),
  subpaths: z.array(SubpathRuleSchema).optional().default([]).describe('Nested subpath rules inheriting parent collection & tags'),
  important: z.boolean().optional().describe('Flag as important/starred'),
  priority: z.number().optional().default(0).describe('Priority ordering (higher executes first)'),
  action: z.enum(['organize', 'trash']).optional().default('organize').describe('Action: organize (default) or trash (blacklist)'),
});

export const TaxonomyConfigSchema = z.object({
  casing: z.enum(['lowercase', 'kebab-case', 'preserve']).optional().default('lowercase'),
  acronyms: z
    .array(z.string())
    .optional()
    .default(['AI', 'JAV', 'LLM', 'AWS', 'GCP', 'API', 'UI', 'UX', 'PDF', 'SQL', 'CSS', 'HTML']),
  aliases: z.record(z.string()).optional().default({}),
  bannedTags: z.array(z.string()).optional().default([]),
});

export const RootConfigSchema = z.union([
  z.array(HierarchicalRuleSchema),
  z.object({
    taxonomy: TaxonomyConfigSchema.optional(),
    rules: z.array(HierarchicalRuleSchema).optional().default([]),
  }),
]);

export const RuleConfigFileSchema = RootConfigSchema;

export type SubpathRule = z.infer<typeof SubpathRuleSchema>;
export type HierarchicalRule = z.infer<typeof HierarchicalRuleSchema>;
export type TaxonomyConfig = z.infer<typeof TaxonomyConfigSchema>;

export interface ParsedBrainDropConfig {
  taxonomy: TaxonomyConfig;
  rules: HierarchicalRule[];
}

export interface CategorizationMatch {
  bookmarkId: number;
  originalLink: string;
  title: string;
  matchedRuleName: string;
  matchedPattern: string;
  currentCollectionId: number;
  targetCollectionName?: string;
  targetCollectionId?: number;
  isNewCollection: boolean;
  existingTags: string[];
  tagsToAdd: string[];
  finalTags: string[];
  important?: boolean;
  requiresMutation: boolean;
  action?: 'organize' | 'trash';
  isTrashCandidate?: boolean;
}

export interface CategorizationSummary {
  totalScanned: number;
  totalMatched: number;
  collectionsToCreate: string[];
  matches: CategorizationMatch[];
}
