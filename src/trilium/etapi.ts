import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

/**
 * ETAPI client configuration
 */
interface ETAPIConfig {
  baseUrl: string;
  token: string;
}

let config: ETAPIConfig | null = null;

/**
 * Initializes the ETAPI client with configuration
 */
export function initETAPI(baseUrl: string, token: string): void {
  // Remove trailing slash from base URL
  const cleanUrl = baseUrl.replace(/\/$/, '');

  config = {
    baseUrl: cleanUrl,
    token,
  };

  logger.debug(`ETAPI initialized: ${cleanUrl}`);
}

/**
 * Gets the ETAPI base URL
 */
export function getETAPIBaseUrl(): string {
  if (!config) {
    throw new Error('ETAPI not initialized. Call initETAPI first.');
  }
  return config.baseUrl;
}

/**
 * Gets the ETAPI authorization header value
 */
export function getETAPIAuthHeader(): string {
  if (!config) {
    throw new Error('ETAPI not initialized. Call initETAPI first.');
  }
  const authString = Buffer.from(`etapi:${config.token}`).toString('base64');
  return `Basic ${authString}`;
}

/**
 * Makes an authenticated request to Trilium ETAPI
 */
export async function etapiRequest<T = any>(
  endpoint: string,
  options: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  if (!config) {
    throw new Error('ETAPI not initialized. Call initETAPI first.');
  }

  const { method = 'GET', body, headers = {} } = options;

  // Construct full URL
  const url = `${config.baseUrl}/etapi${endpoint}`;

  // Prepare authorization header (Basic auth with base64 encoded "etapi:token")
  const authString = Buffer.from(`etapi:${config.token}`).toString('base64');

  const requestHeaders: Record<string, string> = {
    Authorization: `Basic ${authString}`,
    'Content-Type': 'application/json',
    ...headers,
  };

  const requestOptions: any = {
    method,
    headers: requestHeaders,
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    requestOptions.body = JSON.stringify(body);
  }

  try {
    logger.debug(`${method} ${endpoint}`);

    const response = await fetch(url, requestOptions);

    // Handle different response types
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ETAPI request failed: ${response.status} ${response.statusText}. ${errorText}`
      );
    }

    // Empty responses
    if (response.status === 204 || !contentType) {
      return {} as T;
    }

    // JSON responses
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    // Text responses
    return (await response.text()) as T;
  } catch (error) {
    logger.error(`ETAPI request failed: ${method} ${endpoint}`, error);
    throw error;
  }
}

/**
 * Response types from ETAPI
 */
export interface ETAPINote {
  noteId: string;
  title: string;
  type: string;
  mime?: string;
}

export interface ETAPIBranch {
  branchId: string;
  noteId: string;
  parentNoteId: string;
  prefix?: string;
  notePosition?: number;
}
