# Notion to Trilium Notes Importer

A TypeScript-based CLI tool to migrate your notes from Notion to Trilium Notes. This tool fetches all your Notion pages (including nested pages) and imports them into your Trilium instance while preserving structure and formatting.

## Features

- 🔄 **Full Workspace Import** - Fetch all accessible pages from your Notion workspace
- 🎯 **Selective Import** - Import specific pages and their children
- 🏗️ **Structure Preservation** - Maintains parent-child relationships between notes
- 🎨 **Rich Content Support** - Converts Notion blocks to HTML with formatting, images, code blocks, and more
- 🔗 **Internal Link Resolution** - Automatically converts Notion internal links to Trilium note links
- ⚡ **Streaming Import** - Pages are imported to Trilium immediately as they're fetched from Notion
- 📊 **Progress Tracking** - Real-time progress reporting during import
- 🔍 **Dry Run Mode** - Preview what will be imported without making changes
- 🏷️ **Metadata Preservation** - Stores Notion IDs and URLs as Trilium attributes
- 💾 **Smart Caching** - SQLite-based cache to speed up subsequent runs by only importing new or modified notes
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

# Optional: Parent note ID in Trilium where imported notes will be created
# If not specified or set to 'root', a "Notion Import (YYYY-MM-DD)" folder will be created automatically
# TRILIUM_PARENT_NOTE_ID=root

# Import Options
DRY_RUN=false
STRUCTURE_ONLY=false
LOG_LEVEL=info
```

## Usage

### Basic Import

Import all accessible Notion pages:
```bash
pnpm start
```

By default, if you haven't specified a `TRILIUM_PARENT_NOTE_ID` in your `.env` file, the tool will automatically create a **"Notion Import (YYYY-MM-DD)"** folder in your Trilium root to keep all imported notes organized. You can move or rename this folder later in Trilium.

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

### Structure-Only Mode (Recommended for First Import)

**For your first import, it's highly recommended to use STRUCTURE_ONLY mode** to verify the hierarchy before filling in content:

```bash
# Set STRUCTURE_ONLY=true in .env, then run:
pnpm start
```

This will:
1. **Phase 1**: Scan all Notion pages and get their metadata
2. **Phase 2**: Create empty notes in Trilium with the correct hierarchy
3. **Stop** - Let you verify the structure in Trilium

After verifying the hierarchy looks correct:
```bash
# Set STRUCTURE_ONLY=false in .env, then run again:
pnpm start
```

This will:
- Skip Phase 1 & 2 (notes already exist with correct structure)
- **Phase 3**: Fill in the content for all notes and resolve internal links

**Why use this approach?**
- ✅ Verify parent-child relationships are correct before adding content
- ✅ Quickly see your entire Notion structure in Trilium
- ✅ Easy to reorganize or delete notes if needed before content is added
- ✅ Phase 3 is faster because structure already exists

### Import Specific Page

To import only a specific page and its children:
1. Get the page ID from Notion URL (e.g., `https://notion.so/My-Page-abc123def456`)
2. Set `NOTION_ROOT_PAGE_ID=abc123def456` in `.env`
3. **Important**: Make sure the page is shared with your integration (see Configuration section)
4. Run `pnpm start`

The tool will validate that the specified root page exists and is accessible before starting the import. If validation fails, you'll receive clear instructions on how to fix the issue.

### Three-Phase Import Architecture

The tool uses a **three-phase import architecture** that ensures perfect hierarchy preservation and working internal links:

**Phase 1: Scan Structure** 📊
- Quickly scans all Notion pages to get metadata (ID, title, parent relationships)
- Much faster than fetching full content
- Builds complete picture of your Notion workspace structure
- No content is fetched yet

**Phase 2: Rebuild Hierarchy** 🏗️
- Creates empty notes in Trilium with correct parent-child relationships
- Uses topological sort to ensure parents are created before children
- Builds mapping of Notion page IDs to Trilium note IDs
- All notes now exist with proper hierarchy

**Phase 3: Update Content** 📝
- Fetches full content from Notion for each page
- Converts Notion blocks to HTML
- Resolves all internal links using the complete page mapping
- Updates each Trilium note with its content

**Benefits of this approach:**
- ✅ **Perfect hierarchy preservation** - Parents always exist before children
- ✅ **Working internal links** - All target notes exist when links are resolved
- ✅ **Clear progress tracking** - See exactly which phase you're in
- ✅ **Better error recovery** - Structure is preserved even if content updates fail
- ✅ **Efficient** - Metadata scanning is much faster than full content fetching

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

### Error Logging and Tracking

The tool automatically logs all import errors to the cache database for later analysis. When pages fail to import, you'll see:

1. **Real-time error display** in the console during import
2. **Error summary** at the end if any imports failed
3. **Persistent error logs** stored in the `.notion-cache.db` database

**View Error Logs**:
```bash
# List all unresolved errors
pnpm errors list

# Show error statistics
pnpm errors stats

# Show detailed error summary with recent errors
pnpm errors summary

# Filter errors by phase (fetch, convert, or import)
pnpm errors list --phase import --limit 20

# Mark errors for a specific page as resolved
pnpm errors resolve <notion-page-id>

# Clear all error logs
pnpm errors clear --confirm
```

**Error Information Tracked**:
- Notion page ID and title
- Error message and stack trace
- Phase where error occurred (fetch, convert, or import)
- Timestamp
- Retry count (for recurring errors)

**Common Use Cases**:
- **Identify problematic pages**: Find which specific pages are failing to import
- **Analyze error patterns**: See if errors are concentrated in specific phases
- **Retry imports**: After fixing issues, re-run the import and previously failed pages will be retried
- **Track progress**: Monitor which errors get resolved over time

Errors are automatically marked as resolved when a page successfully imports on a subsequent run.

### Internal Link Resolution

The tool automatically converts **Notion internal links** to **Trilium internal links**, preserving your note references across the migration.

**How it works**:
1. As pages are imported, the tool builds a mapping of Notion page IDs to Trilium note IDs
2. When converting content, any links to other Notion pages are detected
3. These links are automatically converted to Trilium's internal link format (`#!noteId`)
4. Links to pages that aren't being imported remain as external Notion URLs

**Supported link formats**:
- Standard Notion URLs: `https://www.notion.so/Page-Title-abc123...`
- Workspace URLs: `https://www.notion.so/workspace/Page-Title-abc123...`
- Links with or without dashes in the page ID
- Links in all content types (paragraphs, headings, lists, tables, etc.)

**Example**:
- **Before**: `<a href="https://www.notion.so/My-Doc-abc123...">Link to doc</a>`
- **After**: `<a href="#!trilium-note-456">Link to doc</a>`

**Limitations**:
- Only links to pages that are part of the import will be converted
- Links to pages outside the import scope remain as external Notion URLs
- Notion database views and advanced database links are preserved as external links

**Tips for best results**:
- Import all related pages together to maximize internal link conversion
- When using `NOTION_ROOT_PAGE_ID`, ensure all linked pages are children of that root
- Use `LOG_LEVEL=debug` to see link resolution details

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
│   ├── fetcher.test.ts      # Fetcher and validation tests
│   ├── importer.test.ts     # Importer and validation tests
│   └── logger.test.ts       # Logger tests
├── .env.example             # Example environment file
├── .notion-cache.db         # SQLite cache (auto-generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Supported Notion Block Types

The following Notion block types are supported and converted to HTML:

- ✅ Paragraphs with rich text (bold, italic, underline, strikethrough, code)
- ✅ Links (external URLs and internal page links with automatic resolution)
- ✅ Headings (H1, H2, H3)
- ✅ Lists (bulleted, numbered)
- ✅ To-do items with checkboxes
- ✅ Code blocks with syntax highlighting
- ✅ Quotes
- ✅ Callouts
- ✅ Images
- ✅ Files and attachments
- ✅ Bookmarks and embeds
- ✅ Tables (including links in cells)
- ✅ Toggles/collapsible content
- ✅ Dividers

## Troubleshooting

### Root page not found or inaccessible

**Issue**: "The specified root page does not exist or is not accessible"

This error occurs when you specify a `NOTION_ROOT_PAGE_ID` that either doesn't exist or your integration can't access.

**Solutions**:
1. **Verify the page ID**: Check that the page ID in your `.env` file is correct
   - Copy the page URL from Notion (e.g., `https://notion.so/My-Page-abc123def456`)
   - The page ID is the last part: `abc123def456`
2. **Grant integration access**: The page must be shared with your Notion integration
   - Open the page in Notion
   - Click the "..." menu in the top right
   - Select "Add connections"
   - Choose your integration from the list
3. **Check the page exists**: Make sure the page hasn't been deleted or moved
4. **Verify token permissions**: Ensure your `NOTION_TOKEN` has "Read content" capability

**Note**: The tool validates the root page before starting the import to provide early feedback. This helps you fix access issues before spending time on a failed import.

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

### Trilium parent note not found or inaccessible

**Issue**: "The specified Trilium parent note does not exist or is not accessible"

This error occurs when you specify a `TRILIUM_PARENT_NOTE_ID` that either doesn't exist or is not accessible in your Trilium instance.

**Interactive Recovery**: When validation fails, the tool will present you with interactive options:

1. **Create a new parent note automatically** - The tool can create a new note in Trilium for you
   - You'll be prompted to enter a title (default: "Imported from Notion")
   - The note will be created under the root note
   - The import will proceed with the newly created note

2. **Enter a different parent note ID** - Provide an existing note ID
   - Find the note in Trilium
   - Right-click → "Note info" → Copy the Note ID
   - Paste it when prompted

3. **Use "root" as the parent note** - Import directly to the root of your note tree

4. **Exit and create manually** - Exit the tool and create the note yourself
   - Create the note in Trilium
   - Update `TRILIUM_PARENT_NOTE_ID` in your `.env` file
   - Run the import again

**Note**: The tool validates the parent note before starting the import and provides interactive recovery options. This prevents wasting time on imports that would fail due to an invalid parent note.

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
- Run `pnpm errors list --phase convert` to see conversion errors
- File an issue with example block type that's not converting correctly

### Analyzing Import Errors

If you're experiencing many import errors, especially with nested notes:

1. **Check error statistics**:
   ```bash
   pnpm errors stats
   ```

2. **View detailed error logs**:
   ```bash
   pnpm errors summary
   ```

3. **Filter by error type**:
   ```bash
   # See only import errors
   pnpm errors list --phase import

   # See only fetch errors
   pnpm errors list --phase fetch
   ```

4. **Investigate specific pages**:
   - Note the Notion page IDs from the error logs
   - Check those pages in Notion for unusual content or formatting
   - Look for patterns (e.g., all errors in pages with certain block types)

5. **Query the database directly**:
   ```bash
   sqlite3 .notion-cache.db "SELECT * FROM import_errors WHERE resolved = 0 ORDER BY timestamp DESC LIMIT 10;"
   ```

The error logging system helps you understand exactly which pages are failing and why, making it easier to fix issues and retry imports.

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
