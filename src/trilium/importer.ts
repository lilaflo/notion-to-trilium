import type { NotionPage, NotionPageMetadata } from '../notion/types.js';
import { convertPageToHtml } from '../notion/converter.js';
import { etapiRequest, type ETAPINote, getETAPIBaseUrl, getETAPIAuthHeader } from './etapi.js';
import { logger } from '../utils/logger.js';
import type { NotionCache } from '../cache/index.js';
import fetch from 'node-fetch';

/**
 * Import statistics
 */
export interface ImportStats {
  successful: number;
  failed: number;
  skipped: number;
  total: number;
}

/**
 * Mapping of Notion page IDs to Trilium note IDs
 */
type PageMapping = Map<string, string>;

/**
 * PHASE 2: Rebuilds the Notion hierarchy in Trilium (creates empty notes with structure)
 * This ensures all parent notes exist before children are created
 *
 * @param pagesMetadata - Array of page metadata from Phase 1
 * @param rootParentNoteId - The Trilium note ID to use as the root parent
 * @param dryRun - If true, only logs what would be created
 * @param cache - Optional cache instance for storing/retrieving Trilium note IDs
 * @returns Mapping of Notion page IDs to Trilium note IDs
 */
export async function rebuildHierarchyInTrilium(
  pagesMetadata: NotionPageMetadata[],
  rootParentNoteId: string = 'root',
  dryRun: boolean = false,
  cache?: NotionCache
): Promise<PageMapping> {
  const pageMapping: PageMapping = new Map();

  if (dryRun) {
    logger.info('🔍 [DRY RUN] Phase 2: Would create hierarchy in Trilium');
    return pageMapping;
  }

  logger.info('📋 Phase 2: Creating note hierarchy in Trilium...');

  // Sort pages by hierarchy (parents first)
  const sortedPages = sortPagesByHierarchy(pagesMetadata);

  // Create each note (just shell with title, no content yet)
  for (let i = 0; i < sortedPages.length; i++) {
    const pageMeta = sortedPages[i];
    logger.progress(i + 1, sortedPages.length, `Creating: ${pageMeta.title}`);

    try {
      // Determine parent note ID in Trilium
      const triliumParentId = pageMeta.parentId && pageMapping.has(pageMeta.parentId)
        ? pageMapping.get(pageMeta.parentId)!
        : rootParentNoteId;

      // Create empty note with just title (check cache first for existing note)
      const noteId = await createEmptyNote(pageMeta.title, triliumParentId, pageMeta.id, cache);

      if (noteId) {
        pageMapping.set(pageMeta.id, noteId);
        logger.debug(`Created note: ${pageMeta.title} (${noteId}) under parent ${triliumParentId}`);
      } else {
        logger.error(`Failed to create note: ${pageMeta.title}`);
      }
    } catch (error) {
      logger.error(`Error creating note "${pageMeta.title}"`, error);
    }
  }

  logger.success(`✅ Phase 2 complete: Created ${pageMapping.size} notes in Trilium`);
  return pageMapping;
}

/**
 * Sorts pages by hierarchy (parents before children)
 * Uses topological sort to ensure proper ordering
 */
function sortPagesByHierarchy(pages: NotionPageMetadata[]): NotionPageMetadata[] {
  const pageMap = new Map<string, NotionPageMetadata>();
  const sorted: NotionPageMetadata[] = [];
  const visited = new Set<string>();

  // Build map for quick lookup
  for (const page of pages) {
    pageMap.set(page.id, page);
  }

  // Recursive function to add page and its ancestors first
  function addPageWithAncestors(page: NotionPageMetadata) {
    if (visited.has(page.id)) {
      return;
    }

    // If page has a parent in our set, add parent first
    if (page.parentId && pageMap.has(page.parentId)) {
      const parent = pageMap.get(page.parentId)!;
      addPageWithAncestors(parent);
    }

    // Now add this page
    visited.add(page.id);
    sorted.push(page);
  }

  // Process all pages
  for (const page of pages) {
    addPageWithAncestors(page);
  }

  return sorted;
}

/**
 * Creates an empty note in Trilium (just title, no content)
 * Checks cache and Trilium for existing notes with the same notionId to avoid duplicates
 * This is faster than creating notes with content
 */
async function createEmptyNote(
  title: string,
  parentNoteId: string,
  notionPageId: string,
  cache?: NotionCache
): Promise<string | null> {
  try {
    // First, check the cache for an existing Trilium note ID
    if (cache) {
      const cachedPage = cache.getPage(notionPageId);
      if (cachedPage?.triliumNoteId) {
        logger.debug(`Found cached Trilium note for "${title}" (${cachedPage.triliumNoteId})`);
        return cachedPage.triliumNoteId;
      }
    }

    // If not in cache, check Trilium directly for a note with this notionId attribute
    const existingNoteId = await findExistingNotionNote(notionPageId);

    if (existingNoteId) {
      logger.debug(`Found existing note in Trilium for "${title}" (${existingNoteId})`);

      // Store Trilium note ID in cache for future lookups (but don't mark as imported yet)
      if (cache) {
        cache.setTriliumNoteId(notionPageId, existingNoteId);
      }

      return existingNoteId;
    }

    // Create new note if it doesn't exist
    const response = await etapiRequest<any>('/create-note', {
      method: 'POST',
      body: {
        parentNoteId,
        title: title || 'Untitled',
        type: 'text',
        content: '', // Empty content for now
        mime: 'text/html',
      },
    });

    // Try different possible response formats
    const noteId = response.noteId || response.note?.noteId || response.id;

    if (!noteId) {
      logger.error(`No noteId in response for "${title}"`);
      logger.debug(`Response structure: ${JSON.stringify(response, null, 2)}`);
      return null;
    }

    // Add notionId attribute immediately so future checks can find it
    try {
      await etapiRequest('/attributes', {
        method: 'POST',
        body: {
          noteId,
          type: 'label',
          name: 'notionId',
          value: notionPageId,
        },
      });
      logger.debug(`Added notionId attribute to note ${noteId}`);
    } catch (error) {
      logger.warn(`Failed to add notionId attribute to note ${noteId}`, error);
    }

    // Store Trilium note ID in cache for future lookups (but don't mark as imported yet)
    // Note: Will be marked as imported in Phase 3 after content is added
    if (cache) {
      cache.setTriliumNoteId(notionPageId, noteId);
    }

    return noteId;
  } catch (error) {
    logger.error(`Failed to create empty note for "${title}"`, error);
    return null;
  }
}

/**
 * PHASE 3: Updates note content in Trilium
 * At this point, all notes exist with correct hierarchy, so internal links will work
 *
 * @param client - Notion API client
 * @param pagesMetadata - Array of page metadata
 * @param pageMapping - Mapping of Notion IDs to Trilium IDs from Phase 2
 * @param fetchContentFn - Function to fetch content for a page
 * @param dryRun - If true, only logs what would be updated
 * @param cache - Optional cache instance to mark pages as imported after content update
 * @returns Statistics about the update process
 */
export async function updateNoteContent(
  pagesMetadata: NotionPageMetadata[],
  pageMapping: PageMapping,
  fetchContentFn: (pageId: string) => Promise<any[]>, // Function to fetch content
  dryRun: boolean = false,
  cache?: NotionCache
): Promise<{ successful: number; failed: number }> {
  const stats = { successful: 0, failed: 0 };

  if (dryRun) {
    logger.info('🔍 [DRY RUN] Phase 3: Would update note content');
    return stats;
  }

  logger.info('📝 Phase 3: Updating note content...');

  for (let i = 0; i < pagesMetadata.length; i++) {
    const pageMeta = pagesMetadata[i];
    logger.progress(i + 1, pagesMetadata.length, `Updating: ${pageMeta.title}`);

    try {
      const triliumNoteId = pageMapping.get(pageMeta.id);
      if (!triliumNoteId) {
        logger.warn(`No Trilium note ID found for ${pageMeta.title}, skipping`);
        stats.failed++;
        continue;
      }

      // Fetch content from Notion
      const content = await fetchContentFn(pageMeta.id);

      logger.debug(`Fetched ${content?.length || 0} blocks for "${pageMeta.title}"`);

      // Skip notes with no content - leave them as empty placeholders
      if (!content || content.length === 0) {
        logger.debug(`Skipping "${pageMeta.title}" - no content blocks`);
        stats.successful++;
        continue;
      }

      // Build NotionPage object for conversion
      const page: NotionPage = {
        ...pageMeta,
        content: content, // We know content exists at this point
      };

      // Convert to HTML with link resolution
      const htmlContent = convertPageToHtml(page, pageMapping);

      logger.debug(`Converted "${pageMeta.title}" to HTML (length: ${htmlContent?.length || 0})`);

      // Update the note in Trilium
      await updateNoteInTrilium(triliumNoteId, htmlContent, pageMeta);

      stats.successful++;
      logger.debug(`Updated content for: ${pageMeta.title}`);

      // Mark as successfully imported in cache (only after content update succeeds)
      if (cache) {
        cache.markImported(pageMeta.id, triliumNoteId);
        cache.resolveErrors(pageMeta.id);
      }
    } catch (error) {
      stats.failed++;
      logger.error(`Error updating content for "${pageMeta.title}"`, error);

      // Log error in cache for tracking
      if (cache) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        cache.logError(pageMeta.id, pageMeta.title, errorMessage, 'import', errorStack);
      }
    }
  }

  logger.success(`✅ Phase 3 complete: Updated ${stats.successful} notes, ${stats.failed} failed`);
  return stats;
}

/**
 * Updates an existing note's content in Trilium
 */
async function updateNoteInTrilium(
  noteId: string,
  htmlContent: string,
  pageMeta: NotionPageMetadata
): Promise<void> {
  try {
    // Ensure content is not null or undefined
    let content = htmlContent;

    // Check for null/undefined and provide diagnostic info
    if (content === null || content === undefined) {
      logger.warn(`Content is ${content === null ? 'null' : 'undefined'} for "${pageMeta.title}", using empty div`);
      content = '<div class="notion-page"></div>';
    } else if (content === '') {
      logger.debug(`Empty content for "${pageMeta.title}", using empty div`);
      content = '<div class="notion-page"></div>';
    }

    // Final safety check - absolutely ensure we're not sending null
    if (content === null || content === undefined || content === '') {
      logger.error(`CRITICAL: Content is still ${content === null ? 'null' : content === undefined ? 'undefined' : 'empty'} for "${pageMeta.title}" after all checks`);
      content = '<div class="notion-page"><p>This page has no content.</p></div>';
    }

    logger.debug(`Updating note ${noteId} with content length: ${content.length}, type: ${typeof content}`);

    // Update note content - ETAPI expects raw HTML string in body
    const response = await fetch(`${getETAPIBaseUrl()}/etapi/notes/${noteId}/content`, {
      method: 'PUT',
      headers: {
        'Authorization': getETAPIAuthHeader(),
        'Content-Type': 'text/html',
      },
      body: String(content), // Explicitly convert to string to be absolutely sure
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update content: ${response.status} ${response.statusText}. ${errorText}`);
    }

    // Add metadata attributes
    await addNoteAttributes(noteId, {
      id: pageMeta.id,
      url: pageMeta.url,
      icon: pageMeta.icon,
      title: pageMeta.title,
      content: [], // Not needed for attributes
      parentId: pageMeta.parentId,
      createdTime: pageMeta.createdTime,
      lastEditedTime: pageMeta.lastEditedTime,
    });
  } catch (error) {
    throw new Error(`Failed to update note ${noteId}: ${error}`);
  }
}

/**
 * Sorts pages in parent-first order to ensure parents are created before children
 * Exported for testing purposes
 */
export function sortPagesForImport(pages: NotionPage[]): NotionPage[] {
  const pageMap = new Map<string, NotionPage>();
  const sorted: NotionPage[] = [];
  const visited = new Set<string>();

  // Build a map for quick lookup
  for (const page of pages) {
    pageMap.set(page.id, page);
  }

  // Recursive function to add a page and its ancestors first
  function addPageWithAncestors(page: NotionPage) {
    if (visited.has(page.id)) {
      return;
    }

    // If page has a parent in our set, add parent first
    if (page.parentId && pageMap.has(page.parentId)) {
      const parent = pageMap.get(page.parentId)!;
      addPageWithAncestors(parent);
    }

    // Now add this page
    visited.add(page.id);
    sorted.push(page);
  }

  // Process all pages
  for (const page of pages) {
    addPageWithAncestors(page);
  }

  return sorted;
}

/**
 * Imports Notion pages into Trilium
 */
export async function importPages(
  pages: NotionPage[],
  parentNoteId: string = 'root',
  dryRun: boolean = false,
  cache?: NotionCache
): Promise<ImportStats> {
  const stats: ImportStats = {
    successful: 0,
    failed: 0,
    skipped: 0,
    total: pages.length,
  };

  if (dryRun) {
    logger.info('🔍 DRY RUN MODE - No changes will be made to Trilium');
  }

  // Create a mapping of Notion page IDs to Trilium note IDs
  const pageMapping: PageMapping = new Map();

  // First, populate cache with all pages for change detection
  if (cache) {
    logger.info('Updating cache with fetched pages...');
    for (const page of pages) {
      cache.setPage(page.id, page.title, page.lastEditedTime);
    }
  }

  // Sort pages in parent-first order to preserve hierarchy
  logger.info('Sorting pages to preserve hierarchy...');
  const sortedPages = sortPagesForImport(pages);
  logger.debug(`Sorted ${sortedPages.length} pages for import`);

  // Create all notes with proper hierarchy
  logger.info('Creating notes in Trilium...');

  for (let i = 0; i < sortedPages.length; i++) {
    const page = sortedPages[i];
    logger.progress(i + 1, sortedPages.length, `Processing: ${page.title}`);

    try {
      // Check if page needs to be imported using cache
      if (cache && !cache.needsImport(page.id, page.lastEditedTime)) {
        logger.debug(`Skipping unchanged page: ${page.title}`);
        stats.skipped++;

        // Still add to mapping for hierarchy purposes
        const cached = cache.getPage(page.id);
        if (cached?.triliumNoteId) {
          pageMapping.set(page.id, cached.triliumNoteId);
        }
        continue;
      }

      if (dryRun) {
        logger.info(`[DRY RUN] Would create note: "${page.title}"`);
        stats.successful++;
        continue;
      }

      const noteId = await createNote(page, parentNoteId, pageMapping);

      if (noteId) {
        pageMapping.set(page.id, noteId);
        stats.successful++;
        logger.debug(`Created note: ${page.title} (${noteId})`);

        // Mark as imported in cache
        if (cache) {
          cache.markImported(page.id, noteId);
        }
      } else {
        stats.failed++;
        logger.error(`Failed to create note: ${page.title}`);
      }
    } catch (error) {
      stats.failed++;
      logger.error(`Error importing page "${page.title}"`, error);
    }
  }

  logger.success(
    `Import complete: ${stats.successful} successful, ${stats.failed} failed, ${stats.skipped} skipped`
  );

  return stats;
}

/**
 * Creates a single note in Trilium
 * @param page - The Notion page to import
 * @param parentNoteId - The parent note ID in Trilium
 * @param pageMapping - Optional mapping for resolving parent relationships
 * @returns The created note ID or null on failure
 */
export async function createNote(
  page: NotionPage,
  parentNoteId: string,
  pageMapping?: PageMapping
): Promise<string | null> {
  try {
    // Determine parent - use mapping if this page has a parent in Notion
    const triliumParentId = page.parentId && pageMapping?.has(page.parentId)
      ? pageMapping.get(page.parentId)!
      : parentNoteId;

    logger.debug(`Creating note "${page.title}" under parent ${triliumParentId}`);

    // Convert Notion content to HTML with page mapping for internal links
    const htmlContent = convertPageToHtml(page, pageMapping);

    // Create the note
    const response = await etapiRequest<any>('/create-note', {
      method: 'POST',
      body: {
        parentNoteId: triliumParentId,
        title: page.title || 'Untitled',
        type: 'text',
        content: htmlContent,
        mime: 'text/html',
      },
    });

    logger.debug(`Create note response for "${page.title}": ${JSON.stringify(response)}`);

    // Try different possible response formats (same as createParentNote)
    const noteId = response.noteId || response.note?.noteId || response.id;

    if (!noteId) {
      logger.error(`No noteId in response for "${page.title}"`);
      logger.error(`Response structure: ${JSON.stringify(response, null, 2)}`);
      logger.error(`Parent ID used: ${triliumParentId}`);
      logger.error(`Notion parent ID: ${page.parentId || 'none'}`);
      return null;
    }

    // Add metadata as attributes
    await addNoteAttributes(noteId, page);

    return noteId;
  } catch (error) {
    logger.error(`Failed to create note for page ${page.id}`, error);
    return null;
  }
}

/**
 * Adds attributes (metadata) to a note
 */
async function addNoteAttributes(noteId: string, page: NotionPage): Promise<void> {
  try {
    const attributes = [
      {
        type: 'label',
        name: 'notionId',
        value: page.id,
      },
      {
        type: 'label',
        name: 'notionUrl',
        value: page.url,
      },
      {
        type: 'label',
        name: 'imported',
        value: new Date().toISOString(),
      },
    ];

    // Add icon if present
    if (page.icon) {
      attributes.push({
        type: 'label',
        name: 'iconClass',
        value: page.icon,
      });
    }

    // Create all attributes
    for (const attr of attributes) {
      try {
        await etapiRequest('/attributes', {
          method: 'POST',
          body: {
            noteId,
            type: attr.type,
            name: attr.name,
            value: attr.value,
          },
        });
      } catch (error) {
        logger.warn(`Failed to add attribute ${attr.name} to note ${noteId}`);
      }
    }
  } catch (error) {
    logger.warn(`Failed to add attributes to note ${noteId}`, error);
  }
}

/**
 * Tests the connection to Trilium
 */
export async function testConnection(): Promise<boolean> {
  try {
    const response = await etapiRequest<{ appVersion: string }>('/app-info');
    logger.success(`Connected to Trilium version ${response.appVersion}`);
    return true;
  } catch (error) {
    logger.error('Failed to connect to Trilium', error);
    return false;
  }
}

/**
 * Validates that a Trilium parent note exists and is accessible
 * @returns true if note exists and is accessible, false otherwise
 */
export async function validateParentNote(noteId: string): Promise<boolean> {
  try {
    logger.debug(`Validating parent note: ${noteId}`);

    // Special case: 'root' is always valid
    if (noteId === 'root') {
      logger.success('Parent note validated: root');
      return true;
    }

    // Try to fetch the note
    const response = await etapiRequest<ETAPINote>(`/notes/${noteId}`);

    if (response.noteId) {
      logger.success(`Parent note validated: "${response.title}" (${noteId})`);
      return true;
    }

    logger.error(`Parent note ${noteId} exists but could not be retrieved`);
    return false;
  } catch (error: any) {
    if (error?.message?.includes('404')) {
      logger.error(`Parent note ${noteId} does not exist`);
    } else if (error?.message?.includes('401') || error?.message?.includes('403')) {
      logger.error(`Parent note ${noteId} exists but you do not have access to it`);
    } else {
      logger.error(`Failed to validate parent note ${noteId}`, error);
    }
    return false;
  }
}

/**
 * Creates a new parent note in Trilium for importing Notion pages
 * @returns the created note ID or null on failure
 */
export async function createParentNote(title: string, parentNoteId: string = 'root'): Promise<string | null> {
  try {
    logger.debug(`Creating parent note: ${title} under ${parentNoteId}`);

    const response = await etapiRequest<any>('/create-note', {
      method: 'POST',
      body: {
        parentNoteId,
        title,
        type: 'text',
        content: '<p>This note was created to import Notion pages.</p>',
        mime: 'text/html',
      },
    });

    logger.debug(`Create note response: ${JSON.stringify(response)}`);

    // Try different possible response formats
    const noteId = response.noteId || response.note?.noteId || response.id;

    if (noteId) {
      logger.success(`Created parent note: "${title}" (${noteId})`);
      return noteId;
    }

    logger.error('Failed to create parent note - no noteId returned');
    logger.error(`Response structure: ${JSON.stringify(response, null, 2)}`);
    return null;
  } catch (error) {
    logger.error(`Failed to create parent note "${title}"`, error);
    return null;
  }
}

/**
 * Searches for existing notes by Notion ID to avoid duplicates
 */
export async function findExistingNotionNote(notionId: string): Promise<string | null> {
  try {
    const response = await etapiRequest<{ results: any[] }>(
      `/notes?search=@notionId="${notionId}"`
    );

    if (response.results && response.results.length > 0) {
      return response.results[0].noteId;
    }

    return null;
  } catch (error) {
    logger.debug(`Error searching for existing note with Notion ID ${notionId}`, error);
    return null;
  }
}
