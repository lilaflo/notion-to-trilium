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
