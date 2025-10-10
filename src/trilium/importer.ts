import type { NotionPage } from '../notion/types.js';
import { convertPageToHtml } from '../notion/converter.js';
import { etapiRequest, type ETAPINote } from './etapi.js';
import { logger } from '../utils/logger.js';
import type { NotionCache } from '../cache/index.js';

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
 * Sorts pages in parent-first order to ensure parents are created before children
 */
function sortPagesForImport(pages: NotionPage[]): NotionPage[] {
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

      // Determine parent - use mapping if this page has a parent in Notion
      const triliumParentId = page.parentId && pageMapping.has(page.parentId)
        ? pageMapping.get(page.parentId)!
        : parentNoteId;

      const noteId = await createNote(page, triliumParentId);

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
 */
async function createNote(
  page: NotionPage,
  parentNoteId: string
): Promise<string | null> {
  try {
    // Convert Notion content to HTML
    const htmlContent = convertPageToHtml(page);

    // Create the note
    const response = await etapiRequest<ETAPINote>('/create-note', {
      method: 'POST',
      body: {
        parentNoteId,
        title: page.title || 'Untitled',
        type: 'text',
        content: htmlContent,
        mime: 'text/html',
      },
    });

    // Add metadata as attributes
    if (response.noteId) {
      await addNoteAttributes(response.noteId, page);
    }

    return response.noteId;
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
