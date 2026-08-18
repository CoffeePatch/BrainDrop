import { RAINDROP_LIMITS } from '../config/constants.js';
import { logger } from './logger.js';

export class AdaptiveRateLimiter {
  private tokens: number;
  private maxTokens: number;
  private minBuffer: number;

  constructor(
    maxTokens: number = RAINDROP_LIMITS.RATE_LIMIT_PER_MINUTE,
    minBuffer: number = RAINDROP_LIMITS.SAFE_RATE_LIMIT_BUFFER
  ) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.minBuffer = minBuffer;
  }

  /**
   * Update internal quota state directly from HTTP response headers.
   */
  updateFromHeaders(headers: Headers): void {
    const remaining = headers.get('RateLimit-Remaining') ?? headers.get('ratelimit-remaining');
    const reset = headers.get('X-RateLimit-Reset') ?? headers.get('x-ratelimit-reset');

    if (remaining !== null) {
      this.tokens = parseInt(remaining, 10);
    }

    if (reset !== null && this.tokens <= this.minBuffer) {
      const resetEpochSec = parseInt(reset, 10);
      const nowSec = Math.floor(Date.now() / 1000);
      const waitSec = Math.max(0, resetEpochSec - nowSec);

      if (waitSec > 0) {
        logger.warn(
          `Raindrop quota near threshold (${this.tokens} remaining). Cooling down for ${waitSec}s until reset.`
        );
      }
    }
  }

  /**
   * Acquire execution token before dispatching request.
   */
  async acquire(): Promise<void> {
    if (this.tokens <= this.minBuffer) {
      logger.debug(`Low rate limit buffer (${this.tokens} tokens). Waiting 1000ms...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.tokens = Math.max(0, this.tokens - 1);
  }

  getRemainingTokens(): number {
    return this.tokens;
  }
}
