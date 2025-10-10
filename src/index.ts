#!/usr/bin/env node

import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { Command } from 'commander';
import { getConfig, type CLIOptions } from './config/env.js';
import { logger } from './utils/logger.js';
import { createNotionClient } from './notion/client.js';
import { scanNotionStructure, fetchPageContent, validateRootPage } from './notion/fetcher.js';
import { initETAPI } from './trilium/etapi.js';
import { rebuildHierarchyInTrilium, updateNoteContent, testConnection, validateParentNote, createParentNote } from './trilium/importer.js';
import { NotionCache } from './cache/index.js';
import type { NotionPage } from './notion/types.js';

/**
 * Creates a readline interface for interactive prompts
 */
function createReadlineInterface() {
  return readline.createInterface({ input, output });
}

/**
 * Generates an ASCII tree visualization of the page hierarchy
 */
function generateTreeVisualization(
  pagesMetadata: import('./notion/types.js').NotionPageMetadata[],
  maxDepth: number = 5
): string {
  // Build a map for quick lookups
  const pageMap = new Map(pagesMetadata.map(p => [p.id, p]));

  // Find root pages (pages without parents or parents not in our set)
  const rootPages = pagesMetadata.filter(p => !p.parentId || !pageMap.has(p.parentId));

  // Build children map
  const childrenMap = new Map<string, import('./notion/types.js').NotionPageMetadata[]>();
  for (const page of pagesMetadata) {
    if (page.parentId) {
      if (!childrenMap.has(page.parentId)) {
        childrenMap.set(page.parentId, []);
      }
      childrenMap.get(page.parentId)!.push(page);
    }
  }

  let output = '';
  let totalShown = 0;
  const maxNodesToShow = 100;

  function addNode(page: import('./notion/types.js').NotionPageMetadata, prefix: string, isLast: boolean, depth: number) {
    if (totalShown >= maxNodesToShow) {
      if (totalShown === maxNodesToShow) {
        output += `${prefix}... (${pagesMetadata.length - totalShown} more pages)\n`;
        totalShown++;
      }
      return;
    }

    const connector = isLast ? '└── ' : '├── ';
    const icon = page.icon || '📄';
    const title = page.title.length > 60 ? page.title.substring(0, 57) + '...' : page.title;

    output += `${prefix}${connector}${icon} ${title}\n`;
    totalShown++;

    if (depth >= maxDepth) {
      const children = childrenMap.get(page.id);
      if (children && children.length > 0) {
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        output += `${newPrefix}... (${children.length} child pages)\n`;
      }
      return;
    }

    const children = childrenMap.get(page.id) || [];
    children.forEach((child, index) => {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      addNode(child, newPrefix, index === children.length - 1, depth + 1);
    });
  }

  rootPages.forEach((page, index) => {
    addNode(page, '', index === rootPages.length - 1, 0);
  });

  return output;
}

/**
 * Shows the tree preview and asks user for confirmation
 */
async function confirmImport(
  pagesMetadata: import('./notion/types.js').NotionPageMetadata[]
): Promise<boolean> {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('           📋 IMPORT STRUCTURE PREVIEW            ');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log(`Found ${pagesMetadata.length} pages to import:`);
  console.log('');
  console.log(generateTreeVisualization(pagesMetadata));
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  const rl = createReadlineInterface();

  try {
    const answer = await rl.question('Do you want to proceed with this import? (yes/no): ');
    rl.close();

    const response = answer.trim().toLowerCase();
    return response === 'yes' || response === 'y';
  } finally {
    rl.close();
  }
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
  // Parse CLI arguments FIRST before any other code
  const program = new Command();

  program
    .name('notion-to-trilium')
    .description('Import your Notion pages into Trilium Notes')
    .version('1.0.0')
    .option('-r, --root-page-id <id>', 'Notion root page ID to start import from')
    .option('-t, --trilium-parent-id <id>', 'Trilium parent note ID for imported notes')
    .option('-d, --dry-run', 'Preview import without making changes', false)
    .option('-s, --structure-only', 'Only create note structure (no content)', false)
    .option('-l, --log-level <level>', 'Set log level (debug, info, warn, error)', 'info')
    .parse(process.argv);

  const options = program.opts();

  // Build CLI options for config
  const cliOptions: CLIOptions = {
    rootPageId: options.rootPageId,
    triliumParentNoteId: options.triliumParentId,
    dryRun: options.dryRun,
    structureOnly: options.structureOnly,
    logLevel: options.logLevel as 'debug' | 'info' | 'warn' | 'error',
  };

  try {
    // Print banner
    console.log('');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║                                                   ║');
    console.log('║        Notion to Trilium Import Tool              ║');
    console.log('║                                                   ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');

    // Load and validate configuration with CLI overrides
    logger.info('Loading configuration...');
    const config = getConfig(cliOptions);

    // Set log level
    logger.setLevel(config.LOG_LEVEL);

    if (config.DRY_RUN) {
      logger.warn('DRY RUN mode is enabled - no changes will be made');
    }

    if (config.STRUCTURE_ONLY) {
      logger.warn('STRUCTURE_ONLY mode is enabled - will stop after creating hierarchy');
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
        console.log('   1. The page ID is correct (use --root-page-id <id>)');
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

    // Setup Trilium parent note
    logger.info('Setting up Trilium parent note...');
    let parentNoteId = config.TRILIUM_PARENT_NOTE_ID;

    // If no parent note specified or default 'root', create a dedicated import folder
    if (!parentNoteId || parentNoteId === 'root') {
      logger.info('No specific parent note configured - creating "Notion Import" folder...');

      // Generate a timestamp for the import folder
      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const folderTitle = `Notion Import (${timestamp})`;

      const importFolderId = await createParentNote(folderTitle, 'root');

      if (importFolderId) {
        parentNoteId = importFolderId;
        logger.success(`✅ Created import folder: "${folderTitle}" (${importFolderId})`);
        console.log('');
        console.log('💡 All Notion pages will be imported under this folder.');
        console.log('   You can move or rename it later in Trilium.');
        console.log('');
      } else {
        cache.close();
        logger.error('Failed to create import folder. Exiting.');
        process.exit(1);
      }
    } else {
      // Validate the specified parent note
      logger.info(`Validating parent note: ${parentNoteId}...`);
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
    }

    // THREE-PHASE IMPORT APPROACH
    // Phase 1: Scan structure
    // Phase 2: Create hierarchy
    // Phase 3: Fill in content
    logger.info('Starting three-phase import process...');
    const startTime = Date.now();

    // Track import statistics
    const stats = {
      successful: 0,
      failed: 0,
      skipped: 0,
      total: 0,
    };

    // ===== PHASE 1: Scan Notion structure (metadata only) =====
    logger.info('');
    logger.info('📊 Phase 1: Scanning Notion structure...');
    const pagesMetadata = await scanNotionStructure(
      notionClient,
      config.NOTION_ROOT_PAGE_ID
    );

    if (pagesMetadata.length === 0) {
      cache.close();
      logger.warn('No pages found to import. Make sure your integration has access to pages.');
      process.exit(0);
    }

    stats.total = pagesMetadata.length;

    // Update cache with all fetched pages
    if (cache) {
      for (const pageMeta of pagesMetadata) {
        cache.setPage(pageMeta.id, pageMeta.title, pageMeta.lastEditedTime);
      }
    }

    // Filter pages that need to be imported (new or modified)
    const pagesToImport = pagesMetadata.filter(pageMeta => {
      if (!cache) return true;

      if (!cache.needsImport(pageMeta.id, pageMeta.lastEditedTime)) {
        stats.skipped++;
        return false;
      }

      return true;
    });

    logger.info(`Found ${pagesToImport.length} pages to import (${stats.skipped} unchanged, ${stats.total - pagesToImport.length - stats.skipped} cached)`);

    if (pagesToImport.length === 0) {
      cache.close();
      logger.success('All pages are up to date - no import needed!');
      process.exit(0);
    }

    // Show tree preview and get confirmation (unless in DRY_RUN mode)
    if (!config.DRY_RUN) {
      const confirmed = await confirmImport(pagesToImport);

      if (!confirmed) {
        cache.close();
        console.log('');
        console.log('❌ Import cancelled by user.');
        console.log('');
        process.exit(0);
      }

      console.log('');
      console.log('✅ Import confirmed - proceeding...');
      console.log('');
    }

    // ===== PHASE 2: Create hierarchy in Trilium =====
    logger.info('');
    logger.info('🏗️  Phase 2: Creating note hierarchy in Trilium...');
    const pageMapping = await rebuildHierarchyInTrilium(
      pagesToImport,
      parentNoteId,
      config.DRY_RUN
    );

    if (config.DRY_RUN) {
      cache.close();
      console.log('');
      console.log('💡 This was a dry run. Run without --dry-run flag to import for real.');
      console.log('');
      process.exit(0);
    }

    // Stop here if STRUCTURE_ONLY mode is enabled
    if (config.STRUCTURE_ONLY) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      cache.close();

      console.log('');
      console.log('═══════════════════════════════════════════════════');
      console.log('           Hierarchy Creation Complete             ');
      console.log('═══════════════════════════════════════════════════');
      console.log(`  📊 Total pages scanned:    ${stats.total}`);
      console.log(`  🏗️  Notes created:          ${pageMapping.size}`);
      console.log(`  ⏭️  Skipped (unchanged):   ${stats.skipped}`);
      console.log(`  ⏱️  Duration:               ${duration}s`);
      console.log('═══════════════════════════════════════════════════');
      console.log('');
      console.log('✅ Directory structure has been created in Trilium!');
      console.log('');
      console.log('💡 Next steps:');
      console.log('   1. Check your Trilium instance to verify the hierarchy');
      console.log('   2. If it looks good, run without --structure-only flag');
      console.log('   3. Run: pnpm start (or npm start) to fill in the content');
      console.log('');
      console.log('ℹ️  Note: Empty notes have been created with correct parent-child');
      console.log('   relationships. Content will be added in Phase 3.');
      console.log('');
      process.exit(0);
    }

    // ===== PHASE 3: Update note content =====
    logger.info('');
    logger.info('📝 Phase 3: Updating note content...');

    // Create a wrapper function for fetching content
    const fetchContent = async (pageId: string) => {
      return await fetchPageContent(notionClient, pageId);
    };

    const contentStats = await updateNoteContent(
      pagesToImport,
      pageMapping,
      fetchContent,
      config.DRY_RUN
    );

    stats.successful = contentStats.successful;
    stats.failed = contentStats.failed;

    // Update cache for successful imports
    if (cache) {
      for (const pageMeta of pagesToImport) {
        const noteId = pageMapping.get(pageMeta.id);
        if (noteId && contentStats.successful > 0) {
          cache.markImported(pageMeta.id, noteId);
          cache.resolveErrors(pageMeta.id);
        } else if (!noteId) {
          cache.logError(
            pageMeta.id,
            pageMeta.title,
            'Failed to create note in Trilium during hierarchy phase',
            'import'
          );
        }
      }
    }

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
      console.log('💡 This was a dry run. Run without --dry-run flag to import for real.');
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
