# 💧 BrainDrop

**BrainDrop** is an intelligent, scalable personal bookmark automation and maintenance tool for [Raindrop.io](https://raindrop.io).

Built on top of **Google Cloud Firestore** (as a lean, indexed working copy) and orchestrated by **GitHub Actions / CLI**, BrainDrop automates duplicate detection, tag normalization, domain rules, and broken link resolution for thousands of bookmarks without exceeding API rate limits or free tier quotas.

---

## ⚡ Features

- **Authoritative Source of Truth**: Raindrop.io remains the primary source of truth. All updates and deletions are dispatched through Raindrop REST API v1.
- **Incremental Delta Sync**: Uses `lastUpdate:>timestamp` queries to only download modified items, minimizing Firestore read/write operations.
- **Intelligent Deduplication**: Multi-stage URL canonicalizer strips marketing tracking parameters (`utm_*`, `fbclid`, `gclid`, `ref`, etc.), sorts query parameters alphabetically, and merges all tags, notes, and collections before moving duplicate copies to Raindrop Trash.
- **Newest-Keeper Strategy (`KEEP_NEWEST_INHERIT_OLD`)**: Keeps recently saved bookmarks at the top of your chronological feed while injecting all historical tags and folder assignments from older duplicates.
- **Global Batch Execution**: Groups bulk deletes into 50-item batches per collection to conserve API quotas.
- **Deterministic Domain Rules**: High-speed local regex matcher for auto-tagging (GitHub $\rightarrow$ `code`, ArXiv $\rightarrow$ `research`, etc.).
- **Tag Normalization**: Standardizes tag casing variations (`React` vs `react`) and prunes empty tags.
- **Broken Link Auditor**: Asynchronously probes stored URLs to follow permanent 301 redirects and flag 404 dead links.

---

## 📁 Repository Structure

```
BrainDrop/
├── .env.example                # Template for environment configuration
├── package.json                # Project dependencies and CLI scripts
├── tsconfig.json               # TypeScript compiler configuration
├── src/
│   ├── config/                 # Environment validation and system constants
│   ├── types/                  # TypeScript interfaces (Raindrop, Firestore, Duplicate)
│   ├── clients/                # Raindrop API & Firestore client wrappers
│   ├── utils/                  # URL Canonicalizer, Rate Limiter, Logger
│   ├── services/               # Feature engines (Sync, Duplicate, Tags, Rules, Links)
│   └── index.ts                # Unified CLI entry point
└── test/                       # Unit test suites
```

---

## 🚀 Quickstart & Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org) >= 20.0.0
- A [Raindrop.io](https://app.raindrop.io/settings/integrations) account and API Token
- A free [Google Cloud Firebase / Firestore](https://firebase.google.com) project

### 2. Installation
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

```ini
# Raindrop API Test Token
RAINDROP_TOKEN=your_raindrop_token_here

# Firebase Admin Credentials
FIREBASE_PROJECT_ID=your-gcp-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 4. Available Commands

| Task | Dry-Run Preview (0 writes) | Apply Live Changes |
|---|---|---|
| **Health Check** | `npm run check` | `npm run check` |
| **Incremental Sync** | `npm run sync` | `npm run sync` |
| **Duplicate Remover** | `npm run duplicates` | `npm run duplicates:apply` |
| **Tag Normalizer** | `npm run tags` | `npm run tags:apply` |
| **Domain Rules** | `npm run rules` | `npm run rules:apply` |
| **Broken Link Auditor** | `npm run links` | `npm run links:apply` |
| **System Status** | `npm run status` | `npm run status` |

### 5. Running Tests
```bash
npm test
```
