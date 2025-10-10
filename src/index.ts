#!/usr/bin/env node

import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { createNotionClient } from './notion/client.js';
import { fetchAllPages, validateRootPage } from './notion/fetcher.js';
import { initETAPI } from './trilium/etapi.js';
import { createNote, testConnection, validateParentNote, createParentNote } from './trilium/importer.js';
import { NotionCache } from './cache/index.js';
import type { NotionPage } from './notion/types.js';

/**
 * Creates a readline interface for interactive prompts
 */
function createReadlineInterface() {
  return readline.createInterface({ input, output });
}

/**
 * Prompts user for a new parent note ID or creates one
 */
async function promptForParentNoteId(rl: readline.Interface): Promise<string | null> {
  console.log('');
  console.log('❌ The specified Trilium parent note does not exist or is not accessible.');
  console.log('');
  console.log('💡 Would you like to:');
  console.log('   1. Create a new parent note in Trilium now');
  console.log('   2. Enter a different parent note ID');
  console.log('   3. Use "root" as the parent note');
  console.log('   4. Exit and create a note manually');
  console.log('');

  const choice = await rl.question('Enter your choice (1-4): ');

  if (choice === '1') {
    console.log('');
    const noteTitle = await rl.question('Enter a title for the new parent note (default: "Imported from Notion"): ');
    const title = noteTitle.trim() || 'Imported from Notion';

    logger.info(`Creating parent note: ${title}...`);
    const newNoteId = await createParentNote(title);

    if (!newNoteId) {
      console.log('');
      console.log('❌ Failed to create the parent note. Please try another option.');
      return null;
    }

    return newNoteId;
  } else if (choice === '2') {
    console.log('');
    console.log('ℹ️  To find a note ID:');
    console.log('   - Open Trilium');
    console.log('   - Right-click on the note you want → "Note info" → Copy the Note ID');
    console.log('');
    const noteId = await rl.question('Enter the parent note ID: ');
    return noteId.trim() || null;
  } else if (choice === '3') {
    return 'root';
  } else {
    console.log('');
    console.log('Please create a note in Trilium and update TRILIUM_PARENT_NOTE_ID in your .env file.');
    console.log('');
    return null;
  }
}

/**
 * Main application entry point
 */
async function main() {
  try {
    // Print banner
    console.log('');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║                                                   ║');
    console.log('║        Notion to Trilium Import Tool             ║');
    console.log('║                                                   ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');

    // Load and validate configuration
    logger.info('Loading configuration...');
    const config = getConfig();

    // Set log level
    logger.setLevel(config.LOG_LEVEL);

    if (config.DRY_RUN) {
      logger.warn('DRY RUN mode is enabled - no changes will be made');
    }

    // Initialize Notion client
    logger.info('Initializing Notion client...');
    const notionClient = createNotionClient(config.NOTION_TOKEN);

    // Validate root page if specified
    if (config.NOTION_ROOT_PAGE_ID) {
      logger.info('Validating Notion root page...');
      const isValid = await validateRootPage(notionClient, config.NOTION_ROOT_PAGE_ID);

      if (!isValid) {
        console.log('');
        console.log('❌ The specified root page does not exist or is not accessible.');
        console.log('');
        console.log('💡 Please make sure:');
        console.log('   1. The page ID is correct in your .env file (NOTION_ROOT_PAGE_ID)');
        console.log('   2. The page exists in your Notion workspace');
        console.log('   3. Your Notion integration has been granted access to this page');
        console.log('');
        console.log('   To grant access: Open the page in Notion → Click "..." → Add connections → Select your integration');
        console.log('');
        process.exit(1);
      }
    }

    // Initialize cache
    logger.info('Initializing cache...');
    const cache = new NotionCache();
    const cacheStats = cache.getStats();
    logger.info(`Cache loaded: ${cacheStats.total} pages (${cacheStats.imported} imported, ${cacheStats.pending} pending)`);

    // Initialize Trilium ETAPI
    logger.info('Initializing Trilium connection...');
    initETAPI(config.TRILIUM_URL, config.TRILIUM_TOKEN);

    // Test Trilium connection
    logger.info('Testing Trilium connection...');
    const connected = await testConnection();

    if (!connected) {
      cache.close();
      logger.error('Failed to connect to Trilium. Please check your configuration.');
      process.exit(1);
    }

    // Validate Trilium parent note
    logger.info('Validating Trilium parent note...');
    let parentNoteId = config.TRILIUM_PARENT_NOTE_ID;
    let parentNoteValid = await validateParentNote(parentNoteId);

    if (!parentNoteValid) {
      const rl = createReadlineInterface();

      try {
        const newParentNoteId = await promptForParentNoteId(rl);

        if (!newParentNoteId) {
          cache.close();
          rl.close();
          process.exit(1);
        }

        // Validate the new parent note ID
        logger.info(`Validating new parent note: ${newParentNoteId}...`);
        parentNoteValid = await validateParentNote(newParentNoteId);

        if (!parentNoteValid) {
          cache.close();
          rl.close();
          console.log('');
          console.log('❌ The provided parent note ID is still invalid.');
          console.log('Please check the note ID and try again.');
          console.log('');
          process.exit(1);
        }

        // Update the parent note ID for the import
        parentNoteId = newParentNoteId;
        logger.success(`Parent note validated! Will import to: ${parentNoteId}`);
      } finally {
        rl.close();
      }
    }

    // Fetch pages from Notion and import immediately
    logger.info('Fetching and importing pages...');
    const startTime = Date.now();

    // Track import statistics
    const stats = {
      successful: 0,
      failed: 0,
      skipped: 0,
      total: 0,
    };

    // Mapping of Notion page IDs to Trilium note IDs for hierarchy
    const pageMapping = new Map<string, string>();

    // Callback to import each page immediately after fetching
    const importPageCallback = async (page: NotionPage) => {
      stats.total++;

      try {
        // Update cache with fetched page
        if (cache) {
          cache.setPage(page.id, page.title, page.lastEditedTime);
        }

        // Check if page needs to be imported using cache
        if (cache && !cache.needsImport(page.id, page.lastEditedTime)) {
          logger.debug(`Skipping unchanged page: ${page.title}`);
          stats.skipped++;

          // Still add to mapping for hierarchy purposes
          const cached = cache.getPage(page.id);
          if (cached?.triliumNoteId) {
            pageMapping.set(page.id, cached.triliumNoteId);
          }
          return;
        }

        if (config.DRY_RUN) {
          logger.info(`[DRY RUN] Would import: "${page.title}"`);
          stats.successful++;
          return;
        }

        // Import page to Trilium immediately
        const noteId = await createNote(page, parentNoteId, pageMapping);

        if (noteId) {
          pageMapping.set(page.id, noteId);
          stats.successful++;
          logger.info(`✅ Imported: ${page.title}`);

          // Mark as imported in cache and resolve any previous errors
          if (cache) {
            cache.markImported(page.id, noteId);
            cache.resolveErrors(page.id);
          }
        } else {
          stats.failed++;
          logger.error(`❌ Failed to import: ${page.title}`);

          // Log error to database
          if (cache) {
            cache.logError(
              page.id,
              page.title,
              'Failed to create note in Trilium - no noteId returned',
              'import'
            );
          }
        }
      } catch (error) {
        stats.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error(`❌ Error importing page "${page.title}"`, error);

        // Log error to database
        if (cache) {
          cache.logError(
            page.id,
            page.title,
            errorMessage,
            'import',
            errorStack
          );
        }
      }
    };

    // Fetch all pages with streaming import
    await fetchAllPages(
      notionClient,
      config.NOTION_ROOT_PAGE_ID,
      importPageCallback
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Close the cache
    cache.close();
    logger.debug(`Cache saved to: ${cache.getDbPath()}`);

    if (stats.total === 0) {
      logger.warn('No pages found to import. Make sure your integration has access to pages.');
      process.exit(0);
    }

    // Print final statistics
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('                  Import Summary                   ');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Total pages:      ${stats.total}`);
    console.log(`  ✅ Successful:    ${stats.successful}`);
    console.log(`  ❌ Failed:        ${stats.failed}`);
    console.log(`  ⏭️  Skipped:       ${stats.skipped}`);
    console.log(`  ⏱️  Duration:      ${duration}s`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    if (config.DRY_RUN) {
      console.log('💡 This was a dry run. Set DRY_RUN=false to import for real.');
      console.log('');
    }

    if (stats.failed > 0) {
      logger.warn('Some pages failed to import. Check the error summary below for details.');

      // Display error summary if there were failures
      if (cache) {
        const errorSummary = cache.getErrorSummary(20);
        console.log(errorSummary);
        console.log('💡 Error details are stored in the cache database.');
        console.log(`   Database: ${cache.getDbPath()}`);
        console.log('   Query the import_errors table for detailed analysis.');
        console.log('');
      }

      process.exit(1);
    }

    logger.success('Import completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Fatal error during import', error);
    process.exit(1);
  }
}

// Run the application
main();
