import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables
config();

// Define environment schema with validation
// Note: DRY_RUN, STRUCTURE_ONLY, LOG_LEVEL, and NOTION_ROOT_PAGE_ID are now CLI options
const envSchema = z.object({
  NOTION_TOKEN: z.string().min(1, 'NOTION_TOKEN is required'),

  TRILIUM_URL: z.string().url('TRILIUM_URL must be a valid URL'),
  TRILIUM_TOKEN: z.string().min(1, 'TRILIUM_TOKEN is required'),
  TRILIUM_PARENT_NOTE_ID: z.string().optional().default('root'),
});

/**
 * Zod schema for CLI options validation
 */
const cliOptionsSchema = z.object({
  rootPageId: z.string().optional(),
  triliumParentNoteId: z.string().optional(),
  dryRun: z.boolean().optional(),
  structureOnly: z.boolean().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

/**
 * CLI options that can override environment variables
 */
export type CLIOptions = z.infer<typeof cliOptionsSchema>;

/**
 * Combined configuration from environment and CLI options
 */
export interface Config {
  NOTION_TOKEN: string;
  NOTION_ROOT_PAGE_ID?: string;

  TRILIUM_URL: string;
  TRILIUM_TOKEN: string;
  TRILIUM_PARENT_NOTE_ID: string;

  DRY_RUN: boolean;
  STRUCTURE_ONLY: boolean;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Validates and returns the environment configuration with CLI overrides
 */
export function getConfig(cliOptions: CLIOptions = {}): Config {
  try {
    // Validate environment variables
    const env = envSchema.parse(process.env);

    // Validate CLI options
    const validatedCliOptions = cliOptionsSchema.parse(cliOptions);

    // Merge environment variables with CLI options (CLI takes precedence)
    return {
      NOTION_TOKEN: env.NOTION_TOKEN,
      NOTION_ROOT_PAGE_ID: validatedCliOptions.rootPageId,

      TRILIUM_URL: env.TRILIUM_URL,
      TRILIUM_TOKEN: env.TRILIUM_TOKEN,
      TRILIUM_PARENT_NOTE_ID: validatedCliOptions.triliumParentNoteId ?? env.TRILIUM_PARENT_NOTE_ID,

      DRY_RUN: validatedCliOptions.dryRun ?? false,
      STRUCTURE_ONLY: validatedCliOptions.structureOnly ?? false,
      LOG_LEVEL: validatedCliOptions.logLevel ?? 'info',
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration error:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\n💡 Please check your .env file and CLI arguments');
      console.error('💡 Required environment variables: NOTION_TOKEN, TRILIUM_URL, TRILIUM_TOKEN');
      console.error('💡 Use --help to see available CLI options');
      process.exit(1);
    }
    throw error;
  }
}
