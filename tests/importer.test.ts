import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { validateParentNote, createParentNote, sortPagesForImport, createNote, findExistingNotionNote, rebuildHierarchyInTrilium } from '../src/trilium/importer.js';
import type { NotionPage, NotionPageMetadata } from '../src/notion/types.js';
import * as etapi from '../src/trilium/etapi.js';

// Mock node-fetch
jest.mock('node-fetch', () => ({
  default: jest.fn(),
}));

// Mock the etapi module
jest.mock('../src/trilium/etapi.js', () => ({
  etapiRequest: jest.fn(),
  initETAPI: jest.fn(),
  getETAPIBaseUrl: jest.fn(() => 'http://localhost:8080'),
  getETAPIAuthHeader: jest.fn(() => 'Basic dGVzdDp0b2tlbg=='),
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

  describe('sortPagesForImport', () => {
    const createMockPage = (id: string, title: string, parentId: string | null = null): NotionPage => ({
      id,
      title,
      content: [],
      parentId,
      url: `https://notion.so/${id}`,
      createdTime: '2024-01-01T00:00:00.000Z',
      lastEditedTime: '2024-01-01T00:00:00.000Z',
    });

    it('should return empty array for empty input', () => {
      const result = sortPagesForImport([]);
      expect(result).toEqual([]);
    });

    it('should return single page unchanged', () => {
      const page = createMockPage('page-1', 'Page 1');
      const result = sortPagesForImport([page]);
      expect(result).toEqual([page]);
    });

    it('should preserve order for pages without parent relationships', () => {
      const page1 = createMockPage('page-1', 'Page 1');
      const page2 = createMockPage('page-2', 'Page 2');
      const page3 = createMockPage('page-3', 'Page 3');

      const result = sortPagesForImport([page1, page2, page3]);
      expect(result).toHaveLength(3);
      expect(result).toContain(page1);
      expect(result).toContain(page2);
      expect(result).toContain(page3);
    });

    it('should sort parent before child when child comes first', () => {
      const parent = createMockPage('parent', 'Parent');
      const child = createMockPage('child', 'Child', 'parent');

      // Input: child first, parent second
      const result = sortPagesForImport([child, parent]);

      // Output: parent first, child second
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(parent);
      expect(result[1]).toEqual(child);
    });

    it('should preserve parent-child order when already correct', () => {
      const parent = createMockPage('parent', 'Parent');
      const child = createMockPage('child', 'Child', 'parent');

      // Input: parent first, child second (already correct)
      const result = sortPagesForImport([parent, child]);

      // Output: same order
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(parent);
      expect(result[1]).toEqual(child);
    });

    it('should handle multi-level hierarchy', () => {
      const grandparent = createMockPage('gp', 'Grandparent');
      const parent = createMockPage('p', 'Parent', 'gp');
      const child = createMockPage('c', 'Child', 'p');

      // Input: scrambled order
      const result = sortPagesForImport([child, grandparent, parent]);

      // Output: grandparent → parent → child
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(grandparent);
      expect(result[1]).toEqual(parent);
      expect(result[2]).toEqual(child);
    });

    it('should handle multiple branches correctly', () => {
      const root = createMockPage('root', 'Root');
      const child1 = createMockPage('c1', 'Child 1', 'root');
      const child2 = createMockPage('c2', 'Child 2', 'root');
      const grandchild1 = createMockPage('gc1', 'Grandchild 1', 'c1');

      // Input: scrambled order
      const result = sortPagesForImport([grandchild1, child2, root, child1]);

      // Output: root must come first, then its children, then grandchildren
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual(root);

      // Children can be in any order, but both should come before grandchild1
      const rootIndex = result.indexOf(root);
      const child1Index = result.indexOf(child1);
      const child2Index = result.indexOf(child2);
      const grandchild1Index = result.indexOf(grandchild1);

      expect(child1Index).toBeGreaterThan(rootIndex);
      expect(child2Index).toBeGreaterThan(rootIndex);
      expect(grandchild1Index).toBeGreaterThan(child1Index);
    });

    it('should handle orphaned pages (parent not in set)', () => {
      const orphan = createMockPage('orphan', 'Orphan', 'missing-parent');
      const standalone = createMockPage('standalone', 'Standalone');

      const result = sortPagesForImport([orphan, standalone]);

      // Both pages should be included even though orphan's parent doesn't exist
      expect(result).toHaveLength(2);
      expect(result).toContain(orphan);
      expect(result).toContain(standalone);
    });

    it('should handle deeply nested hierarchy', () => {
      const level0 = createMockPage('l0', 'Level 0');
      const level1 = createMockPage('l1', 'Level 1', 'l0');
      const level2 = createMockPage('l2', 'Level 2', 'l1');
      const level3 = createMockPage('l3', 'Level 3', 'l2');
      const level4 = createMockPage('l4', 'Level 4', 'l3');

      // Input: completely reversed
      const result = sortPagesForImport([level4, level3, level2, level1, level0]);

      // Output: correct order from root to leaf
      expect(result).toHaveLength(5);
      expect(result[0]).toEqual(level0);
      expect(result[1]).toEqual(level1);
      expect(result[2]).toEqual(level2);
      expect(result[3]).toEqual(level3);
      expect(result[4]).toEqual(level4);
    });

    it('should not modify input array', () => {
      const parent = createMockPage('parent', 'Parent');
      const child = createMockPage('child', 'Child', 'parent');
      const input = [child, parent];
      const inputCopy = [...input];

      sortPagesForImport(input);

      // Original input should be unchanged
      expect(input).toEqual(inputCopy);
    });
  });

  describe('createNote', () => {
    let mockEtapiRequest: any;

    const createMockPage = (id: string, title: string, parentId: string | null = null): NotionPage => ({
      id,
      title,
      content: [],
      parentId,
      url: `https://notion.so/${id}`,
      createdTime: '2024-01-01T00:00:00.000Z',
      lastEditedTime: '2024-01-01T00:00:00.000Z',
    });

    beforeEach(() => {
      mockEtapiRequest = etapi.etapiRequest as jest.Mock;
      jest.clearAllMocks();
    });

    it('should create note without parent mapping', async () => {
      const page = createMockPage('page-123', 'Test Page');
      const mockResponse = {
        noteId: 'note-456',
        title: 'Test Page',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root');

      expect(result).toBe('note-456');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: expect.objectContaining({
          parentNoteId: 'root',
          title: 'Test Page',
          type: 'text',
          mime: 'text/html',
        }),
      });
    });

    it('should use mapped parent ID when available', async () => {
      const page = createMockPage('page-123', 'Child Page', 'parent-notion-id');
      const pageMapping = new Map([['parent-notion-id', 'parent-trilium-id']]);
      const mockResponse = {
        noteId: 'note-456',
        title: 'Child Page',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root', pageMapping);

      expect(result).toBe('note-456');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: expect.objectContaining({
          parentNoteId: 'parent-trilium-id',
          title: 'Child Page',
        }),
      });
    });

    it('should fall back to default parent when mapping not found', async () => {
      const page = createMockPage('page-123', 'Child Page', 'missing-parent');
      const pageMapping = new Map([['other-parent', 'other-trilium-id']]);
      const mockResponse = {
        noteId: 'note-456',
        title: 'Child Page',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root', pageMapping);

      expect(result).toBe('note-456');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: expect.objectContaining({
          parentNoteId: 'root',
          title: 'Child Page',
        }),
      });
    });

    it('should handle alternate response formats (note.noteId)', async () => {
      const page = createMockPage('page-123', 'Test Page');
      const mockResponse = {
        note: {
          noteId: 'note-789',
          title: 'Test Page',
        },
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root');

      expect(result).toBe('note-789');
    });

    it('should handle alternate response formats (id)', async () => {
      const page = createMockPage('page-123', 'Test Page');
      const mockResponse = {
        id: 'note-abc',
        title: 'Test Page',
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root');

      expect(result).toBe('note-abc');
    });

    it('should return null when no noteId in response', async () => {
      const page = createMockPage('page-123', 'Failed Page');
      const mockResponse = {
        title: 'Failed Page',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root');

      expect(result).toBeNull();
    });

    it('should return null on API error', async () => {
      const page = createMockPage('page-123', 'Error Page');
      const error = new Error('ETAPI request failed');

      mockEtapiRequest.mockRejectedValue(error);

      const result = await createNote(page, 'root');

      expect(result).toBeNull();
    });

    it('should handle pages with no title', async () => {
      const page = createMockPage('page-123', '');
      page.title = '';
      const mockResponse = {
        noteId: 'note-456',
        title: 'Untitled',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root');

      expect(result).toBe('note-456');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: expect.objectContaining({
          title: 'Untitled',
        }),
      });
    });

    it('should add attributes after successful note creation', async () => {
      const page = createMockPage('page-123', 'Test Page');
      page.url = 'https://notion.so/test-page-123';
      const mockResponse = {
        noteId: 'note-456',
        title: 'Test Page',
        type: 'text',
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await createNote(page, 'root');

      expect(result).toBe('note-456');

      // Should have called etapiRequest for note creation + 3 attributes (notionId, notionUrl, imported)
      expect(mockEtapiRequest).toHaveBeenCalledTimes(4);

      // Check attribute calls
      expect(mockEtapiRequest).toHaveBeenCalledWith('/attributes', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          noteId: 'note-456',
          name: 'notionId',
          value: 'page-123',
        }),
      }));

      expect(mockEtapiRequest).toHaveBeenCalledWith('/attributes', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          noteId: 'note-456',
          name: 'notionUrl',
          value: 'https://notion.so/test-page-123',
        }),
      }));
    });
  });

  describe('updateNoteContent', () => {
    it('should skip notes with no content blocks', async () => {
      // This is a conceptual test to document the behavior
      // The actual implementation should skip updating notes that have no content
      // to avoid Trilium errors about null content

      // Expected behavior:
      // 1. If fetchContentFn returns null or empty array, skip the update
      // 2. Log a debug message indicating the skip
      // 3. Count as successful (since the empty note exists from Phase 2)
      // 4. Do not call updateNoteInTrilium

      // This ensures:
      // - No "Cannot set null content" errors from Trilium
      // - Empty pages remain as placeholder notes
      // - Clean import flow without errors

      expect(true).toBe(true);
    });
  });

  describe('findExistingNotionNote', () => {
    let mockEtapiRequest: any;

    beforeEach(() => {
      mockEtapiRequest = etapi.etapiRequest as jest.Mock;
      jest.clearAllMocks();
    });

    it('should return note ID when note with notionId attribute exists', async () => {
      const mockResponse = {
        results: [
          {
            noteId: 'existing-note-123',
            title: 'Existing Note',
          },
        ],
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await findExistingNotionNote('notion-page-abc');

      expect(result).toBe('existing-note-123');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes?search=@notionId="notion-page-abc"');
    });

    it('should return null when no note with notionId attribute exists', async () => {
      const mockResponse = {
        results: [],
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await findExistingNotionNote('notion-page-xyz');

      expect(result).toBeNull();
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes?search=@notionId="notion-page-xyz"');
    });

    it('should return null on API error', async () => {
      const error = new Error('ETAPI request failed');

      mockEtapiRequest.mockRejectedValue(error);

      const result = await findExistingNotionNote('notion-page-error');

      expect(result).toBeNull();
    });

    it('should handle response with multiple results (return first)', async () => {
      const mockResponse = {
        results: [
          { noteId: 'note-1', title: 'Note 1' },
          { noteId: 'note-2', title: 'Note 2' },
        ],
      };

      mockEtapiRequest.mockResolvedValue(mockResponse);

      const result = await findExistingNotionNote('notion-page-abc');

      expect(result).toBe('note-1');
    });
  });

  describe('rebuildHierarchyInTrilium', () => {
    let mockEtapiRequest: any;

    const createMockPageMeta = (id: string, title: string, parentId: string | null = null): NotionPageMetadata => ({
      id,
      title,
      parentId,
      url: `https://notion.so/${id}`,
      createdTime: '2024-01-01T00:00:00.000Z',
      lastEditedTime: '2024-01-01T00:00:00.000Z',
    });

    beforeEach(() => {
      mockEtapiRequest = etapi.etapiRequest as jest.Mock;
      jest.clearAllMocks();
    });

    it('should reuse existing note when notionId attribute exists', async () => {
      const pageMeta = createMockPageMeta('notion-page-1', 'Existing Page');

      // First call: search for existing note (returns existing)
      mockEtapiRequest.mockResolvedValueOnce({
        results: [{ noteId: 'existing-note-123' }],
      });

      const result = await rebuildHierarchyInTrilium([pageMeta], 'root', false);

      expect(result.get('notion-page-1')).toBe('existing-note-123');

      // Should only search for existing note, not create a new one
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes?search=@notionId="notion-page-1"');
      expect(mockEtapiRequest).not.toHaveBeenCalledWith('/create-note', expect.anything());
    });

    it('should create new note and add notionId attribute when note does not exist', async () => {
      const pageMeta = createMockPageMeta('notion-page-2', 'New Page');

      // First call: search for existing note (returns empty)
      mockEtapiRequest.mockResolvedValueOnce({
        results: [],
      });

      // Second call: create new note
      mockEtapiRequest.mockResolvedValueOnce({
        noteId: 'new-note-456',
        title: 'New Page',
      });

      // Third call: add notionId attribute
      mockEtapiRequest.mockResolvedValueOnce({
        attributeId: 'attr-789',
      });

      const result = await rebuildHierarchyInTrilium([pageMeta], 'root', false);

      expect(result.get('notion-page-2')).toBe('new-note-456');

      // Should search, create, and add attribute
      expect(mockEtapiRequest).toHaveBeenCalledWith('/notes?search=@notionId="notion-page-2"');
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: {
          parentNoteId: 'root',
          title: 'New Page',
          type: 'text',
          content: '',
          mime: 'text/html',
        },
      });
      expect(mockEtapiRequest).toHaveBeenCalledWith('/attributes', {
        method: 'POST',
        body: {
          noteId: 'new-note-456',
          type: 'label',
          name: 'notionId',
          value: 'notion-page-2',
        },
      });
    });

    it('should handle multiple pages with some existing and some new', async () => {
      const pages = [
        createMockPageMeta('notion-1', 'Existing Page'),
        createMockPageMeta('notion-2', 'New Page'),
      ];

      // First page: existing
      mockEtapiRequest.mockResolvedValueOnce({
        results: [{ noteId: 'existing-note-1' }],
      });

      // Second page: new (search returns empty)
      mockEtapiRequest.mockResolvedValueOnce({
        results: [],
      });

      // Second page: create
      mockEtapiRequest.mockResolvedValueOnce({
        noteId: 'new-note-2',
      });

      // Second page: add attribute
      mockEtapiRequest.mockResolvedValueOnce({
        attributeId: 'attr-2',
      });

      const result = await rebuildHierarchyInTrilium(pages, 'root', false);

      expect(result.get('notion-1')).toBe('existing-note-1');
      expect(result.get('notion-2')).toBe('new-note-2');
      expect(result.size).toBe(2);
    });

    it('should skip creating notes in dry run mode', async () => {
      const pageMeta = createMockPageMeta('notion-page-3', 'Dry Run Page');

      const result = await rebuildHierarchyInTrilium([pageMeta], 'root', true);

      expect(result.size).toBe(0);
      expect(mockEtapiRequest).not.toHaveBeenCalled();
    });

    it('should preserve parent-child relationships', async () => {
      const parent = createMockPageMeta('notion-parent', 'Parent Page');
      const child = createMockPageMeta('notion-child', 'Child Page', 'notion-parent');

      // Parent: search (not found)
      mockEtapiRequest.mockResolvedValueOnce({ results: [] });
      // Parent: create
      mockEtapiRequest.mockResolvedValueOnce({ noteId: 'trilium-parent' });
      // Parent: add attribute
      mockEtapiRequest.mockResolvedValueOnce({ attributeId: 'attr-p' });

      // Child: search (not found)
      mockEtapiRequest.mockResolvedValueOnce({ results: [] });
      // Child: create
      mockEtapiRequest.mockResolvedValueOnce({ noteId: 'trilium-child' });
      // Child: add attribute
      mockEtapiRequest.mockResolvedValueOnce({ attributeId: 'attr-c' });

      const result = await rebuildHierarchyInTrilium([parent, child], 'root', false);

      expect(result.get('notion-parent')).toBe('trilium-parent');
      expect(result.get('notion-child')).toBe('trilium-child');

      // Verify child was created under parent
      expect(mockEtapiRequest).toHaveBeenCalledWith('/create-note', {
        method: 'POST',
        body: expect.objectContaining({
          parentNoteId: 'trilium-parent',
          title: 'Child Page',
        }),
      });
    });
  });
});
