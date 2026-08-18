export interface DomainRule {
  id: string;
  name: string;
  domains: string[];
  tagsToAdd?: string[];
  targetCollectionName?: string;
  isImportant?: boolean;
}

export const DEFAULT_DOMAIN_RULES: DomainRule[] = [
  {
    id: 'github-repos',
    name: 'GitHub & GitLab Code Repositories',
    domains: ['github.com', 'gitlab.com'],
    tagsToAdd: ['code'],
    targetCollectionName: 'Development',
  },
  {
    id: 'research-papers',
    name: 'Academic & Research Papers',
    domains: ['arxiv.org', 'biorxiv.org', 'paperswithcode.com', 'nature.com'],
    tagsToAdd: ['research', 'paper'],
    targetCollectionName: 'Papers',
  },
  {
    id: 'video-learning',
    name: 'Video Learning & Lectures',
    domains: ['youtube.com', 'youtu.be', 'vimeo.com'],
    tagsToAdd: ['video'],
  },
  {
    id: 'q-and-a',
    name: 'Technical Q&A & Community',
    domains: ['stackoverflow.com', 'serverfault.com', 'stackexchange.com'],
    tagsToAdd: ['programming', 'troubleshooting'],
  },
  {
    id: 'tech-blogs',
    name: 'Developer Articles & Blogs',
    domains: ['dev.to', 'medium.com', 'hackernoon.com', 'hashnode.dev'],
    tagsToAdd: ['article'],
  },
];
