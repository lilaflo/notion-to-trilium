import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

export interface CachedPage {
  notionId: string;
  title: string;
  lastEditedTime: string;
  imported: boolean;
  importedAt?: string;
  triliumNoteId?: string;
}

export interface ImportError {
  id: number;
  notionId: string;
  notionTitle: string;
  errorMessage: string;
  errorStack?: string;
  phase: 'fetch' | 'convert' | 'import';
  timestamp: string;
  retryCount: number;
}

export class NotionCache {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    // Default to .notion-cache.db in the project root
    this.dbPath = dbPath || path.join(process.cwd(), '.notion-cache.db');

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initSchema();

    logger.debug(`Cache initialized at: ${this.dbPath}`);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notion_pages (
        notion_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        last_edited_time TEXT NOT NULL,
        imported INTEGER DEFAULT 0,
        imported_at TEXT,
        trilium_note_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_imported ON notion_pages(imported);
      CREATE INDEX IF NOT EXISTS idx_last_edited ON notion_pages(last_edited_time);

      CREATE TABLE IF NOT EXISTS import_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notion_id TEXT NOT NULL,
        notion_title TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        phase TEXT NOT NULL,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        retry_count INTEGER DEFAULT 0,
        resolved INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_errors_notion_id ON import_errors(notion_id);
      CREATE INDEX IF NOT EXISTS idx_errors_phase ON import_errors(phase);
      CREATE INDEX IF NOT EXISTS idx_errors_resolved ON import_errors(resolved);
      CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON import_errors(timestamp);
    `);
  }

  /**
   * Get a cached page by Notion ID
   */
  getPage(notionId: string): CachedPage | null {
    const stmt = this.db.prepare(`
      SELECT
        notion_id as notionId,
        title,
        last_edited_time as lastEditedTime,
        imported,
        imported_at as importedAt,
        trilium_note_id as triliumNoteId
      FROM notion_pages
      WHERE notion_id = ?
    `);

    const row = stmt.get(notionId) as any;
    if (!row) return null;

    return {
      ...row,
      imported: Boolean(row.imported),
    };
  }

  /**
   * Store or update a page in the cache
   */
  setPage(notionId: string, title: string, lastEditedTime: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO notion_pages (notion_id, title, last_edited_time, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(notion_id) DO UPDATE SET
        title = excluded.title,
        last_edited_time = excluded.last_edited_time,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(notionId, title, lastEditedTime);
    logger.debug(`Cached page: ${notionId} - ${title}`);
  }

  /**
   * Store the Trilium note ID for a Notion page without marking it as imported
   * Used in Phase 2 when creating note structure
   */
  setTriliumNoteId(notionId: string, triliumNoteId: string): void {
    const stmt = this.db.prepare(`
      UPDATE notion_pages
      SET
        trilium_note_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE notion_id = ?
    `);

    stmt.run(triliumNoteId, notionId);
    logger.debug(`Set Trilium note ID: ${notionId} -> ${triliumNoteId}`);
  }

  /**
   * Mark a page as imported with content
   * Should only be called after Phase 3 content update succeeds
   */
  markImported(notionId: string, triliumNoteId: string): void {
    const stmt = this.db.prepare(`
      UPDATE notion_pages
      SET
        imported = 1,
        imported_at = CURRENT_TIMESTAMP,
        trilium_note_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE notion_id = ?
    `);

    stmt.run(triliumNoteId, notionId);
    logger.debug(`Marked as imported: ${notionId} -> ${triliumNoteId}`);
  }

  /**
   * Check if a page needs to be imported (new or modified)
   */
  needsImport(notionId: string, currentLastEditedTime: string): boolean {
    const cached = this.getPage(notionId);

    if (!cached) {
      // New page, needs import
      return true;
    }

    if (!cached.imported) {
      // Previously failed import, retry
      return true;
    }

    // Check if the page has been modified since last import
    const cachedTime = new Date(cached.lastEditedTime).getTime();
    const currentTime = new Date(currentLastEditedTime).getTime();

    return currentTime > cachedTime;
  }

  /**
   * Get all pages that need to be imported (new or modified)
   */
  getPagesToImport(): CachedPage[] {
    const stmt = this.db.prepare(`
      SELECT
        notion_id as notionId,
        title,
        last_edited_time as lastEditedTime,
        imported,
        imported_at as importedAt,
        trilium_note_id as triliumNoteId
      FROM notion_pages
      WHERE imported = 0
      ORDER BY last_edited_time ASC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      ...row,
      imported: Boolean(row.imported),
    }));
  }

  /**
   * Get cache statistics
   */
  getStats(): { total: number; imported: number; pending: number } {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN imported = 1 THEN 1 ELSE 0 END) as imported,
        SUM(CASE WHEN imported = 0 THEN 1 ELSE 0 END) as pending
      FROM notion_pages
    `);

    const result = stmt.get() as any;
    return {
      total: result.total || 0,
      imported: result.imported || 0,
      pending: result.pending || 0,
    };
  }

  /**
   * Clear all cache data
   */
  clear(): void {
    this.db.exec('DELETE FROM notion_pages');
    logger.info('Cache cleared');
  }

  /**
   * Reset import status for all pages (for force re-import)
   */
  resetImportStatus(): void {
    this.db.exec(`
      UPDATE notion_pages
      SET
        imported = 0,
        imported_at = NULL,
        trilium_note_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    `);
    logger.info('Import status reset for all pages');
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    logger.debug('Cache closed');
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Log an import error
   */
  logError(
    notionId: string,
    notionTitle: string,
    errorMessage: string,
    phase: 'fetch' | 'convert' | 'import',
    errorStack?: string
  ): void {
    // Check if this error has occurred before for this page and phase
    const checkStmt = this.db.prepare(`
      SELECT MAX(retry_count) as max_retry
      FROM import_errors
      WHERE notion_id = ? AND phase = ? AND resolved = 0
    `);
    const result = checkStmt.get(notionId, phase) as any;
    const retryCount = result?.max_retry !== null ? result.max_retry + 1 : 0;

    // Insert new error record
    const stmt = this.db.prepare(`
      INSERT INTO import_errors (notion_id, notion_title, error_message, error_stack, phase, retry_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(notionId, notionTitle, errorMessage, errorStack || null, phase, retryCount);
    logger.debug(`Logged error for ${notionId} (${phase}): ${errorMessage}`);
  }

  /**
   * Get all unresolved errors
   */
  getErrors(options?: {
    notionId?: string;
    phase?: 'fetch' | 'convert' | 'import';
    limit?: number;
  }): ImportError[] {
    let query = `
      SELECT
        id,
        notion_id as notionId,
        notion_title as notionTitle,
        error_message as errorMessage,
        error_stack as errorStack,
        phase,
        timestamp,
        retry_count as retryCount
      FROM import_errors
      WHERE resolved = 0
    `;

    const params: any[] = [];

    if (options?.notionId) {
      query += ' AND notion_id = ?';
      params.push(options.notionId);
    }

    if (options?.phase) {
      query += ' AND phase = ?';
      params.push(options.phase);
    }

    query += ' ORDER BY timestamp DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as ImportError[];
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    total: number;
    byPhase: { fetch: number; convert: number; import: number };
    recurring: number;
  } {
    const totalStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT notion_id) as total
      FROM import_errors
      WHERE resolved = 0
    `);
    const totalResult = totalStmt.get() as any;

    const byPhaseStmt = this.db.prepare(`
      SELECT
        phase,
        COUNT(DISTINCT notion_id) as count
      FROM import_errors
      WHERE resolved = 0
      GROUP BY phase
    `);
    const phaseResults = byPhaseStmt.all() as any[];

    const byPhase = {
      fetch: 0,
      convert: 0,
      import: 0,
    };

    for (const row of phaseResults) {
      byPhase[row.phase as keyof typeof byPhase] = row.count;
    }

    const recurringStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT notion_id) as recurring
      FROM import_errors
      WHERE resolved = 0 AND retry_count > 0
    `);
    const recurringResult = recurringStmt.get() as any;

    return {
      total: totalResult.total || 0,
      byPhase,
      recurring: recurringResult.recurring || 0,
    };
  }

  /**
   * Mark errors for a specific page as resolved
   */
  resolveErrors(notionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE import_errors
      SET resolved = 1
      WHERE notion_id = ? AND resolved = 0
    `);

    stmt.run(notionId);
    logger.debug(`Resolved errors for: ${notionId}`);
  }

  /**
   * Clear all error logs
   */
  clearErrors(): void {
    this.db.exec('DELETE FROM import_errors');
    logger.info('Error logs cleared');
  }

  /**
   * Get a summary report of recent errors
   */
  getErrorSummary(limit: number = 10): string {
    const errors = this.getErrors({ limit });
    const stats = this.getErrorStats();

    let summary = '\n';
    summary += '═══════════════════════════════════════════════════\n';
    summary += '                  Error Summary                    \n';
    summary += '═══════════════════════════════════════════════════\n';
    summary += `  Total failed pages: ${stats.total}\n`;
    summary += `  Fetch errors:       ${stats.byPhase.fetch}\n`;
    summary += `  Convert errors:     ${stats.byPhase.convert}\n`;
    summary += `  Import errors:      ${stats.byPhase.import}\n`;
    summary += `  Recurring failures: ${stats.recurring}\n`;
    summary += '═══════════════════════════════════════════════════\n';

    if (errors.length > 0) {
      summary += '\nRecent Errors:\n\n';
      for (const error of errors) {
        summary += `❌ ${error.notionTitle}\n`;
        summary += `   ID: ${error.notionId}\n`;
        summary += `   Phase: ${error.phase}\n`;
        summary += `   Error: ${error.errorMessage}\n`;
        summary += `   Time: ${error.timestamp}\n`;
        if (error.retryCount > 0) {
          summary += `   Retries: ${error.retryCount}\n`;
        }
        summary += '\n';
      }
    }

    return summary;
  }
}
