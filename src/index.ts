#!/usr/bin/env node

import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { getConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { createNotionClient } from './notion/client.js';
import { fetchAllPages, validateRootPage } from './notion/fetcher.js';
import { initETAPI } from './trilium/etapi.js';
import { importPages, testConnection, validateParentNote } from './trilium/importer.js';
import { NotionCache } from './cache/index.js';

/**
 * Creates a readline interface for interactive prompts
 */
function createReadlineInterface() {
  return readline.createInterface({ input, output });
}

/**
 * Prompts user for a new parent note ID
 */
async function promptForParentNoteId(rl: readline.Interface): Promise<string | null> {
  console.log('');
  console.log('❌ The specified Trilium parent note does not exist or is not accessible.');
  console.log('');
  console.log('💡 Would you like to:');
  console.log('   1. Enter a different parent note ID');
  console.log('   2. Use "root" as the parent note');
  console.log('   3. Exit and create a note in Trilium first');
  console.log('');

  const choice = await rl.question('Enter your choice (1-3): ');

  if (choice === '1') {
    console.log('');
    console.log('ℹ️  To find a note ID:');
    console.log('   - Open Trilium');
    console.log('   - Right-click on the note you want → "Note info" → Copy the Note ID');
    console.log('');
    const noteId = await rl.question('Enter the parent note ID: ');
    return noteId.trim() || null;
  } else if (choice === '2') {
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

    // Fetch pages from Notion
    logger.info('Fetching pages from Notion...');
    const startTime = Date.now();

    const pages = await fetchAllPages(
      notionClient,
      config.NOTION_ROOT_PAGE_ID
    );

    const fetchDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`Fetched ${pages.length} pages in ${fetchDuration}s`);

    if (pages.length === 0) {
      cache.close();
      logger.warn('No pages found to import. Make sure your integration has access to pages.');
      process.exit(0);
    }

    // Import pages to Trilium
    logger.info(`Importing ${pages.length} pages to Trilium...`);
    const importStartTime = Date.now();

    const stats = await importPages(
      pages,
      parentNoteId,
      config.DRY_RUN,
      cache
    );

    // Close the cache
    cache.close();
    logger.debug(`Cache saved to: ${cache.getDbPath()}`);

    const importDuration = ((Date.now() - importStartTime) / 1000).toFixed(2);

    // Print final statistics
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('                  Import Summary                   ');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Total pages:      ${stats.total}`);
    console.log(`  ✅ Successful:    ${stats.successful}`);
    console.log(`  ❌ Failed:        ${stats.failed}`);
    console.log(`  ⏭️  Skipped:       ${stats.skipped}`);
    console.log(`  ⏱️  Duration:      ${importDuration}s`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    if (config.DRY_RUN) {
      console.log('💡 This was a dry run. Set DRY_RUN=false to import for real.');
      console.log('');
    }

    if (stats.failed > 0) {
      logger.warn('Some pages failed to import. Check the logs above for details.');
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
