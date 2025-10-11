import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { validateRootPage, fetchAllPages, fetchPageContent } from '../src/notion/fetcher.js';
import type { Client } from '@notionhq/client';
import type { NotionPage } from '../src/notion/types.js';

describe('Notion Fetcher', () => {
  describe('validateRootPage', () => {
    let mockClient: Client;
    let mockRetrieve: any;

    beforeEach(() => {
      mockRetrieve = jest.fn();
      mockClient = {
        pages: {
          retrieve: mockRetrieve,
        },
      } as any;
    });

    it('should return true for a valid and accessible page', async () => {
      const mockPage = {
        id: 'valid-page-id',
        object: 'page',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Test Page' }],
          },
        },
        url: 'https://notion.so/test',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      };

      mockRetrieve.mockResolvedValue(mockPage);

      const result = await validateRootPage(mockClient, 'valid-page-id');

      expect(result).toBe(true);
      expect(mockRetrieve).toHaveBeenCalledWith({ page_id: 'valid-page-id' });
    });

    it('should return false for a non-existent page', async () => {
      const error = new Error('Page not found');
      (error as any).code = 'object_not_found';

      mockRetrieve.mockRejectedValue(error);

      const result = await validateRootPage(mockClient, 'non-existent-id');

      expect(result).toBe(false);
    });

    it('should return false for an unauthorized page', async () => {
      const error = new Error('Unauthorized');
      (error as any).code = 'unauthorized';

      mockRetrieve.mockRejectedValue(error);

      const result = await validateRootPage(mockClient, 'unauthorized-id');

      expect(result).toBe(false);
    });

    it('should return false for a partial page response (not fully accessible)', async () => {
      const mockPartialPage = {
        id: 'partial-page-id',
        object: 'page',
        // Missing properties field indicates limited access
      };

      mockRetrieve.mockResolvedValue(mockPartialPage);

      const result = await validateRootPage(mockClient, 'partial-page-id');

      expect(result).toBe(false);
    });

    it('should return false for other errors', async () => {
      const error = new Error('Network error');

      mockRetrieve.mockRejectedValue(error);

      const result = await validateRootPage(mockClient, 'error-id');

      expect(result).toBe(false);
    });

    it('should handle pages with different title property structures', async () => {
      const mockPage = {
        id: 'page-id',
        object: 'page',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'My Page' }],
          },
        },
        url: 'https://notion.so/test',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      };

      mockRetrieve.mockResolvedValue(mockPage);

      const result = await validateRootPage(mockClient, 'page-id');

      expect(result).toBe(true);
    });

    it('should handle pages without a title', async () => {
      const mockPage = {
        id: 'untitled-page-id',
        object: 'page',
        properties: {},
        url: 'https://notion.so/test',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      };

      mockRetrieve.mockResolvedValue(mockPage);

      const result = await validateRootPage(mockClient, 'untitled-page-id');

      expect(result).toBe(true);
    });
  });

  describe('fetchAllPages with callback', () => {
    let mockClient: Client;
    let mockRetrieve: any;
    let mockListChildren: any;
    let mockSearch: any;

    beforeEach(() => {
      mockRetrieve = jest.fn();
      mockListChildren = jest.fn();
      mockSearch = jest.fn();
      mockClient = {
        pages: {
          retrieve: mockRetrieve,
        },
        blocks: {
          children: {
            list: mockListChildren,
          },
        },
        search: mockSearch,
      } as any;
    });

    it('should call callback for each fetched page when using root page', async () => {
      // Mock page data
      const mockRootPage = {
        id: 'root-page-id',
        object: 'page',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Root Page' }],
          },
        },
        url: 'https://notion.so/root',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      };

      const mockChildPage = {
        id: 'child-page-id',
        object: 'page',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Child Page' }],
          },
        },
        url: 'https://notion.so/child',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'page_id', page_id: 'root-page-id' },
      };

      // Mock API responses
      mockRetrieve
        .mockResolvedValueOnce(mockRootPage)
        .mockResolvedValueOnce(mockChildPage);

      mockListChildren
        .mockResolvedValueOnce({
          results: [
            {
              id: 'child-block-id',
              type: 'child_page',
              child_page: { id: 'child-page-id', title: 'Child Page' },
              has_children: false,
            },
          ],
          has_more: false,
        })
        .mockResolvedValueOnce({
          results: [],
          has_more: false,
        });

      // Track callback invocations
      const callbackMock = jest.fn<(page: NotionPage) => Promise<void>>();
      callbackMock.mockResolvedValue(undefined);

      await fetchAllPages(mockClient, 'root-page-id', callbackMock);

      // Verify callback was called for both pages
      expect(callbackMock).toHaveBeenCalledTimes(2);
      expect(callbackMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
        id: 'root-page-id',
        title: 'Root Page',
      }));
      expect(callbackMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
        id: 'child-page-id',
        title: 'Child Page',
      }));
    });

    it('should call callback for each page when fetching all accessible pages', async () => {
      // Mock search results
      const mockPage1 = {
        id: 'page-1',
        object: 'page',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Page 1' }],
          },
        },
        url: 'https://notion.so/page1',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      };

      const mockPage2 = {
        id: 'page-2',
        object: 'page',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Page 2' }],
          },
        },
        url: 'https://notion.so/page2',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      };

      mockSearch.mockResolvedValueOnce({
        results: [mockPage1, mockPage2],
        has_more: false,
      });

      mockRetrieve
        .mockResolvedValueOnce(mockPage1)
        .mockResolvedValueOnce(mockPage2);

      mockListChildren.mockResolvedValue({
        results: [],
        has_more: false,
      });

      // Track callback invocations
      const callbackMock = jest.fn<(page: NotionPage) => Promise<void>>();
      callbackMock.mockResolvedValue(undefined);

      await fetchAllPages(mockClient, undefined, callbackMock);

      // Verify callback was called for both pages
      expect(callbackMock).toHaveBeenCalledTimes(2);
      expect(callbackMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
        id: 'page-1',
        title: 'Page 1',
      }));
      expect(callbackMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
        id: 'page-2',
        title: 'Page 2',
      }));
    });

    it('should work without callback (backward compatibility)', async () => {
      const mockPage = {
        id: 'page-id',
        object: 'page',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'Test Page' }],
          },
        },
        url: 'https://notion.so/test',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-01T00:00:00.000Z',
        parent: { type: 'workspace', workspace: true },
      };

      mockRetrieve.mockResolvedValue(mockPage);
      mockListChildren.mockResolvedValue({
        results: [],
        has_more: false,
      });

      // Call without callback
      const pages = await fetchAllPages(mockClient, 'page-id');

      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        id: 'page-id',
        title: 'Test Page',
      });
    });
  });

  describe('fetchPageContent - child_page block handling', () => {
    let mockClient: Client;
    let mockListChildren: any;

    beforeEach(() => {
      mockListChildren = jest.fn();
      mockClient = {
        blocks: {
          children: {
            list: mockListChildren,
          },
        },
      } as any;
    });

    it('should NOT recursively fetch content for child_page blocks', async () => {
      // Mock response with a child_page block that has children
      mockListChildren.mockResolvedValueOnce({
        results: [
          {
            id: 'heading-block-id',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ plain_text: 'Test Heading' }],
            },
            has_children: false,
          },
          {
            id: 'child-page-block-id',
            type: 'child_page',
            child_page: {
              title: 'Child Page',
            },
            has_children: true, // Child pages can have children
          },
          {
            id: 'paragraph-block-id',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ plain_text: 'Test paragraph' }],
            },
            has_children: false,
          },
        ],
        has_more: false,
      });

      const content = await fetchPageContent(mockClient, 'test-page-id');

      // Verify we got 3 blocks
      expect(content).toHaveLength(3);

      // Verify child_page block exists but has NO children
      const childPageBlock = content.find(b => b.type === 'child_page');
      expect(childPageBlock).toBeDefined();
      expect(childPageBlock?.hasChildren).toBe(true); // Original hasChildren flag is preserved
      expect(childPageBlock?.children).toBeUndefined(); // But children were NOT fetched

      // Verify blocks.children.list was called only ONCE (not recursively for child_page)
      expect(mockListChildren).toHaveBeenCalledTimes(1);
      expect(mockListChildren).toHaveBeenCalledWith({
        block_id: 'test-page-id',
        start_cursor: undefined,
        page_size: 100,
      });
    });

    it('should recursively fetch content for non-child_page blocks with children', async () => {
      // Mock responses for a toggle block with nested content
      mockListChildren
        .mockResolvedValueOnce({
          results: [
            {
              id: 'toggle-block-id',
              type: 'toggle',
              toggle: {
                rich_text: [{ plain_text: 'Toggle heading' }],
              },
              has_children: true,
            },
          ],
          has_more: false,
        })
        .mockResolvedValueOnce({
          // Nested content inside toggle
          results: [
            {
              id: 'nested-paragraph-id',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ plain_text: 'Nested content' }],
              },
              has_children: false,
            },
          ],
          has_more: false,
        });

      const content = await fetchPageContent(mockClient, 'test-page-id');

      // Verify we got the toggle block with its children
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('toggle');
      expect(content[0].children).toBeDefined();
      expect(content[0].children).toHaveLength(1);
      expect(content[0].children![0].type).toBe('paragraph');

      // Verify blocks.children.list was called TWICE (once for page, once for toggle)
      expect(mockListChildren).toHaveBeenCalledTimes(2);
      expect(mockListChildren).toHaveBeenNthCalledWith(1, {
        block_id: 'test-page-id',
        start_cursor: undefined,
        page_size: 100,
      });
      expect(mockListChildren).toHaveBeenNthCalledWith(2, {
        block_id: 'toggle-block-id',
        start_cursor: undefined,
        page_size: 100,
      });
    });

    it('should handle mixed content with child_page and nested blocks correctly', async () => {
      // Mock a page with both child_page blocks and blocks with nested content
      mockListChildren
        .mockResolvedValueOnce({
          results: [
            {
              id: 'child-page-1',
              type: 'child_page',
              child_page: { title: 'Child Page 1' },
              has_children: true,
            },
            {
              id: 'toggle-block',
              type: 'toggle',
              toggle: {
                rich_text: [{ plain_text: 'Toggle' }],
              },
              has_children: true,
            },
            {
              id: 'child-page-2',
              type: 'child_page',
              child_page: { title: 'Child Page 2' },
              has_children: true,
            },
          ],
          has_more: false,
        })
        .mockResolvedValueOnce({
          // Nested content for toggle only
          results: [
            {
              id: 'nested-para',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ plain_text: 'In toggle' }],
              },
              has_children: false,
            },
          ],
          has_more: false,
        });

      const content = await fetchPageContent(mockClient, 'test-page-id');

      expect(content).toHaveLength(3);

      // Child pages should have NO children
      const childPage1 = content.find(b => b.id === 'child-page-1');
      const childPage2 = content.find(b => b.id === 'child-page-2');
      expect(childPage1?.children).toBeUndefined();
      expect(childPage2?.children).toBeUndefined();

      // Toggle should have children
      const toggle = content.find(b => b.id === 'toggle-block');
      expect(toggle?.children).toHaveLength(1);
      expect(toggle?.children![0].type).toBe('paragraph');

      // Should have called list twice: once for page, once for toggle (NOT for child_pages)
      expect(mockListChildren).toHaveBeenCalledTimes(2);
    });

    it('should handle pagination correctly when fetching blocks', async () => {
      // Mock paginated response
      mockListChildren
        .mockResolvedValueOnce({
          results: [
            {
              id: 'block-1',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ plain_text: 'First page' }],
              },
              has_children: false,
            },
          ],
          has_more: true,
          next_cursor: 'cursor-123',
        })
        .mockResolvedValueOnce({
          results: [
            {
              id: 'block-2',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ plain_text: 'Second page' }],
              },
              has_children: false,
            },
          ],
          has_more: false,
        });

      const content = await fetchPageContent(mockClient, 'test-page-id');

      expect(content).toHaveLength(2);
      expect(mockListChildren).toHaveBeenCalledTimes(2);

      // First call without cursor
      expect(mockListChildren).toHaveBeenNthCalledWith(1, {
        block_id: 'test-page-id',
        start_cursor: undefined,
        page_size: 100,
      });

      // Second call with cursor
      expect(mockListChildren).toHaveBeenNthCalledWith(2, {
        block_id: 'test-page-id',
        start_cursor: 'cursor-123',
        page_size: 100,
      });
    });
  });
});
