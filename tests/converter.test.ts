import { describe, it, expect } from '@jest/globals';
import { convertPageToHtml, type PageMapping } from '../src/notion/converter.js';
import type { NotionPage, NotionBlock } from '../src/notion/types.js';

describe('Notion to HTML Converter', () => {
  const createMockPage = (blocks: NotionBlock[]): NotionPage => ({
    id: 'test-page-id',
    title: 'Test Page',
    content: blocks,
    parentId: null,
    url: 'https://notion.so/test',
    createdTime: '2024-01-01T00:00:00.000Z',
    lastEditedTime: '2024-01-01T00:00:00.000Z',
  });

  it('should convert an empty page', () => {
    const page = createMockPage([]);
    const html = convertPageToHtml(page);

    expect(html).toContain('<div class="notion-page">');
    expect(html).toContain('</div>');
  });

  it('should convert a paragraph block', () => {
    const block: NotionBlock = {
      id: 'block-1',
      type: 'paragraph',
      content: {
        rich_text: [
          {
            plain_text: 'Hello World',
            annotations: {},
          },
        ],
      },
      hasChildren: false,
    };

    const page = createMockPage([block]);
    const html = convertPageToHtml(page);

    expect(html).toContain('<p>Hello World</p>');
  });

  it('should convert heading blocks', () => {
    const blocks: NotionBlock[] = [
      {
        id: 'h1',
        type: 'heading_1',
        content: { rich_text: [{ plain_text: 'Heading 1', annotations: {} }] },
        hasChildren: false,
      },
      {
        id: 'h2',
        type: 'heading_2',
        content: { rich_text: [{ plain_text: 'Heading 2', annotations: {} }] },
        hasChildren: false,
      },
    ];

    const page = createMockPage(blocks);
    const html = convertPageToHtml(page);

    expect(html).toContain('<h1>Heading 1</h1>');
    expect(html).toContain('<h2>Heading 2</h2>');
  });

  it('should convert rich text with formatting', () => {
    const block: NotionBlock = {
      id: 'block-1',
      type: 'paragraph',
      content: {
        rich_text: [
          {
            plain_text: 'Bold text',
            annotations: { bold: true },
          },
          {
            plain_text: ' and ',
            annotations: {},
          },
          {
            plain_text: 'italic text',
            annotations: { italic: true },
          },
        ],
      },
      hasChildren: false,
    };

    const page = createMockPage([block]);
    const html = convertPageToHtml(page);

    expect(html).toContain('<strong>Bold text</strong>');
    expect(html).toContain('<em>italic text</em>');
  });

  it('should convert links', () => {
    const block: NotionBlock = {
      id: 'block-1',
      type: 'paragraph',
      content: {
        rich_text: [
          {
            plain_text: 'Click here',
            annotations: {},
            href: 'https://example.com',
          },
        ],
      },
      hasChildren: false,
    };

    const page = createMockPage([block]);
    const html = convertPageToHtml(page);

    expect(html).toContain('<a href="https://example.com">Click here</a>');
  });

  it('should convert code blocks', () => {
    const block: NotionBlock = {
      id: 'block-1',
      type: 'code',
      content: {
        rich_text: [{ plain_text: 'console.log("Hello");', annotations: {} }],
        language: 'javascript',
      },
      hasChildren: false,
    };

    const page = createMockPage([block]);
    const html = convertPageToHtml(page);

    expect(html).toContain('<pre><code class="language-javascript">');
    expect(html).toContain('console.log(&quot;Hello&quot;);');
  });

  it('should escape HTML special characters', () => {
    const block: NotionBlock = {
      id: 'block-1',
      type: 'paragraph',
      content: {
        rich_text: [
          {
            plain_text: '<script>alert("xss")</script>',
            annotations: {},
          },
        ],
      },
      hasChildren: false,
    };

    const page = createMockPage([block]);
    const html = convertPageToHtml(page);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;xss&quot;');
  });

  it('should convert bulleted lists', () => {
    const block: NotionBlock = {
      id: 'block-1',
      type: 'bulleted_list_item',
      content: {
        rich_text: [{ plain_text: 'List item', annotations: {} }],
      },
      hasChildren: false,
    };

    const page = createMockPage([block]);
    const html = convertPageToHtml(page);

    expect(html).toContain('<ul>');
    expect(html).toContain('<li>List item</li>');
    expect(html).toContain('</ul>');
  });

  describe('Internal Link Resolution', () => {
    it('should keep external links unchanged', () => {
      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'External link',
              annotations: {},
              href: 'https://example.com',
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map();
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain('<a href="https://example.com">External link</a>');
    });

    it('should convert Notion internal links to Trilium format (standard URL)', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const triliumNoteId = 'trilium-note-123';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'Link to page',
              annotations: {},
              href: `https://www.notion.so/My-Page-Title-${notionPageId}`,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageId, triliumNoteId],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<a href="#!${triliumNoteId}">Link to page</a>`);
      expect(html).not.toContain('notion.so');
    });

    it('should convert Notion internal links with workspace in URL', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const triliumNoteId = 'trilium-note-456';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'Link to page',
              annotations: {},
              href: `https://www.notion.so/myworkspace/My-Page-Title-${notionPageId}`,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageId, triliumNoteId],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<a href="#!${triliumNoteId}">Link to page</a>`);
    });

    it('should convert Notion internal links with dashed page ID format', () => {
      const notionPageIdNoDash = '12b7cdd80c5c443fb923a85e34bac727';
      const notionPageIdDashed = '12b7cdd8-0c5c-443f-b923-a85e34bac727';
      const triliumNoteId = 'trilium-note-789';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'Link to page',
              annotations: {},
              href: `https://www.notion.so/Page-${notionPageIdDashed}`,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageIdNoDash, triliumNoteId],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<a href="#!${triliumNoteId}">Link to page</a>`);
    });

    it('should keep Notion links unchanged when not in mapping', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const notionUrl = `https://www.notion.so/My-Page-${notionPageId}`;

      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'Link to unmapped page',
              annotations: {},
              href: notionUrl,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        ['different-page-id-00000000000', 'some-note-id'],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<a href="${notionUrl}">Link to unmapped page</a>`);
    });

    it('should convert internal links without mapping when pageMapping not provided', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const notionUrl = `https://www.notion.so/My-Page-${notionPageId}`;

      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'Link to page',
              annotations: {},
              href: notionUrl,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const html = convertPageToHtml(page); // No pageMapping provided

      expect(html).toContain(`<a href="${notionUrl}">Link to page</a>`);
    });

    it('should resolve internal links in formatted text', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const triliumNoteId = 'trilium-note-999';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'Bold link',
              annotations: { bold: true },
              href: `https://www.notion.so/Page-${notionPageId}`,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageId, triliumNoteId],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<a href="#!${triliumNoteId}"><strong>Bold link</strong></a>`);
    });

    it('should resolve internal links in list items', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const triliumNoteId = 'trilium-note-list';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'bulleted_list_item',
        content: {
          rich_text: [
            {
              plain_text: 'List with link',
              annotations: {},
              href: `https://www.notion.so/Page-${notionPageId}`,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageId, triliumNoteId],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<a href="#!${triliumNoteId}">List with link</a>`);
    });

    it('should resolve internal links in headings', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const triliumNoteId = 'trilium-note-heading';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'heading_1',
        content: {
          rich_text: [
            {
              plain_text: 'Heading with link',
              annotations: {},
              href: `https://www.notion.so/Page-${notionPageId}`,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageId, triliumNoteId],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<h1><a href="#!${triliumNoteId}">Heading with link</a></h1>`);
    });

    it('should resolve internal links in table cells', () => {
      const notionPageId = 'abc123def45678901234567890123456';
      const triliumNoteId = 'trilium-note-table';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'table',
        content: {},
        hasChildren: true,
        children: [
          {
            id: 'row-1',
            type: 'table_row',
            content: {
              cells: [
                [
                  {
                    plain_text: 'Link in table',
                    annotations: {},
                    href: `https://www.notion.so/Page-${notionPageId}`,
                  },
                ],
              ],
            },
            hasChildren: false,
          },
        ],
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageId, triliumNoteId],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<td><a href="#!${triliumNoteId}">Link in table</a></td>`);
    });

    it('should handle multiple internal links in same block', () => {
      const notionPageId1 = 'abc123def45678901234567890123456';
      const notionPageId2 = 'def456abc12345678901234567890123';
      const triliumNoteId1 = 'trilium-note-1';
      const triliumNoteId2 = 'trilium-note-2';

      const block: NotionBlock = {
        id: 'block-1',
        type: 'paragraph',
        content: {
          rich_text: [
            {
              plain_text: 'First link',
              annotations: {},
              href: `https://www.notion.so/Page1-${notionPageId1}`,
            },
            {
              plain_text: ' and ',
              annotations: {},
            },
            {
              plain_text: 'Second link',
              annotations: {},
              href: `https://www.notion.so/Page2-${notionPageId2}`,
            },
          ],
        },
        hasChildren: false,
      };

      const page = createMockPage([block]);
      const pageMapping: PageMapping = new Map([
        [notionPageId1, triliumNoteId1],
        [notionPageId2, triliumNoteId2],
      ]);
      const html = convertPageToHtml(page, pageMapping);

      expect(html).toContain(`<a href="#!${triliumNoteId1}">First link</a>`);
      expect(html).toContain(`<a href="#!${triliumNoteId2}">Second link</a>`);
    });
  });
});
