import { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { logger } from '../utils/logger.js';
import type { NotionPage, NotionBlock, NotionPageMetadata } from './types.js';

/**
 * Validates that a Notion page exists and is accessible
 * @returns true if page exists and is accessible, false otherwise
 */
export async function validateRootPage(
  client: Client,
  pageId: string
): Promise<boolean> {
  try {
    logger.debug(`Validating root page: ${pageId}`);
    const page = await client.pages.retrieve({ page_id: pageId });

    if (!isFullPage(page)) {
      logger.error(`Page ${pageId} exists but is not accessible to your integration`);
      return false;
    }

    const title = extractPageTitle(page);
    logger.success(`Root page validated: "${title}" (${pageId})`);
    return true;
  } catch (error: any) {
    if (error?.code === 'object_not_found') {
      logger.error(`Page ${pageId} does not exist`);
    } else if (error?.code === 'unauthorized') {
      logger.error(`Page ${pageId} exists but your integration does not have access to it`);
    } else {
      logger.error(`Failed to validate page ${pageId}`, error);
    }
    return false;
  }
}

/**
 * Callback function that processes each page as it's fetched
 */
export type PageCallback = (page: NotionPage) => Promise<void>;

/**
 * PHASE 1: Scans Notion workspace structure (metadata only, no content)
 * This is much faster than fetching full pages and provides the complete hierarchy
 *
 * @param client - Notion API client
 * @param rootPageId - Optional root page ID to scan from
 * @returns Array of page metadata with hierarchy information
 */
export async function scanNotionStructure(
  client: Client,
  rootPageId?: string
): Promise<NotionPageMetadata[]> {
  const metadata: NotionPageMetadata[] = [];
  const processedIds = new Set<string>();

  if (rootPageId) {
    logger.info(`Scanning structure from root page: ${rootPageId}`);
    await scanPageRecursive(client, rootPageId, metadata, processedIds);
  } else {
    logger.info('Scanning all accessible pages from workspace');
    await scanAllAccessiblePages(client, metadata, processedIds);
  }

  logger.success(`Scanned ${metadata.length} pages from Notion`);
  return metadata;
}

/**
 * Scans all accessible pages for metadata only
 */
async function scanAllAccessiblePages(
  client: Client,
  metadata: NotionPageMetadata[],
  processedIds: Set<string>
): Promise<void> {
  // First, scan for all databases to understand the structure
  const databaseMap = new Map<string, { id: string; title: string; parentId: string | null }>();

  logger.debug('Scanning databases...');
  let hasMore = true;
  let startCursor: string | undefined;

  // Scan databases
  while (hasMore) {
    const response = await client.search({
      filter: { property: 'object', value: 'database' },
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const result of response.results) {
      if ('object' in result && result.object === 'database' && 'parent' in result) {
        const db = result as any;
        let dbParentId: string | null = null;

        if (db.parent) {
          if (db.parent.type === 'page_id') {
            dbParentId = db.parent.page_id;
          } else if (db.parent.type === 'database_id') {
            dbParentId = db.parent.database_id;
          }
        }

        // Extract database title
        let dbTitle = 'Untitled Database';
        if (db.title && Array.isArray(db.title)) {
          dbTitle = db.title.map((t: any) => t.plain_text || '').join('') || 'Untitled Database';
        }

        databaseMap.set(db.id, {
          id: db.id,
          title: dbTitle,
          parentId: dbParentId,
        });

        logger.debug(`Found database: ${dbTitle} (parent: ${dbParentId || 'workspace'})`);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor || undefined;
  }

  // Now scan pages
  logger.debug('Scanning pages...');
  hasMore = true;
  startCursor = undefined;

  while (hasMore) {
    const response = await client.search({
      filter: { property: 'object', value: 'page' },
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const result of response.results) {
      if ('object' in result && result.object === 'page' && isFullPage(result) && !processedIds.has(result.id)) {
        const pageMeta = extractPageMetadata(result);

        // If this page's parent is a database, resolve to the database's parent
        if (pageMeta.parentId && databaseMap.has(pageMeta.parentId)) {
          const database = databaseMap.get(pageMeta.parentId)!;
          logger.debug(`Page "${pageMeta.title}" is in database "${database.title}", parent will be: ${database.parentId || 'workspace'}`);
          // Set parent to the database's parent (so pages go where the database is)
          pageMeta.parentId = database.parentId;
        }

        metadata.push(pageMeta);
        processedIds.add(result.id);
        logger.progress(metadata.length, metadata.length, `Scanned: ${pageMeta.title}`);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor || undefined;
  }
}

/**
 * Recursively scans a page and its children for metadata only
 */
async function scanPageRecursive(
  client: Client,
  pageId: string,
  metadata: NotionPageMetadata[],
  processedIds: Set<string>
): Promise<void> {
  if (processedIds.has(pageId)) {
    return;
  }

  try {
    const page = await client.pages.retrieve({ page_id: pageId });

    if (!isFullPage(page)) {
      logger.warn(`Page ${pageId} is not accessible`);
      return;
    }

    const pageMeta = extractPageMetadata(page);
    metadata.push(pageMeta);
    processedIds.add(pageId);
    logger.progress(metadata.length, metadata.length, `Scanned: ${pageMeta.title}`);

    // Find child pages by fetching blocks (lightweight - just IDs)
    const childPageIds = await findChildPageIdsLight(client, pageId);
    for (const childId of childPageIds) {
      await scanPageRecursive(client, childId, metadata, processedIds);
    }
  } catch (error) {
    logger.error(`Failed to scan page ${pageId}`, error);
  }
}

/**
 * Finds child page IDs without fetching full content
 */
async function findChildPageIdsLight(
  client: Client,
  blockId: string
): Promise<string[]> {
  const childIds: string[] = [];
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
          // Check if it's a child_page block
          if (block.type === 'child_page') {
            childIds.push(block.id);
          }

          // Recursively check children if they exist
          if (block.has_children) {
            const nestedChildren = await findChildPageIdsLight(client, block.id);
            childIds.push(...nestedChildren);
          }
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    }
  } catch (error) {
    logger.debug(`Error finding child pages in ${blockId}`, error);
  }

  return childIds;
}

/**
 * Extracts metadata from a Notion page (without fetching content)
 */
function extractPageMetadata(page: PageObjectResponse): NotionPageMetadata {
  return {
    id: page.id,
    title: extractPageTitle(page),
    parentId: extractParentId(page),
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    icon: extractIcon(page),
    cover: extractCover(page),
  };
}

/**
 * Fetches all accessible pages from Notion workspace
 * If onPageFetched callback is provided, pages are processed immediately
 * Otherwise, all pages are collected and returned
 */
export async function fetchAllPages(
  client: Client,
  rootPageId?: string,
  onPageFetched?: PageCallback
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  const processedIds = new Set<string>();

  if (rootPageId) {
    logger.info(`Fetching from root page: ${rootPageId}`);
    await fetchPageRecursive(client, rootPageId, pages, processedIds, onPageFetched);
  } else {
    logger.info('Fetching all accessible pages from workspace');
    await fetchAllAccessiblePages(client, pages, processedIds, onPageFetched);
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
  processedIds: Set<string>,
  onPageFetched?: PageCallback
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

          // Process page immediately if callback provided
          if (onPageFetched) {
            await onPageFetched(page);
          }
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
  processedIds: Set<string>,
  onPageFetched?: PageCallback
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

  // Process page immediately if callback provided
  if (onPageFetched) {
    await onPageFetched(page);
  }

  // Find child pages in the content blocks
  const childPageIds = findChildPageIds(page.content);
  for (const childId of childPageIds) {
    await fetchPageRecursive(client, childId, pages, processedIds, onPageFetched);
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
 * PHASE 3: Fetches content for a page (when metadata is already known)
 * This is used after the hierarchy has been created in Trilium
 *
 * @param client - Notion API client
 * @param pageId - The page ID to fetch content for
 * @returns Array of content blocks
 */
export async function fetchPageContent(
  client: Client,
  pageId: string
): Promise<NotionBlock[]> {
  try {
    return await fetchBlocks(client, pageId);
  } catch (error) {
    logger.error(`Failed to fetch content for page ${pageId}`, error);
    return [];
  }
}

/**
 * Fetches all blocks (content) for a page or block with timeout and retry logic
 */
async function fetchBlocks(
  client: Client,
  blockId: string,
  depth: number = 0,
  maxDepth: number = 20
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  // Prevent infinite recursion
  if (depth > maxDepth) {
    logger.warn(`Max depth ${maxDepth} reached for block ${blockId}, stopping recursion`);
    return blocks;
  }

  try {
    while (hasMore) {
      // Fetch with timeout and retry logic
      const response = await fetchWithRetry(async () => {
        return await client.blocks.children.list({
          block_id: blockId,
          start_cursor: startCursor,
          page_size: 100,
        });
      }, `blocks for ${blockId}`);

      for (const block of response.results) {
        if (isFullBlock(block)) {
          const notionBlock: NotionBlock = {
            id: block.id,
            type: block.type,
            content: (block as any)[block.type],
            hasChildren: block.has_children,
          };

          // Recursively fetch children if they exist
          // BUT: Skip child_page blocks - they are separate pages that will be imported independently
          if (block.has_children && block.type !== 'child_page') {
            notionBlock.children = await fetchBlocks(client, block.id, depth + 1, maxDepth);
          }

          blocks.push(notionBlock);
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    }
  } catch (error: any) {
    // Log but don't throw - return partial results
    if (error.message?.includes('timeout')) {
      logger.error(`Timeout fetching blocks for ${blockId} at depth ${depth} - returning partial results`);
    } else {
      logger.error(`Failed to fetch blocks for ${blockId} at depth ${depth}`, error);
    }
  }

  return blocks;
}

/**
 * Fetches with timeout and retry logic for rate limits
 */
async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  description: string,
  maxRetries: number = 3,
  timeoutMs: number = 30000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms fetching ${description}`)), timeoutMs);
      });

      // Race between fetch and timeout
      const result = await Promise.race([fetchFn(), timeoutPromise]);
      return result;
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error (status 429)
      if (error?.status === 429 || error?.code === 'rate_limited') {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
        logger.warn(`Rate limited fetching ${description}, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // Check if it's a timeout
      if (error?.message?.includes('Timeout')) {
        if (attempt < maxRetries) {
          logger.warn(`Timeout fetching ${description}, retry ${attempt + 1}/${maxRetries}`);
          continue;
        }
      }

      // For other errors, don't retry
      throw error;
    }
  }

  throw lastError || new Error(`Failed to fetch ${description} after ${maxRetries} retries`);
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
