import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { validateParentNote } from '../src/trilium/importer.js';
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
});
