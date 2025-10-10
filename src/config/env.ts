import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables
config();

// Define environment schema with validation
const envSchema = z.object({
  NOTION_TOKEN: z.string().min(1, 'NOTION_TOKEN is required'),
  NOTION_ROOT_PAGE_ID: z.string().optional(),

  TRILIUM_URL: z.string().url('TRILIUM_URL must be a valid URL'),
  TRILIUM_TOKEN: z.string().min(1, 'TRILIUM_TOKEN is required'),
  TRILIUM_PARENT_NOTE_ID: z.string().optional().default('root'),

  DRY_RUN: z.string().optional().default('false').transform(val => val === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().default('info'),
});

export type Environment = z.infer<typeof envSchema>;

/**
 * Validates and returns the environment configuration
 */
export function getConfig(): Environment {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment configuration error:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\n💡 Please check your .env file against .env.example');
      process.exit(1);
    }
    throw error;
  }
}
