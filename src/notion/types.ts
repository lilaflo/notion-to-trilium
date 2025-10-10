/**
 * Represents a Notion page with its content
 */
export interface NotionPage {
  id: string;
  title: string;
  content: NotionBlock[];
  parentId: string | null;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  icon?: string;
  cover?: string;
}

/**
 * Represents Notion page metadata without content
 * Used in Phase 1 (scan) to quickly map the structure
 */
export interface NotionPageMetadata {
  id: string;
  title: string;
  parentId: string | null;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  icon?: string;
  cover?: string;
}

/**
 * Simplified representation of Notion blocks
 */
export interface NotionBlock {
  id: string;
  type: string;
  content: unknown;
  hasChildren: boolean;
  children?: NotionBlock[];
}

/**
 * Progress statistics for the fetching process
 */
export interface FetchProgress {
  pagesProcessed: number;
  totalPages: number;
  currentPage: string;
}
