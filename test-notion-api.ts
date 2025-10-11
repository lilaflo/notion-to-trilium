#!/usr/bin/env tsx

/**
 * Test script to verify Notion API access and content fetching
 * Run with: npx dotenvx run -- npx tsx test-notion-api.ts
 */

import { Client } from '@notionhq/client';

const NOTION_PAGE_ID = '1e0d95b0-34a2-803d-9fa5-f79cd4e5be00';

async function testNotionAPI() {
  console.log('='.repeat(60));
  console.log('Testing Notion API');
  console.log('='.repeat(60));
  console.log('');

  // Check environment variables
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) {
    console.error('❌ ERROR: NOTION_TOKEN not found in environment');
    console.error('Make sure to run with: npx dotenvx run -- npx tsx test-notion-api.ts');
    process.exit(1);
  }

  console.log('✅ NOTION_TOKEN found');
  console.log(`Testing with page ID: ${NOTION_PAGE_ID}`);
  console.log('');

  // Initialize Notion client
  const notion = new Client({
    auth: notionToken,
  });

  try {
    // Test 1: Retrieve page metadata
    console.log('Test 1: Retrieving page metadata...');
    console.log('-'.repeat(60));

    const startPage = Date.now();
    const page = await notion.pages.retrieve({ page_id: NOTION_PAGE_ID });
    const pageTime = Date.now() - startPage;

    console.log(`✅ Page retrieved in ${pageTime}ms`);
    console.log(`Page object type: ${page.object}`);
    console.log(`Page ID: ${page.id}`);

    // Extract title
    if ('properties' in page) {
      const properties = page.properties;
      for (const [key, prop] of Object.entries(properties)) {
        if (prop.type === 'title' && 'title' in prop) {
          const title = prop.title.map((t: any) => t.plain_text || '').join('');
          console.log(`Page title: ${title}`);
        }
      }
    }
    console.log('');

    // Test 2: Fetch first page of blocks (without recursion)
    console.log('Test 2: Fetching first page of blocks...');
    console.log('-'.repeat(60));

    const startBlocks = Date.now();
    const response = await notion.blocks.children.list({
      block_id: NOTION_PAGE_ID,
      page_size: 10,
    });
    const blocksTime = Date.now() - startBlocks;

    console.log(`✅ Blocks fetched in ${blocksTime}ms`);
    console.log(`Number of blocks: ${response.results.length}`);
    console.log(`Has more blocks: ${response.has_more}`);
    console.log('');

    // Show block types
    console.log('Block types:');
    response.results.forEach((block: any, index: number) => {
      console.log(`  ${index + 1}. ${block.type} (has_children: ${block.has_children})`);
    });
    console.log('');

    // Test 3: Try fetching ALL blocks with timeout
    console.log('Test 3: Fetching ALL blocks (with timeout)...');
    console.log('-'.repeat(60));
    console.log('This will timeout after 15 seconds to prevent hanging...');

    const fetchAllWithTimeout = async (blockId: string, timeoutMs: number = 15000) => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      });

      const fetchPromise = (async () => {
        let allBlocks: any[] = [];
        let hasMore = true;
        let cursor: string | undefined;
        let pageCount = 0;

        while (hasMore) {
          const start = Date.now();
          const resp = await notion.blocks.children.list({
            block_id: blockId,
            start_cursor: cursor,
            page_size: 100,
          });
          const elapsed = Date.now() - start;

          pageCount++;
          console.log(`  Page ${pageCount}: ${resp.results.length} blocks (${elapsed}ms)`);

          allBlocks.push(...resp.results);
          hasMore = resp.has_more;
          cursor = resp.next_cursor || undefined;

          if (hasMore && !cursor) {
            console.log('  ⚠️  has_more is true but no next_cursor - stopping');
            break;
          }
        }

        return allBlocks;
      })();

      return Promise.race([fetchPromise, timeoutPromise]);
    };

    try {
      const startAll = Date.now();
      const allBlocks = await fetchAllWithTimeout(NOTION_PAGE_ID);
      const allTime = Date.now() - startAll;

      console.log(`✅ All blocks fetched in ${allTime}ms`);
      console.log(`Total blocks: ${allBlocks.length}`);
      console.log('');

      // Count blocks with children
      const blocksWithChildren = allBlocks.filter((b: any) => b.has_children).length;
      console.log(`Blocks with children: ${blocksWithChildren}`);

      if (blocksWithChildren > 0) {
        console.log('⚠️  This page has nested blocks - recursive fetching needed');
      }

    } catch (error: any) {
      if (error.message === 'TIMEOUT') {
        console.log('❌ TIMEOUT: Fetching all blocks took longer than 15 seconds');
        console.log('This indicates the page has MANY blocks or deeply nested structure');
      } else {
        throw error;
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ Test completed successfully');
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ Test failed');
    console.error('='.repeat(60));
    console.error('');
    console.error('Error:', error.message);

    if (error.code) {
      console.error('Code:', error.code);
    }
    if (error.status) {
      console.error('Status:', error.status);
    }

    console.error('');
    console.error('Full error:');
    console.error(error);

    process.exit(1);
  }
}

testNotionAPI();
