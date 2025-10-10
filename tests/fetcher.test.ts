import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { validateRootPage } from '../src/notion/fetcher.js';
import type { Client } from '@notionhq/client';

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
});
