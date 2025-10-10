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

  // First, create all notes without hierarchy
  logger.info('Creating notes in Trilium...');

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    logger.progress(i + 1, pages.length, `Processing: ${page.title}`);

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
