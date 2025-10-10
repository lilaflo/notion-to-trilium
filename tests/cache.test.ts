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

  describe('error logging', () => {
    describe('logError', () => {
      it('should log an import error', () => {
        cache.logError(
          'page-123',
          'Test Page',
          'Failed to create note',
          'import'
        );

        const errors = cache.getErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0].notionId).toBe('page-123');
        expect(errors[0].notionTitle).toBe('Test Page');
        expect(errors[0].errorMessage).toBe('Failed to create note');
        expect(errors[0].phase).toBe('import');
        expect(errors[0].retryCount).toBe(0);
      });

      it('should track retry count for repeated errors', () => {
        cache.logError('page-123', 'Test Page', 'Error 1', 'import');
        cache.logError('page-123', 'Test Page', 'Error 2', 'import');
        cache.logError('page-123', 'Test Page', 'Error 3', 'import');

        const errors = cache.getErrors({ notionId: 'page-123' });
        expect(errors).toHaveLength(3);

        // Errors are sorted by timestamp DESC (most recent first)
        // But retry count is based on previous errors, so latest has highest count
        const retryCounts = errors.map(e => e.retryCount).sort((a, b) => a - b);
        expect(retryCounts).toEqual([0, 1, 2]);
      });

      it('should store error stack trace', () => {
        const errorStack = 'Error: Test error\n    at test.ts:123:45';

        cache.logError(
          'page-123',
          'Test Page',
          'Test error',
          'import',
          errorStack
        );

        const errors = cache.getErrors();
        expect(errors[0].errorStack).toBe(errorStack);
      });

      it('should log errors for different phases separately', () => {
        cache.logError('page-123', 'Test Page', 'Fetch error', 'fetch');
        cache.logError('page-123', 'Test Page', 'Convert error', 'convert');
        cache.logError('page-123', 'Test Page', 'Import error', 'import');

        const errors = cache.getErrors({ notionId: 'page-123' });
        expect(errors).toHaveLength(3);

        const phases = errors.map(e => e.phase);
        expect(phases).toContain('fetch');
        expect(phases).toContain('convert');
        expect(phases).toContain('import');
      });
    });

    describe('getErrors', () => {
      beforeEach(() => {
        cache.logError('page-1', 'Page 1', 'Error 1', 'fetch');
        cache.logError('page-2', 'Page 2', 'Error 2', 'convert');
        cache.logError('page-3', 'Page 3', 'Error 3', 'import');
        cache.logError('page-4', 'Page 4', 'Error 4', 'import');
      });

      it('should return all errors', () => {
        const errors = cache.getErrors();
        expect(errors).toHaveLength(4);
      });

      it('should filter by notion ID', () => {
        const errors = cache.getErrors({ notionId: 'page-2' });
        expect(errors).toHaveLength(1);
        expect(errors[0].notionId).toBe('page-2');
      });

      it('should filter by phase', () => {
        const errors = cache.getErrors({ phase: 'import' });
        expect(errors).toHaveLength(2);
        expect(errors.every(e => e.phase === 'import')).toBe(true);
      });

      it('should limit results', () => {
        const errors = cache.getErrors({ limit: 2 });
        expect(errors).toHaveLength(2);
      });

      it('should return errors in descending timestamp order', () => {
        const errors = cache.getErrors();
        expect(errors.length).toBeGreaterThan(0);

        // Most recent error should be first
        for (let i = 1; i < errors.length; i++) {
          const prev = new Date(errors[i - 1].timestamp).getTime();
          const curr = new Date(errors[i].timestamp).getTime();
          expect(prev).toBeGreaterThanOrEqual(curr);
        }
      });
    });

    describe('getErrorStats', () => {
      it('should return error statistics', () => {
        cache.logError('page-1', 'Page 1', 'Error 1', 'fetch');
        cache.logError('page-2', 'Page 2', 'Error 2', 'convert');
        cache.logError('page-3', 'Page 3', 'Error 3', 'import');
        cache.logError('page-3', 'Page 3', 'Error 4', 'import');

        const stats = cache.getErrorStats();
        expect(stats.total).toBe(3); // Unique pages
        expect(stats.byPhase.fetch).toBe(1);
        expect(stats.byPhase.convert).toBe(1);
        expect(stats.byPhase.import).toBe(1);
        expect(stats.recurring).toBe(1); // page-3 has retry
      });

      it('should return zeros for no errors', () => {
        const stats = cache.getErrorStats();
        expect(stats.total).toBe(0);
        expect(stats.byPhase.fetch).toBe(0);
        expect(stats.byPhase.convert).toBe(0);
        expect(stats.byPhase.import).toBe(0);
        expect(stats.recurring).toBe(0);
      });
    });

    describe('resolveErrors', () => {
      it('should mark errors as resolved', () => {
        cache.logError('page-123', 'Test Page', 'Error 1', 'import');
        cache.logError('page-123', 'Test Page', 'Error 2', 'import');

        let errors = cache.getErrors({ notionId: 'page-123' });
        expect(errors).toHaveLength(2);

        cache.resolveErrors('page-123');

        errors = cache.getErrors({ notionId: 'page-123' });
        expect(errors).toHaveLength(0);
      });

      it('should not affect errors for other pages', () => {
        cache.logError('page-1', 'Page 1', 'Error 1', 'import');
        cache.logError('page-2', 'Page 2', 'Error 2', 'import');

        cache.resolveErrors('page-1');

        const errors = cache.getErrors();
        expect(errors).toHaveLength(1);
        expect(errors[0].notionId).toBe('page-2');
      });
    });

    describe('clearErrors', () => {
      it('should remove all error logs', () => {
        cache.logError('page-1', 'Page 1', 'Error 1', 'import');
        cache.logError('page-2', 'Page 2', 'Error 2', 'import');

        let errors = cache.getErrors();
        expect(errors.length).toBeGreaterThan(0);

        cache.clearErrors();

        errors = cache.getErrors();
        expect(errors).toHaveLength(0);
      });
    });

    describe('getErrorSummary', () => {
      it('should generate a formatted error summary', () => {
        cache.logError('page-1', 'Test Page 1', 'Error message 1', 'import');
        cache.logError('page-2', 'Test Page 2', 'Error message 2', 'fetch');

        const summary = cache.getErrorSummary(10);

        expect(summary).toContain('Error Summary');
        expect(summary).toContain('Test Page 1');
        expect(summary).toContain('Test Page 2');
        expect(summary).toContain('Error message 1');
        expect(summary).toContain('Error message 2');
        expect(summary).toContain('import');
        expect(summary).toContain('fetch');
      });

      it('should limit errors in summary', () => {
        for (let i = 0; i < 20; i++) {
          cache.logError(`page-${i}`, `Page ${i}`, `Error ${i}`, 'import');
        }

        const summary = cache.getErrorSummary(5);
        const lines = summary.split('\n');

        // Count error entries (each error has multiple lines)
        const errorCount = (summary.match(/❌/g) || []).length;
        expect(errorCount).toBeLessThanOrEqual(5);
      });

      it('should show no errors message when clean', () => {
        const summary = cache.getErrorSummary();
        expect(summary).toContain('Error Summary');
        expect(summary).toContain('Total failed pages: 0');
      });
    });

    describe('error resolution on successful import', () => {
      it('should resolve errors when page is successfully imported', () => {
        // Log an error
        cache.logError('page-123', 'Test Page', 'Previous error', 'import');

        let errors = cache.getErrors({ notionId: 'page-123' });
        expect(errors).toHaveLength(1);

        // Simulate successful import
        cache.setPage('page-123', 'Test Page', '2025-01-01T00:00:00Z');
        cache.markImported('page-123', 'note-456');
        cache.resolveErrors('page-123');

        errors = cache.getErrors({ notionId: 'page-123' });
        expect(errors).toHaveLength(0);
      });
    });
  });
});
