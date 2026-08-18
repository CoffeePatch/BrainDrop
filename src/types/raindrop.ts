/**
 * Raindrop.io REST API v1 Type Definitions
 * Directly matching official specification: https://developer.raindrop.io/v1/
 */

export interface RaindropHighlight {
  _id: string;
  text: string;
  color?: 'yellow' | 'blue' | 'green' | 'red' | 'magenta' | string;
  note?: string;
  created: string; // ISO 8601
}

export interface RaindropMedia {
  link: string;
  type?: 'image' | 'video' | string;
}

export interface RaindropCreatorRef {
  _id: number;
  fullName: string;
  email?: string;
  avatar?: string;
}

export interface RaindropCache {
  status?: 'ready' | 'retry' | 'failed' | 'invalid-origin' | 'invalid-timeout';
  size?: number;
  created?: string;
}

export interface RaindropBookmark {
  _id: number;
  collection: {
    $id: number;
    $ref?: string;
    oid?: number;
  };
  user: {
    $id: number;
    $ref?: string;
  };
  creatorRef?: RaindropCreatorRef;
  link: string;
  title: string;
  excerpt: string;
  note: string;
  type: 'link' | 'article' | 'image' | 'video' | 'document' | 'audio';
  tags: string[];
  cover: string;
  media: RaindropMedia[];
  highlights: RaindropHighlight[];
  reminder?: {
    date: string;
  };
  domain: string;
  important: boolean;
  broken: boolean;
  sort: number;
  cache?: RaindropCache;
  created: string;
  lastUpdate: string;
}

export interface RaindropListResponse {
  result: boolean;
  items: RaindropBookmark[];
  count: number;
}

export interface RaindropSingleResponse {
  result: boolean;
  item: RaindropBookmark;
}

export interface RaindropCollection {
  _id: number;
  title: string;
  count: number;
  user: { $id: number };
  parent?: { $id: number };
  public: boolean;
  color?: string;
  cover?: string[];
  sort: number;
  expanded?: boolean;
  created: string;
  lastUpdate: string;
}

export interface RaindropCollectionsResponse {
  result: boolean;
  items: RaindropCollection[];
}

export interface RaindropTagItem {
  _id: string;
  count: number;
}

export interface RaindropTagsResponse {
  result: boolean;
  items: RaindropTagItem[];
}
