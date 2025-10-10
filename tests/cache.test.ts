import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { NotionCache } from '../src/cache/index.js';
import fs from 'fs';
import path from 'path';

describe('NotionCache', () => {
  let cache: NotionCache;
  let testDbPath: string;

  beforeEach(() => {
    // Create a temporary database for testing
    testDbPath = path.join(process.cwd(), `.test-cache-${Date.now()}.db`);
    cache = new NotionCache(testDbPath);
  });

  afterEach(() => {
    // Clean up: close and delete test database
    cache.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('setPage and getPage', () => {
    it('should store and retrieve a page', () => {
      const notionId = 'page-123';
      const title = 'Test Page';
      const lastEditedTime = '2025-01-01T00:00:00Z';

      cache.setPage(notionId, title, lastEditedTime);

      const page = cache.getPage(notionId);
      expect(page).toBeTruthy();
      expect(page?.notionId).toBe(notionId);
      expect(page?.title).toBe(title);
      expect(page?.lastEditedTime).toBe(lastEditedTime);
      expect(page?.imported).toBe(false);
    });

    it('should update existing page', () => {
      const notionId = 'page-123';

      cache.setPage(notionId, 'Old Title', '2025-01-01T00:00:00Z');
      cache.setPage(notionId, 'New Title', '2025-01-02T00:00:00Z');

      const page = cache.getPage(notionId);
      expect(page?.title).toBe('New Title');
      expect(page?.lastEditedTime).toBe('2025-01-02T00:00:00Z');
    });

    it('should return null for non-existent page', () => {
      const page = cache.getPage('non-existent');
      expect(page).toBeNull();
    });
  });

  describe('markImported', () => {
    it('should mark a page as imported', () => {
      const notionId = 'page-123';
      const triliumNoteId = 'note-456';

      cache.setPage(notionId, 'Test Page', '2025-01-01T00:00:00Z');
      cache.markImported(notionId, triliumNoteId);

      const page = cache.getPage(notionId);
      expect(page?.imported).toBe(true);
      expect(page?.triliumNoteId).toBe(triliumNoteId);
      expect(page?.importedAt).toBeTruthy();
    });
  });

  describe('needsImport', () => {
    it('should return true for new page', () => {
      const needsImport = cache.needsImport('new-page', '2025-01-01T00:00:00Z');
      expect(needsImport).toBe(true);
    });

    it('should return true for unimported page', () => {
      const notionId = 'page-123';
      cache.setPage(notionId, 'Test Page', '2025-01-01T00:00:00Z');

      const needsImport = cache.needsImport(notionId, '2025-01-01T00:00:00Z');
      expect(needsImport).toBe(true);
    });

    it('should return false for imported page with same timestamp', () => {
      const notionId = 'page-123';
      const timestamp = '2025-01-01T00:00:00Z';

      cache.setPage(notionId, 'Test Page', timestamp);
      cache.markImported(notionId, 'note-456');

      const needsImport = cache.needsImport(notionId, timestamp);
      expect(needsImport).toBe(false);
    });

    it('should return true for imported page with newer timestamp', () => {
      const notionId = 'page-123';

      cache.setPage(notionId, 'Test Page', '2025-01-01T00:00:00Z');
      cache.markImported(notionId, 'note-456');

      const needsImport = cache.needsImport(notionId, '2025-01-02T00:00:00Z');
      expect(needsImport).toBe(true);
    });

    it('should return false for imported page with older timestamp', () => {
      const notionId = 'page-123';

      cache.setPage(notionId, 'Test Page', '2025-01-02T00:00:00Z');
      cache.markImported(notionId, 'note-456');

      const needsImport = cache.needsImport(notionId, '2025-01-01T00:00:00Z');
      expect(needsImport).toBe(false);
    });
  });

  describe('getPagesToImport', () => {
    it('should return only unimported pages', () => {
      cache.setPage('page-1', 'Page 1', '2025-01-01T00:00:00Z');
      cache.setPage('page-2', 'Page 2', '2025-01-02T00:00:00Z');
      cache.setPage('page-3', 'Page 3', '2025-01-03T00:00:00Z');

      cache.markImported('page-2', 'note-2');

      const pagesToImport = cache.getPagesToImport();
      expect(pagesToImport).toHaveLength(2);
      expect(pagesToImport.map(p => p.notionId)).toContain('page-1');
      expect(pagesToImport.map(p => p.notionId)).toContain('page-3');
      expect(pagesToImport.map(p => p.notionId)).not.toContain('page-2');
    });

    it('should return pages sorted by last_edited_time', () => {
      cache.setPage('page-1', 'Page 1', '2025-01-03T00:00:00Z');
      cache.setPage('page-2', 'Page 2', '2025-01-01T00:00:00Z');
      cache.setPage('page-3', 'Page 3', '2025-01-02T00:00:00Z');

      const pagesToImport = cache.getPagesToImport();
      expect(pagesToImport).toHaveLength(3);
      expect(pagesToImport[0].notionId).toBe('page-2');
      expect(pagesToImport[1].notionId).toBe('page-3');
      expect(pagesToImport[2].notionId).toBe('page-1');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      cache.setPage('page-1', 'Page 1', '2025-01-01T00:00:00Z');
      cache.setPage('page-2', 'Page 2', '2025-01-02T00:00:00Z');
      cache.setPage('page-3', 'Page 3', '2025-01-03T00:00:00Z');

      cache.markImported('page-1', 'note-1');
      cache.markImported('page-2', 'note-2');

      const stats = cache.getStats();
      expect(stats.total).toBe(3);
      expect(stats.imported).toBe(2);
      expect(stats.pending).toBe(1);
    });

    it('should return zeros for empty cache', () => {
      const stats = cache.getStats();
      expect(stats.total).toBe(0);
      expect(stats.imported).toBe(0);
      expect(stats.pending).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all pages', () => {
      cache.setPage('page-1', 'Page 1', '2025-01-01T00:00:00Z');
      cache.setPage('page-2', 'Page 2', '2025-01-02T00:00:00Z');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('resetImportStatus', () => {
    it('should reset import status for all pages', () => {
      cache.setPage('page-1', 'Page 1', '2025-01-01T00:00:00Z');
      cache.setPage('page-2', 'Page 2', '2025-01-02T00:00:00Z');

      cache.markImported('page-1', 'note-1');
      cache.markImported('page-2', 'note-2');

      let stats = cache.getStats();
      expect(stats.imported).toBe(2);
      expect(stats.pending).toBe(0);

      cache.resetImportStatus();

      stats = cache.getStats();
      expect(stats.imported).toBe(0);
      expect(stats.pending).toBe(2);

      const page1 = cache.getPage('page-1');
      expect(page1?.imported).toBe(false);
      expect(page1?.triliumNoteId).toBeNull();
      expect(page1?.importedAt).toBeNull();
    });
  });

  describe('database persistence', () => {
    it('should persist data across instances', () => {
      const notionId = 'page-123';
      const title = 'Test Page';
      const lastEditedTime = '2025-01-01T00:00:00Z';

      cache.setPage(notionId, title, lastEditedTime);
      cache.markImported(notionId, 'note-456');
      cache.close();

      // Create new instance with same database
      const cache2 = new NotionCache(testDbPath);
      const page = cache2.getPage(notionId);

      expect(page).toBeTruthy();
      expect(page?.notionId).toBe(notionId);
      expect(page?.title).toBe(title);
      expect(page?.imported).toBe(true);
      expect(page?.triliumNoteId).toBe('note-456');

      cache2.close();
    });
  });

  describe('getDbPath', () => {
    it('should return the database file path', () => {
      const dbPath = cache.getDbPath();
      expect(dbPath).toBe(testDbPath);
    });
  });
});
