import { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { logger } from '../utils/logger.js';
import type { NotionPage, NotionBlock } from './types.js';

/**
 * Fetches all accessible pages from Notion workspace
 */
export async function fetchAllPages(
  client: Client,
  rootPageId?: string
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  const processedIds = new Set<string>();

  if (rootPageId) {
    logger.info(`Fetching from root page: ${rootPageId}`);
    await fetchPageRecursive(client, rootPageId, pages, processedIds);
  } else {
    logger.info('Fetching all accessible pages from workspace');
    await fetchAllAccessiblePages(client, pages, processedIds);
  }

  logger.success(`Fetched ${pages.length} pages from Notion`);
  return pages;
}

/**
 * Fetches all pages accessible to the integration
 */
async function fetchAllAccessiblePages(
  client: Client,
  pages: NotionPage[],
  processedIds: Set<string>
): Promise<void> {
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await client.search({
      filter: { property: 'object', value: 'page' },
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const result of response.results) {
      // Filter out databases, only process pages
      if ('object' in result && result.object === 'page' && isFullPage(result) && !processedIds.has(result.id)) {
        logger.debug(`Processing page: ${result.id}`);
        const page = await fetchPage(client, result.id);
        if (page) {
          pages.push(page);
          processedIds.add(result.id);
          logger.progress(pages.length, pages.length, `Fetched: ${page.title}`);
        }
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor || undefined;
  }
}

/**
 * Recursively fetches a page and all its child pages
 */
async function fetchPageRecursive(
  client: Client,
  pageId: string,
  pages: NotionPage[],
  processedIds: Set<string>
): Promise<void> {
  if (processedIds.has(pageId)) {
    return;
  }

  const page = await fetchPage(client, pageId);
  if (!page) {
    return;
  }

  pages.push(page);
  processedIds.add(pageId);
  logger.progress(pages.length, pages.length, `Fetched: ${page.title}`);

  // Find child pages in the content blocks
  const childPageIds = findChildPageIds(page.content);
  for (const childId of childPageIds) {
    await fetchPageRecursive(client, childId, pages, processedIds);
  }
}

/**
 * Fetches a single page with its content blocks
 */
export async function fetchPage(
  client: Client,
  pageId: string
): Promise<NotionPage | null> {
  try {
    const page = await client.pages.retrieve({ page_id: pageId });

    if (!isFullPage(page)) {
      logger.warn(`Page ${pageId} is not accessible`);
      return null;
    }

    const title = extractPageTitle(page);
    const content = await fetchBlocks(client, pageId);

    return {
      id: page.id,
      title,
      content,
      parentId: extractParentId(page),
      url: page.url,
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
      icon: extractIcon(page),
      cover: extractCover(page),
    };
  } catch (error) {
    logger.error(`Failed to fetch page ${pageId}`, error);
    return null;
  }
}

/**
 * Fetches all blocks (content) for a page or block
 */
async function fetchBlocks(
  client: Client,
  blockId: string
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  try {
    while (hasMore) {
      const response = await client.blocks.children.list({
        block_id: blockId,
        start_cursor: startCursor,
        page_size: 100,
      });

      for (const block of response.results) {
        if (isFullBlock(block)) {
          const notionBlock: NotionBlock = {
            id: block.id,
            type: block.type,
            content: (block as any)[block.type],
            hasChildren: block.has_children,
          };

          // Recursively fetch children if they exist
          if (block.has_children) {
            notionBlock.children = await fetchBlocks(client, block.id);
          }

          blocks.push(notionBlock);
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    }
  } catch (error) {
    logger.error(`Failed to fetch blocks for ${blockId}`, error);
  }

  return blocks;
}

/**
 * Extracts the title from a Notion page
 */
function extractPageTitle(page: PageObjectResponse): string {
  const properties = page.properties;

  // Try to find title property
  for (const prop of Object.values(properties)) {
    if (prop.type === 'title' && 'title' in prop) {
      const titleText = prop.title
        .map((t) => ('plain_text' in t ? t.plain_text : ''))
        .join('');
      return titleText || 'Untitled';
    }
  }

  return 'Untitled';
}

/**
 * Extracts parent ID from a page
 */
function extractParentId(page: PageObjectResponse): string | null {
  const parent = page.parent;
  if (parent.type === 'page_id') {
    return parent.page_id;
  } else if (parent.type === 'database_id') {
    return parent.database_id;
  }
  return null;
}

/**
 * Extracts icon from a page
 */
function extractIcon(page: PageObjectResponse): string | undefined {
  if (page.icon?.type === 'emoji') {
    return page.icon.emoji;
  } else if (page.icon?.type === 'external') {
    return page.icon.external.url;
  } else if (page.icon?.type === 'file') {
    return page.icon.file.url;
  }
  return undefined;
}

/**
 * Extracts cover image from a page
 */
function extractCover(page: PageObjectResponse): string | undefined {
  if (page.cover?.type === 'external') {
    return page.cover.external.url;
  } else if (page.cover?.type === 'file') {
    return page.cover.file.url;
  }
  return undefined;
}

/**
 * Finds child page IDs in blocks
 */
function findChildPageIds(blocks: NotionBlock[]): string[] {
  const childIds: string[] = [];

  for (const block of blocks) {
    if (block.type === 'child_page' && typeof block.content === 'object' && block.content !== null) {
      const content = block.content as any;
      if (content.id) {
        childIds.push(content.id);
      }
    }

    if (block.children) {
      childIds.push(...findChildPageIds(block.children));
    }
  }

  return childIds;
}

/**
 * Type guard for full page objects
 */
function isFullPage(
  page: PageObjectResponse | PartialPageObjectResponse
): page is PageObjectResponse {
  return 'properties' in page;
}

/**
 * Type guard for full block objects
 */
function isFullBlock(
  block: BlockObjectResponse | PartialBlockObjectResponse
): block is BlockObjectResponse {
  return 'type' in block;
}
