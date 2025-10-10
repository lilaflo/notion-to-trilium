type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level];
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(`🔍 [DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(`ℹ️  [INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`⚠️  [WARN] ${message}`, ...args);
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(`❌ [ERROR] ${message}`);
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
        if (error.stack) {
          console.debug(error.stack);
        }
      } else if (error) {
        console.error(error);
      }
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(`✅ ${message}`, ...args);
    }
  }

  progress(current: number, total: number, message: string): void {
    if (this.shouldLog('info')) {
      const percentage = Math.round((current / total) * 100);
      console.info(`⏳ [${current}/${total}] (${percentage}%) ${message}`);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
