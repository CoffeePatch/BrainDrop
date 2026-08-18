import pc from 'picocolors';
import { env } from '../config/env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private currentLevel: number;

  constructor() {
    this.currentLevel = LOG_LEVELS[env.LOG_LEVEL] ?? LOG_LEVELS.info;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.currentLevel <= LOG_LEVELS.debug) {
      console.log(pc.gray(`[DEBUG] ${message}`), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.currentLevel <= LOG_LEVELS.info) {
      console.log(pc.cyan(`[INFO]  ${message}`), ...args);
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.currentLevel <= LOG_LEVELS.info) {
      console.log(pc.green(`[OK]    ${message}`), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.currentLevel <= LOG_LEVELS.warn) {
      console.warn(pc.yellow(`[WARN]  ${message}`), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.currentLevel <= LOG_LEVELS.error) {
      console.error(pc.red(`[ERROR] ${message}`), ...args);
    }
  }

  header(title: string): void {
    const line = pc.gray('─'.repeat(60));
    console.log(`\n${line}`);
    console.log(pc.bold(pc.magenta(`  ${title}`)));
    console.log(`${line}\n`);
  }
}

export const logger = new Logger();
