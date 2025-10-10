import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { validateParentNote, createParentNote } from '../src/trilium/importer.js';
import * as etapi from '../src/trilium/etapi.js';

// Mock the etapi module
jest.mock('../src/trilium/etapi.js', () => ({
  etapiRequest: jest.fn(),
  initETAPI: jest.fn(),
}));

describe('Trilium Importer', () => {
  describe('validateParentNote', () => {
    let mockEtapiRequest: any;

    beforeEach(() => {
      mockEtapiRequest = etapi.etapiRequest as jest.Mock;
      jest.clearAllMocks();
    });

    it('should return true for root note without making API call', async () => {
      const result = await validateParentNote('root');

      expect(result).toBe(true);
      expect(mockEtapiRequest).not.toHaveBeenCalled();
    });

    it('should return true for a valid and accessible note', async () => {
      const mockNote = {
        noteId: 'valid-note-123',
        title: 'Import Folder',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockNote);

      const result = await validateParentNote('valid-note-123');

      expect(result).toBe(true);
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes/valid-note-123');
    });

    it('should return false for a non-existent note (404)', async () => {
      const error = new Error('ETAPI request failed: 404 Not Found');

      mockEtapiRequest.mockRejectedValue(error);

      const result = await validateParentNote('non-existent-note');

      expect(result).toBe(false);
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes/non-existent-note');
    });

    it('should return false for an unauthorized note (401)', async () => {
      const error = new Error('ETAPI request failed: 401 Unauthorized');

      mockEtapiRequest.mockRejectedValue(error);

      const result = await validateParentNote('unauthorized-note');

      expect(result).toBe(false);
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes/unauthorized-note');
    });

    it('should return false for a forbidden note (403)', async () => {
      const error = new Error('ETAPI request failed: 403 Forbidden');

      mockEtapiRequest.mockRejectedValue(error);

      const result = await validateParentNote('forbidden-note');

      expect(result).toBe(false);
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes/forbidden-note');
    });

    it('should return false for other errors', async () => {
      const error = new Error('Network error');

      mockEtapiRequest.mockRejectedValue(error);

      const result = await validateParentNote('error-note');

      expect(result).toBe(false);
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes/error-note');
    });

    it('should return false if note response has no noteId', async () => {
      const mockNote = {
        title: 'Incomplete Note',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockNote);

      const result = await validateParentNote('incomplete-note');

      expect(result).toBe(false);
    });

    it('should handle notes with special characters in ID', async () => {
      const mockNote = {
        noteId: 'note-with-special_chars-123',
        title: 'Special Note',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockNote);

      const result = await validateParentNote('note-with-special_chars-123');

      expect(result).toBe(true);
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes/note-with-special_chars-123');
    });
  });

  describe('createParentNote', () => {
    let mockEtapiRequest: any;

    beforeEach(() => {
      mockEtapiRequest = etapi.etapiRequest as jest.Mock;
      jest.clearAllMocks();
    });

    it('should create a parent note with default parent (root)', async () => {
      const mockNote = {
        noteId: 'created-note-123',
        title: 'My Import Folder',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockNote);

      const result = await createParentNote('My Import Folder');

      expect(result).toBe('created-note-123');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: {
          parentNoteId: 'root',
          title: 'My Import Folder',
          type: 'text',
          content: '<p>This note was created to import Notion pages.</p>',
          mime: 'text/html',
        },
      });
    });

    it('should create a parent note under specified parent', async () => {
      const mockNote = {
        noteId: 'created-note-456',
        title: 'Nested Folder',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockNote);

      const result = await createParentNote('Nested Folder', 'parent-note-789');

      expect(result).toBe('created-note-456');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: {
          parentNoteId: 'parent-note-789',
          title: 'Nested Folder',
          type: 'text',
          content: '<p>This note was created to import Notion pages.</p>',
          mime: 'text/html',
        },
      });
    });

    it('should return null if note creation fails with error', async () => {
      const error = new Error('Failed to create note');

      mockEtapiRequest.mockRejectedValue(error);

      const result = await createParentNote('Failed Note');

      expect(result).toBeNull();
    });

    it('should return null if response has no noteId', async () => {
      const mockNote = {
        title: 'Incomplete Note',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockNote);

      const result = await createParentNote('Incomplete Note');

      expect(result).toBeNull();
    });

    it('should handle special characters in title', async () => {
      const mockNote = {
        noteId: 'note-with-special',
        title: 'Import from Notion (2024) - "Main"',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockNote);

      const result = await createParentNote('Import from Notion (2024) - "Main"');

      expect(result).toBe('note-with-special');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', expect.objectContaining({
        body: expect.objectContaining({
          title: 'Import from Notion (2024) - "Main"',
        }),
      }));
    });
  });
});
