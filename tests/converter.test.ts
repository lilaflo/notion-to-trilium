import { describe, it, expect } from '@jest/globals';
import { convertPageToHtml } from '../src/notion/converter.js';
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
});
