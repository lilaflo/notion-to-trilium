import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { validateRootPage, fetchAllPages } from '../src/notion/fetcher.js';
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
});
