import { Client } from '@notionhq/client';
import { logger } from '../utils/logger.js';

/**
 * Creates and returns an authenticated Notion client
 */
export function createNotionClient(token: string): Client {
  logger.debug('Initializing Notion client');
  return new Client({ auth: token });
}
