#!/usr/bin/env node

import { getConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { createNotionClient } from './notion/client.js';
import { fetchAllPages } from './notion/fetcher.js';
import { initETAPI } from './trilium/etapi.js';
import { importPages, testConnection } from './trilium/importer.js';
import { NotionCache } from './cache/index.js';

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
      config.TRILIUM_PARENT_NOTE_ID,
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
