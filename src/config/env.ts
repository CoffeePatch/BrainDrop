import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
config();

const envSchema = z.object({
  // Raindrop API Token
  RAINDROP_TOKEN: z.string().default(''),

  // Firebase Credentials
  FIREBASE_PROJECT_ID: z.string().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().default(''),
  FIREBASE_PRIVATE_KEY: z.string().default(''),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default(''),

  // Optional AI / Advanced settings
  GEMINI_API_KEY: z.string().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEFAULT_KEEPER_STRATEGY: z
    .enum(['KEEP_NEWEST_INHERIT_OLD', 'KEEP_OLDEST_MERGE_NEW', 'KEEP_RICHEST'])
    .default('KEEP_NEWEST_INHERIT_OLD'),
  FIRESTORE_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(500),
});

export type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Environment configuration error:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

/**
 * Validates that required credentials are present before executing live network commands.
 */
export function ensureCredentials(requireFirestore = true): void {
  if (!env.RAINDROP_TOKEN) {
    console.error(
      '\n❌ Error: RAINDROP_TOKEN is missing.\n' +
        'Please set RAINDROP_TOKEN in your .env file or environment.\n' +
        'Get a token from: https://app.raindrop.io/settings/integrations\n'
    );
    process.exit(1);
  }

  if (requireFirestore) {
    const hasServiceFile = !!env.GOOGLE_APPLICATION_CREDENTIALS;
    const hasDirectKeys =
      !!env.FIREBASE_PROJECT_ID &&
      !!env.FIREBASE_CLIENT_EMAIL &&
      !!env.FIREBASE_PRIVATE_KEY;

    if (!hasServiceFile && !hasDirectKeys && !env.FIREBASE_PROJECT_ID) {
      console.error(
        '\n❌ Error: Firestore credentials are missing.\n' +
          'Please configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env,\n' +
          'or set GOOGLE_APPLICATION_CREDENTIALS to your service-account.json file path.\n'
      );
      process.exit(1);
    }
  }
}

