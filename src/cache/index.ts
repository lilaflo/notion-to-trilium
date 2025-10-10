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
   * Mark a page as imported
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
}
