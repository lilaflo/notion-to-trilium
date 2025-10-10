import type { NotionBlock, NotionPage } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Type for mapping Notion page IDs to Trilium note IDs
 */
export type PageMapping = Map<string, string>;

/**
 * Converts a Notion page to HTML format suitable for Trilium
 * @param page - The Notion page to convert
 * @param pageMapping - Optional mapping of Notion IDs to Trilium note IDs for internal links
 */
export function convertPageToHtml(page: NotionPage, pageMapping?: PageMapping): string {
  logger.debug(`Converting page to HTML: ${page.title}`);

  const contentHtml = convertBlocksToHtml(page.content, 0, pageMapping);

  // Wrap in a basic HTML structure
  return `<div class="notion-page">
${contentHtml}
</div>`;
}

/**
 * Converts Notion blocks to HTML
 */
function convertBlocksToHtml(blocks: NotionBlock[], indent: number = 0, pageMapping?: PageMapping): string {
  return blocks.map(block => convertBlockToHtml(block, indent, pageMapping)).join('\n');
}

/**
 * Converts a single Notion block to HTML
 */
function convertBlockToHtml(block: NotionBlock, indent: number = 0, pageMapping?: PageMapping): string {
  const indentStr = '  '.repeat(indent);

  try {
    switch (block.type) {
      case 'paragraph':
        return `${indentStr}${convertParagraph(block, pageMapping)}`;

      case 'heading_1':
        return `${indentStr}${convertHeading(block, 1, pageMapping)}`;

      case 'heading_2':
        return `${indentStr}${convertHeading(block, 2, pageMapping)}`;

      case 'heading_3':
        return `${indentStr}${convertHeading(block, 3, pageMapping)}`;

      case 'bulleted_list_item':
        return `${indentStr}${convertBulletedListItem(block, indent, pageMapping)}`;

      case 'numbered_list_item':
        return `${indentStr}${convertNumberedListItem(block, indent, pageMapping)}`;

      case 'to_do':
        return `${indentStr}${convertToDo(block, pageMapping)}`;

      case 'toggle':
        return `${indentStr}${convertToggle(block, indent, pageMapping)}`;

      case 'code':
        return `${indentStr}${convertCode(block)}`;

      case 'quote':
        return `${indentStr}${convertQuote(block, pageMapping)}`;

      case 'callout':
        return `${indentStr}${convertCallout(block, pageMapping)}`;

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
        return `${indentStr}${convertChildPage(block, pageMapping)}`;

      case 'child_database':
        return `${indentStr}<p><em>[Child Database: ${block.id}]</em></p>`;

      case 'table':
        return `${indentStr}${convertTable(block, pageMapping)}`;

      case 'column_list':
      case 'column':
        return convertBlocksToHtml(block.children || [], indent, pageMapping);

      case 'synced_block':
        return convertBlocksToHtml(block.children || [], indent, pageMapping);

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
function convertRichText(richTextArray: any[], pageMapping?: PageMapping): string {
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

      // Add link - convert Notion internal links to Trilium format
      if (text.href) {
        const resolvedHref = resolveInternalLink(text.href, pageMapping);
        html = `<a href="${escapeHtml(resolvedHref)}">${html}</a>`;
      }

      return html;
    })
    .join('');
}

/**
 * Resolves internal Notion links to Trilium internal link format
 * Notion links: https://www.notion.so/{title}-{pageId} or notion://{pageId}
 * Trilium links: #!{noteId}
 */
function resolveInternalLink(href: string, pageMapping?: PageMapping): string {
  if (!pageMapping) {
    return href; // No mapping available, keep original link
  }

  try {
    // Extract Notion page ID from different URL formats
    let notionPageId: string | null = null;

    // Format 1: https://www.notion.so/{workspace}/{title}-{pageId}
    // Format 2: https://www.notion.so/{title}-{pageId}
    // Page ID is the last 32 hex characters in the URL
    const notionUrlMatch = href.match(/notion\.so\/(?:[^\/]+\/)?.*?([a-f0-9]{32})(?:[?#]|$)/i);
    if (notionUrlMatch) {
      notionPageId = notionUrlMatch[1];
    }

    // Format 3: notion://{pageId}
    if (!notionPageId && href.startsWith('notion://')) {
      notionPageId = href.replace('notion://', '').replace(/[?#].*$/, '');
    }

    // Format 4: Page ID with dashes (8-4-4-4-12 format)
    if (!notionPageId) {
      const dashFormatMatch = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      if (dashFormatMatch) {
        notionPageId = dashFormatMatch[1].replace(/-/g, '');
      }
    }

    if (notionPageId) {
      // Normalize to remove dashes if present
      notionPageId = notionPageId.replace(/-/g, '');

      // Try to find in mapping with both dash and no-dash formats
      const triliumNoteId = pageMapping.get(notionPageId) ||
                           pageMapping.get(formatNotionId(notionPageId));

      if (triliumNoteId) {
        logger.debug(`Resolved internal link: ${href} -> #!${triliumNoteId}`);
        return `#!${triliumNoteId}`;
      } else {
        logger.debug(`Internal link not in mapping: ${href} (Notion ID: ${notionPageId})`);
      }
    }
  } catch (error) {
    logger.debug(`Error resolving internal link: ${href}`, error);
  }

  // If we couldn't resolve it, keep the original link
  return href;
}

/**
 * Formats a Notion ID to the standard 8-4-4-4-12 format with dashes
 */
function formatNotionId(id: string): string {
  // Remove any existing dashes
  const clean = id.replace(/-/g, '');

  // Add dashes in the standard UUID format
  if (clean.length === 32) {
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
  }

  return id;
}

function convertParagraph(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || [], pageMapping);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, 1, pageMapping) : '';
  return text ? `<p>${text}</p>${children}` : children;
}

function convertHeading(block: NotionBlock, level: number, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || [], pageMapping);
  return `<h${level}>${text}</h${level}>`;
}

function convertBulletedListItem(block: NotionBlock, indent: number, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || [], pageMapping);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, indent + 1, pageMapping) : '';
  return `<ul>\n  <li>${text}${children}</li>\n</ul>`;
}

function convertNumberedListItem(block: NotionBlock, indent: number, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || [], pageMapping);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, indent + 1, pageMapping) : '';
  return `<ol>\n  <li>${text}${children}</li>\n</ol>`;
}

function convertToDo(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const checked = content.checked ? 'checked' : '';
  const text = convertRichText(content.rich_text || [], pageMapping);
  return `<p><input type="checkbox" ${checked} disabled /> ${text}</p>`;
}

function convertToggle(block: NotionBlock, indent: number, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || [], pageMapping);
  const children = block.children ? '\n' + convertBlocksToHtml(block.children, indent + 1, pageMapping) : '';
  return `<details>\n  <summary>${text}</summary>\n${children}\n</details>`;
}

function convertCode(block: NotionBlock): string {
  const content = block.content as any;
  const code = content.rich_text?.map((t: any) => t.plain_text).join('') || '';
  const language = content.language || 'plaintext';
  return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
}

function convertQuote(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const text = convertRichText(content.rich_text || [], pageMapping);
  return `<blockquote>${text}</blockquote>`;
}

function convertCallout(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const icon = content.icon?.emoji || '💡';
  const text = convertRichText(content.rich_text || [], pageMapping);
  return `<div class="callout"><span class="icon">${icon}</span> ${text}</div>`;
}

function convertImage(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const url = content.file?.url || content.external?.url || '';
  const caption = convertRichText(content.caption || [], pageMapping);

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

function convertFile(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const url = content.file?.url || content.external?.url || '';
  const caption = convertRichText(content.caption || [], pageMapping) || 'Download file';

  if (!url) return '<p><em>[File not available]</em></p>';

  return `<p><a href="${escapeHtml(url)}">${caption}</a></p>`;
}

function convertBookmark(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const url = content.url || '';
  const caption = convertRichText(content.caption || [], pageMapping) || url;

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

function convertChildPage(block: NotionBlock, pageMapping?: PageMapping): string {
  const content = block.content as any;
  const title = content.title || 'Untitled Page';

  return `<p><strong>→ ${escapeHtml(title)}</strong></p>`;
}

function convertTable(block: NotionBlock, pageMapping?: PageMapping): string {
  if (!block.children || block.children.length === 0) {
    return '<p><em>[Empty table]</em></p>';
  }

  const rows = block.children.map(row => {
    const content = row.content as any;
    const cells = content.cells || [];
    const cellsHtml = cells
      .map((cell: any[]) => `<td>${convertRichText(cell, pageMapping)}</td>`)
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
