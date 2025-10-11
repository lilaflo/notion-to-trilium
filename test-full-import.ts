#!/usr/bin/env tsx

/**
 * Test script to verify full fetch + convert pipeline
 * Run with: npx @dotenvx/dotenvx run -- npx tsx test-full-import.ts
 */

import { Client } from '@notionhq/client';
import { fetchPageContent } from './src/notion/fetcher.js';
import { convertPageToHtml } from './src/notion/converter.js';
import { NotionPage } from './src/notion/types.js';

const NOTION_PAGE_ID = '1e0d95b0-34a2-803d-9fa5-f79cd4e5be00';

async function testFullImport() {
  console.log('='.repeat(60));
  console.log('Testing Full Import Pipeline');
  console.log('='.repeat(60));
  console.log('');

  // Check environment variables
  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) {
    console.error('❌ ERROR: NOTION_TOKEN not found in environment');
    console.error('Make sure to run with: npx @dotenvx/dotenvx run -- npx tsx test-full-import.ts');
    process.exit(1);
  }

  console.log('✅ NOTION_TOKEN found');
  console.log(`Testing page ID: ${NOTION_PAGE_ID}`);
  console.log('');

  // Initialize Notion client
  const notion = new Client({
    auth: notionToken,
  });

  try {
    // Step 1: Fetch page metadata
    console.log('Step 1: Fetching page metadata...');
    console.log('-'.repeat(60));

    const page = await notion.pages.retrieve({ page_id: NOTION_PAGE_ID });
    console.log(`✅ Page retrieved`);
    console.log(`Page ID: ${page.id}`);

    // Extract title
    let title = 'Untitled';
    if ('properties' in page) {
      const properties = page.properties;
      for (const [key, prop] of Object.entries(properties)) {
        if (prop.type === 'title' && 'title' in prop) {
          title = prop.title.map((t: any) => t.plain_text || '').join('');
          console.log(`Page title: ${title}`);
        }
      }
    }
    console.log('');

    // Step 2: Fetch content using our fetcher
    console.log('Step 2: Fetching content using our fetcher...');
    console.log('-'.repeat(60));

    const startFetch = Date.now();
    const content = await fetchPageContent(notion, NOTION_PAGE_ID);
    const fetchTime = Date.now() - startFetch;

    console.log(`✅ Content fetched in ${fetchTime}ms`);
    console.log(`Content type: ${typeof content}`);
    console.log(`Content is array: ${Array.isArray(content)}`);
    console.log(`Number of blocks: ${content?.length || 0}`);

    if (!content || content.length === 0) {
      console.error('❌ ERROR: No content returned from fetcher');
      process.exit(1);
    }

    console.log('');
    console.log('Block structure:');
    content.forEach((block: any, index: number) => {
      const childCount = block.children?.length || 0;
      console.log(`  ${index + 1}. ${block.type} (children: ${childCount})`);
    });
    console.log('');

    // Step 3: Convert to HTML using our converter
    console.log('Step 3: Converting to HTML...');
    console.log('-'.repeat(60));

    const notionPage: NotionPage = {
      id: NOTION_PAGE_ID,
      title: title,
      content: content,
      parent: { type: 'page_id', page_id: 'root' },
      url: `https://notion.so/${NOTION_PAGE_ID}`,
      createdTime: new Date().toISOString(),
      lastEditedTime: new Date().toISOString(),
    };

    const startConvert = Date.now();
    const html = convertPageToHtml(notionPage, new Map());
    const convertTime = Date.now() - startConvert;

    console.log(`✅ Converted in ${convertTime}ms`);
    console.log(`HTML type: ${typeof html}`);
    console.log(`HTML length: ${html?.length || 0} characters`);

    if (!html || typeof html !== 'string') {
      console.error('❌ ERROR: Invalid HTML returned from converter');
      console.error(`  Type: ${typeof html}`);
      console.error(`  Value: ${JSON.stringify(html)?.substring(0, 200)}`);
      process.exit(1);
    }

    if (html.trim().length === 0) {
      console.error('❌ ERROR: Empty HTML returned from converter');
      process.exit(1);
    }

    console.log('');
    console.log('HTML preview (first 500 chars):');
    console.log('-'.repeat(60));
    console.log(html.substring(0, 500));
    console.log('...');
    console.log('');

    // Step 4: Validate HTML structure
    console.log('Step 4: Validating HTML structure...');
    console.log('-'.repeat(60));

    const hasOpeningDiv = html.includes('<div');
    const hasClosingDiv = html.includes('</div>');
    const hasContent = html.length > 50;

    console.log(`✅ Has opening div: ${hasOpeningDiv}`);
    console.log(`✅ Has closing div: ${hasClosingDiv}`);
    console.log(`✅ Has substantial content: ${hasContent}`);

    if (!hasOpeningDiv || !hasClosingDiv || !hasContent) {
      console.error('❌ ERROR: HTML structure appears invalid');
      process.exit(1);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ Full import pipeline test PASSED');
    console.log('='.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log(`  Fetch time:   ${fetchTime}ms`);
    console.log(`  Convert time: ${convertTime}ms`);
    console.log(`  Total time:   ${fetchTime + convertTime}ms`);
    console.log(`  Block count:  ${content.length}`);
    console.log(`  HTML length:  ${html.length} chars`);

  } catch (error: any) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ Test FAILED');
    console.error('='.repeat(60));
    console.error('');
    console.error('Error:', error.message);

    if (error.code) {
      console.error('Code:', error.code);
    }
    if (error.status) {
      console.error('Status:', error.status);
    }
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

testFullImport();
