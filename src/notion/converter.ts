import type { NotionBlock, NotionPage } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Converts a Notion page to HTML format suitable for Trilium
 */
export function convertPageToHtml(page: NotionPage): string {
  logger.debug(`Converting page to HTML: ${page.title}`);

  const contentHtml = convertBlocksToHtml(page.content);

  // Wrap in a basic HTML structure
  return `<div class="notion-page">
${contentHtml}
</div>`;
}

/**
 * Converts Notion blocks to HTML
 */
function convertBlocksToHtml(blocks: NotionBlock[], indent: number = 0): string {
  return blocks.map(block => convertBlockToHtml(block, indent)).join('\n');
}

/**
 * Converts a single Notion block to HTML
 */
function convertBlockToHtml(block: NotionBlock, indent: number = 0): string {
  const indentStr = '  '.repeat(indent);

  try {
    switch (block.type) {
      case 'paragraph':
        return `${indentStr}${convertParagraph(block)}`;

      case 'heading_1':
        return `${indentStr}${convertHeading(block, 1)}`;

      case 'heading_2':
        return `${indentStr}${convertHeading(block, 2)}`;

      case 'heading_3':
        return `${indentStr}${convertHeading(block, 3)}`;

      case 'bulleted_list_item':
        return `${indentStr}${convertBulletedListItem(block, indent)}`;

      case 'numbered_list_item':
        return `${indentStr}${convertNumberedListItem(block, indent)}`;

      case 'to_do':
        return `${indentStr}${convertToDo(block)}`;

      case 'toggle':
        return `${indentStr}${convertToggle(block, indent)}`;

      case 'code':
        return `${indentStr}${convertCode(block)}`;

      case 'quote':
        return `${indentStr}${convertQuote(block)}`;

      case 'callout':
        return `${indentStr}${convertCallout(block)}`;

      case 'divider':
        return `${indentStr}<hr />`;

      case 'table_of_contents':
        return `${indentStr}<p><em>[Table of Contents]</em></p>`;

      case 'image':
        return `${indentStr}${convertImage(block)}`;

      case 'video':
        return `${indentStr}${convertVideo(block)}`;

      case 'file':
        return `${indentStr}${convertFile(block)}`;

      case 'bookmark':
        return `${indentStr}${convertBookmark(block)}`;

      case 'embed':
        return `${indentStr}${convertEmbed(block)}`;

      case 'equation':
        return `${indentStr}${convertEquation(block)}`;

      case 'child_page':
        return `${indentStr}${convertChildPage(block)}`;

      case 'child_database':
        return `${indentStr}<p><em>[Child Database: ${block.id}]</em></p>`;

      case 'table':
        return `${indentStr}${convertTable(block)}`;

      case 'column_list':
      case 'column':
        return convertBlocksToHtml(block.children || [], indent);

      case 'synced_block':
        return convertBlocksToHtml(block.children || [], indent);

      default:
        logger.warn(`Unknown block type: ${block.type}`);
        return `${indentStr}<p><em>[Unsupported block type: ${block.type}]</em></p>`;
    }
  } catch (error) {
    logger.error(`Error converting block ${block.id} of type ${block.type}`, error);
    return `${indentStr}<p><em>[Error converting block]</em></p>`;
  }
}

/**
 * Extracts and converts rich text to HTML
 */
function convertRichText(richTextArray: any[]): string {
  if (!Array.isArray(richTextArray)) {
    return '';
  }

  return richTextArray
    .map((text) => {
      if (!text.plain_text) return '';

      let html = escapeHtml(text.plain_text);

      // Apply formatting
      if (text.annotations) {
        if (text.annotations.bold) html = `<strong>${html}</strong>`;
        if (text.annotations.italic) html = `<em>${html}</em>`;
        if (text.annotations.strikethrough) html = `<s>${html}</s>`;
        if (text.annotations.underline) html = `<u>${html}</u>`;
        if (text.annotations.code) html = `<code>${html}</code>`;
      }

      // Add link
      if (text.href) {
        html = `<a href="${escapeHtml(text.href)}">${html}</a>`;
      }

      return html;
    })
    .join('');
}

function convertParagraph(block: NotionBlock): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || []);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, 1) : '';
  return text ? `<p>${text}</p>${children}` : children;
}

function convertHeading(block: NotionBlock, level: number): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || []);
  return `<h${level}>${text}</h${level}>`;
}

function convertBulletedListItem(block: NotionBlock, indent: number): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || []);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, indent + 1) : '';
  return `<ul>\n  <li>${text}${children}</li>\n</ul>`;
}

function convertNumberedListItem(block: NotionBlock, indent: number): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || []);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, indent + 1) : '';
  return `<ol>\n  <li>${text}${children}</li>\n</ol>`;
}

function convertToDo(block: NotionBlock): string {
  const content = block.content as any;
  const checked = content.checked ? 'checked' : '';
  const text = convertRichText(content.rich_text || []);
  return `<p><input type="checkbox" ${checked} disabled /> ${text}</p>`;
}

function convertToggle(block: NotionBlock, indent: number): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || []);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, indent + 1) : '';
  return `<details>\n  <summary>${text}</summary>\n${children}\n</details>`;
}

function convertCode(block: NotionBlock): string {
  const content = block.content as any;
  const code = content.rich_text?.map((t: any) => t.plain_text).join('') || '';
  const language = content.language || 'plaintext';
  return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
}

function convertQuote(block: NotionBlock): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || []);
  return `<blockquote>${text}</blockquote>`;
}

function convertCallout(block: NotionBlock): string {
  const content = block.content as any;
  const icon = content.icon?.emoji || '💡';
  const text = convertRichText(content.rich_text || []);
  return `<div class="callout"><span class="icon">${icon}</span> ${text}</div>`;
}

function convertImage(block: NotionBlock): string {
  const content = block.content as any;
  const url = content.file?.url || content.external?.url || '';
  const caption = convertRichText(content.caption || []);

  if (!url) return '<p><em>[Image not available]</em></p>';

  return caption
    ? `<figure><img src="${escapeHtml(url)}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`
    : `<img src="${escapeHtml(url)}" alt="image" />`;
}

function convertVideo(block: NotionBlock): string {
  const content = block.content as any;
  const url = content.file?.url || content.external?.url || '';

  if (!url) return '<p><em>[Video not available]</em></p>';

  return `<video controls src="${escapeHtml(url)}"></video>`;
}

function convertFile(block: NotionBlock): string {
  const content = block.content as any;
  const url = content.file?.url || content.external?.url || '';
  const caption = convertRichText(content.caption || []) || 'Download file';

  if (!url) return '<p><em>[File not available]</em></p>';

  return `<p><a href="${escapeHtml(url)}">${caption}</a></p>`;
}

function convertBookmark(block: NotionBlock): string {
  const content = block.content as any;
  const url = content.url || '';
  const caption = convertRichText(content.caption || []) || url;

  return `<p><a href="${escapeHtml(url)}">${caption}</a></p>`;
}

function convertEmbed(block: NotionBlock): string {
  const content = block.content as any;
  const url = content.url || '';

  return `<p><a href="${escapeHtml(url)}">🔗 ${escapeHtml(url)}</a></p>`;
}

function convertEquation(block: NotionBlock): string {
  const content = block.content as any;
  const expression = content.expression || '';

  return `<p><code>${escapeHtml(expression)}</code></p>`;
}

function convertChildPage(block: NotionBlock): string {
  const content = block.content as any;
  const title = content.title || 'Untitled Page';

  return `<p><strong>→ ${escapeHtml(title)}</strong></p>`;
}

function convertTable(block: NotionBlock): string {
  if (!block.children || block.children.length === 0) {
    return '<p><em>[Empty table]</em></p>';
  }

  const rows = block.children.map(row => {
    const content = row.content as any;
    const cells = content.cells || [];
    const cellsHtml = cells
      .map((cell: any[]) => `<td>${convertRichText(cell)}</td>`)
      .join('');
    return `<tr>${cellsHtml}</tr>`;
  }).join('\n');

  return `<table>\n${rows}\n</table>`;
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
