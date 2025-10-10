# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**notion-to-trilium** - A TypeScript CLI tool to migrate notes from Notion to Trilium Notes. Fetches all Notion pages (with support for nested pages) and imports them into Trilium while preserving structure and formatting.

## Package Manager

This project uses **pnpm** (version 10.18.2) as specified in package.json. Always use `pnpm` commands instead of npm or yarn.

## Development Commands

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Run the CLI (requires .env configuration)
pnpm start

# Development mode with hot reload
pnpm dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

## Architecture

### Core Modules

**Configuration (`src/config/`):**
- `env.ts` - Environment variable validation using Zod schemas. Loads from `.env` file.
- Required vars: `NOTION_TOKEN`, `TRILIUM_URL`, `TRILIUM_TOKEN`
- Optional vars: `NOTION_ROOT_PAGE_ID`, `TRILIUM_PARENT_NOTE_ID`, `DRY_RUN`, `LOG_LEVEL`

**Notion Integration (`src/notion/`):**
- `client.ts` - Creates authenticated Notion client using `@notionhq/client`
- `fetcher.ts` - Fetches pages recursively from Notion API
  - `fetchAllPages()` - Main entry point, supports full workspace or specific page
  - `fetchPage()` - Fetches single page with all content blocks
  - `fetchBlocks()` - Recursively fetches nested blocks with pagination support
- `converter.ts` - Converts Notion blocks to HTML
  - `convertPageToHtml()` - Main conversion function
  - Supports: paragraphs, headings, lists, code blocks, images, tables, toggles, etc.
  - Handles rich text formatting (bold, italic, links, etc.)
  - Escapes HTML to prevent XSS
- `types.ts` - TypeScript interfaces for Notion data structures

**Trilium Integration (`src/trilium/`):**
- `etapi.ts` - ETAPI client for Trilium
  - `initETAPI()` - Initializes with base URL and token
  - `etapiRequest()` - Generic authenticated request helper
  - Uses Basic auth with base64 encoded "etapi:token"
- `importer.ts` - Imports notes into Trilium
  - `importPages()` - Main import function with progress tracking
  - `createNote()` - Creates individual notes with HTML content
  - `addNoteAttributes()` - Adds metadata (notionId, notionUrl, imported timestamp)
  - `testConnection()` - Validates Trilium connectivity

**Utilities (`src/utils/`):**
- `logger.ts` - Centralized logging with configurable levels
  - Supports: debug, info, warn, error levels
  - `progress()` method for import progress reporting

**Main Entry Point (`src/index.ts`):**
- CLI orchestration
- Validates configuration
- Tests connections
- Executes fetch → convert → import pipeline
- Displays formatted summary with statistics

## Data Flow

1. **Fetch**: Notion client → API → Pages with blocks
2. **Convert**: Notion blocks → HTML conversion
3. **Import**: HTML content → Trilium ETAPI → Notes with attributes

## Key Design Decisions

**Authentication:**
- Notion: Uses integration token with OAuth-style client
- Trilium: Uses ETAPI token with Basic auth (format: `etapi:{token}`)

**Content Format:**
- Converts Notion blocks to HTML (not markdown) because Trilium uses HTML internally
- Maintains structure with nested divs/lists for hierarchical content

**Error Handling:**
- Continues import on individual page failures
- Logs errors but doesn't halt entire process
- Returns statistics (successful/failed/skipped)

**Pagination:**
- Handles Notion API pagination for large workspaces
- Batch size: 100 items per request

**Type Safety:**
- Full TypeScript coverage
- Zod schemas for runtime validation
- Notion SDK types for API responses

## Testing Requirements

All new functions must have unit tests. Use console.debug (not console.log) for debugging output in JavaScript code.

Tests are in `tests/` directory:
- `converter.test.ts` - Tests Notion block to HTML conversion
- `logger.test.ts` - Tests logging functionality

When adding new block types or features:
1. Add conversion logic in `converter.ts`
2. Add test case in `converter.test.ts`
3. Test with actual Notion content if possible

## Environment Setup for Development

1. Copy `.env.example` to `.env`
2. Get Notion integration token from https://www.notion.so/my-integrations
3. Share Notion pages with your integration
4. Get Trilium ETAPI token from Options → ETAPI
5. Configure parent note ID if needed (defaults to 'root')
