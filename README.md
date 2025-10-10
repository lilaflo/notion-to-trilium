# Notion to Trilium Notes Importer

A TypeScript-based CLI tool to migrate your notes from Notion to Trilium Notes. This tool fetches all your Notion pages (including nested pages) and imports them into your Trilium instance while preserving structure and formatting.

## Features

- 🔄 **Full Workspace Import** - Fetch all accessible pages from your Notion workspace
- 🎯 **Selective Import** - Import specific pages and their children
- 🏗️ **Structure Preservation** - Maintains parent-child relationships between notes
- 🎨 **Rich Content Support** - Converts Notion blocks to HTML with formatting, images, code blocks, and more
- 📊 **Progress Tracking** - Real-time progress reporting during import
- 🔍 **Dry Run Mode** - Preview what will be imported without making changes
- 🏷️ **Metadata Preservation** - Stores Notion IDs and URLs as Trilium attributes
- ⚡ **Smart Caching** - SQLite-based cache to speed up subsequent runs by only importing new or modified notes
- 🔄 **Change Detection** - Automatically detects modified notes based on last edited timestamps
- ✅ **Type-Safe** - Written in TypeScript with full type coverage
- 🧪 **Well Tested** - Comprehensive unit tests for core functionality

## Prerequisites

- Node.js >= 18.0.0
- pnpm (v10.18.2+)
- A Notion workspace with integration access
- A Trilium Notes instance with ETAPI enabled

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd notion-to-trilium
```

2. Install dependencies:
```bash
pnpm install
```

3. Build the project:
```bash
pnpm build
```

## Configuration

### 1. Create Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "Trilium Import")
4. Copy the "Internal Integration Token"
5. **Important**: Share the pages you want to import with your integration:
   - Open each page in Notion
   - Click "Share" in the top right
   - Invite your integration

### 2. Get Trilium ETAPI Token

1. Open your Trilium instance
2. Go to Options (Ctrl+O or Cmd+O)
3. Navigate to "ETAPI" section
4. Create a new ETAPI token or copy an existing one

### 3. Configure Environment Variables

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```bash
# Notion Configuration
NOTION_TOKEN=your_notion_integration_token_here

# Optional: Import only a specific page and its children
# NOTION_ROOT_PAGE_ID=abc123def456

# Trilium Configuration
TRILIUM_URL=http://localhost:8080
TRILIUM_TOKEN=your_trilium_etapi_token_here

# Optional: Parent note where imported notes will be created
# TRILIUM_PARENT_NOTE_ID=root

# Import Options
DRY_RUN=false
LOG_LEVEL=info
```

## Usage

### Basic Import

Import all accessible Notion pages:
```bash
pnpm start
```

Or using the dev script (with hot reload):
```bash
pnpm dev
```

### Dry Run

Preview what will be imported without making changes:
```bash
# Set DRY_RUN=true in .env, then run:
pnpm start
```

### Import Specific Page

To import only a specific page and its children:
1. Get the page ID from Notion URL (e.g., `https://notion.so/My-Page-abc123def456`)
2. Set `NOTION_ROOT_PAGE_ID=abc123def456` in `.env`
3. Run `pnpm start`

### Incremental/Subsequent Imports

The tool uses a local SQLite cache (`.notion-cache.db`) to track imported notes. On subsequent runs:

- **New notes** are automatically imported
- **Modified notes** (based on Notion's `last_edited_time`) are re-imported
- **Unchanged notes** are skipped, significantly speeding up the process

The cache is automatically created and updated with each import. The first import will be slower, but subsequent runs will only process changed or new notes.

**Cache Statistics**: On startup, you'll see cache statistics showing:
- Total pages tracked
- Number of imported pages
- Number of pending pages

### Log Levels

Adjust `LOG_LEVEL` in `.env`:
- `debug` - Verbose output including all API calls and cache operations
- `info` - Standard progress information (default)
- `warn` - Warnings and errors only
- `error` - Errors only

## Development

### Run Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Project Structure

```
notion-to-trilium/
├── src/
│   ├── cache/
│   │   └── index.ts         # SQLite cache for tracking imports
│   ├── config/
│   │   └── env.ts           # Environment configuration
│   ├── notion/
│   │   ├── client.ts        # Notion API client
│   │   ├── fetcher.ts       # Fetch pages and content
│   │   ├── converter.ts     # Convert blocks to HTML
│   │   └── types.ts         # TypeScript types
│   ├── trilium/
│   │   ├── etapi.ts         # ETAPI helper functions
│   │   └── importer.ts      # Import logic
│   ├── utils/
│   │   └── logger.ts        # Logging utilities
│   └── index.ts             # Main entry point
├── tests/
│   ├── cache.test.ts        # Cache module tests
│   ├── converter.test.ts    # Converter tests
│   └── logger.test.ts       # Logger tests
├── .env.example             # Example environment file
├── .notion-cache.db         # SQLite cache (auto-generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Supported Notion Block Types

The following Notion block types are supported and converted to HTML:

- ✅ Paragraphs with rich text (bold, italic, underline, strikethrough, code, links)
- ✅ Headings (H1, H2, H3)
- ✅ Lists (bulleted, numbered)
- ✅ To-do items with checkboxes
- ✅ Code blocks with syntax highlighting
- ✅ Quotes
- ✅ Callouts
- ✅ Images
- ✅ Files and attachments
- ✅ Bookmarks and embeds
- ✅ Tables
- ✅ Toggles/collapsible content
- ✅ Dividers

## Troubleshooting

### No pages found

**Issue**: "No pages found to import"

**Solutions**:
- Make sure you've shared pages with your Notion integration
- Check that your `NOTION_TOKEN` is correct
- Verify your integration has "Read content" permission

### Trilium connection failed

**Issue**: "Failed to connect to Trilium"

**Solutions**:
- Verify your Trilium instance is running
- Check that `TRILIUM_URL` is correct
- Ensure ETAPI is enabled in Trilium options
- Verify your `TRILIUM_TOKEN` is valid

### Import is slow

**Solutions**:
- The Notion API has rate limits - this is normal for large workspaces on first import
- Subsequent imports will be much faster thanks to the cache - only new/modified notes are processed
- Consider using `NOTION_ROOT_PAGE_ID` to import specific pages
- Use `LOG_LEVEL=debug` to see detailed progress

### Cache-related issues

**Issue**: Cache is not detecting changes or skipping notes incorrectly

**Solutions**:
- Delete `.notion-cache.db` to force a full re-import
- Check that Notion's `last_edited_time` is being updated (some changes may not update this field)
- Use `LOG_LEVEL=debug` to see cache operations

**Issue**: Want to force re-import all notes

**Solutions**:
- Simply delete the `.notion-cache.db` file and run the import again
- The cache will be rebuilt automatically

### Some blocks not converting correctly

The converter handles most common Notion block types. If you encounter issues:
- Check the console output for warnings about unsupported block types
- File an issue with example block type that's not converting correctly

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass: `pnpm test`
5. Submit a pull request

## License

ISC License - see LICENSE file for details

## Acknowledgments

- Built with [@notionhq/client](https://github.com/makenotion/notion-sdk-js) - Official Notion JavaScript SDK
- Trilium ETAPI documentation and implementation patterns from [trilium-mcp](https://github.com/lilaflo/trilium-mcp)

## Support

For issues, questions, or contributions, please open an issue on GitHub.
