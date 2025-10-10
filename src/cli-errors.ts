#!/usr/bin/env node

/**
 * CLI tool to view and manage import errors
 */

import { NotionCache } from './cache/index.js';
import { logger } from './utils/logger.js';

function printHelp(): void {
  console.log('');
  console.log('Usage: pnpm errors [command] [options]');
  console.log('');
  console.log('Commands:');
  console.log('  list              List all unresolved errors (default)');
  console.log('  stats             Show error statistics');
  console.log('  summary           Show detailed error summary');
  console.log('  clear             Clear all error logs');
  console.log('  resolve <id>      Mark errors for a specific Notion page as resolved');
  console.log('  help              Show this help message');
  console.log('');
  console.log('Options:');
  console.log('  --phase <phase>   Filter by phase: fetch, convert, or import');
  console.log('  --limit <n>       Limit number of results (default: 50)');
  console.log('  --all             Show all errors including resolved ones');
  console.log('');
  console.log('Examples:');
  console.log('  pnpm errors list --phase import --limit 10');
  console.log('  pnpm errors summary');
  console.log('  pnpm errors resolve abc123def456');
  console.log('');
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  // Parse options
  const options: any = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--phase' && args[i + 1]) {
      options.phase = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--all') {
      options.showAll = true;
    }
  }

  const cache = new NotionCache();

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;

      case 'list': {
        const limit = options.limit || 50;
        const errors = cache.getErrors({
          phase: options.phase,
          limit,
        });

        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('                  Import Errors                    ');
        console.log('═══════════════════════════════════════════════════');
        console.log('');

        if (errors.length === 0) {
          console.log('✅ No unresolved errors found!');
        } else {
          console.log(`Found ${errors.length} unresolved error(s):\n`);

          for (const error of errors) {
            console.log(`❌ ${error.notionTitle}`);
            console.log(`   Notion ID:  ${error.notionId}`);
            console.log(`   Phase:      ${error.phase}`);
            console.log(`   Error:      ${error.errorMessage}`);
            console.log(`   Timestamp:  ${error.timestamp}`);
            if (error.retryCount > 0) {
              console.log(`   Retries:    ${error.retryCount}`);
            }
            if (error.errorStack) {
              console.log(`   Stack:      ${error.errorStack.substring(0, 200)}...`);
            }
            console.log('');
          }
        }

        console.log('');
        break;
      }

      case 'stats': {
        const stats = cache.getErrorStats();

        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('                Error Statistics                   ');
        console.log('═══════════════════════════════════════════════════');
        console.log(`  Total failed pages: ${stats.total}`);
        console.log(`  Fetch errors:       ${stats.byPhase.fetch}`);
        console.log(`  Convert errors:     ${stats.byPhase.convert}`);
        console.log(`  Import errors:      ${stats.byPhase.import}`);
        console.log(`  Recurring failures: ${stats.recurring}`);
        console.log('═══════════════════════════════════════════════════');
        console.log('');
        break;
      }

      case 'summary': {
        const limit = options.limit || 20;
        const summary = cache.getErrorSummary(limit);
        console.log(summary);
        break;
      }

      case 'clear': {
        console.log('');
        console.log('⚠️  This will delete all error logs from the database.');
        console.log('Are you sure? (This action cannot be undone)');
        console.log('');
        console.log('Run this command to confirm:');
        console.log('  pnpm errors clear --confirm');
        console.log('');

        if (args.includes('--confirm')) {
          cache.clearErrors();
          console.log('✅ All error logs cleared.');
          console.log('');
        }
        break;
      }

      case 'resolve': {
        const notionId = args[1];
        if (!notionId) {
          console.error('❌ Error: Please provide a Notion page ID');
          console.error('Usage: pnpm errors resolve <notion-page-id>');
          process.exit(1);
        }

        const errors = cache.getErrors({ notionId });
        if (errors.length === 0) {
          console.log('');
          console.log('ℹ️  No unresolved errors found for this page.');
          console.log('');
        } else {
          cache.resolveErrors(notionId);
          console.log('');
          console.log(`✅ Marked ${errors.length} error(s) as resolved for page: ${notionId}`);
          console.log('');
        }
        break;
      }

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('Run "pnpm errors help" for usage information.');
        process.exit(1);
    }
  } finally {
    cache.close();
  }
}

main();
