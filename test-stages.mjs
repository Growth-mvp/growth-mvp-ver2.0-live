import fetch from 'node:fetch';
import { setTimeout } from 'node:timers/promises';

const BASE_URL = 'http://localhost:3000';
const results = {
  screens: {},
  errors: []
};

async function checkUrl(path, description) {
  try {
    console.log(`\n[TEST] ${description}`);
    const response = await fetch(`${BASE_URL}${path}`);
    const html = await response.text();

    // Check for specific elements
    const hasConsoleErrors = html.includes('console.error') || html.includes('__NEXT_DATA__');

    results.screens[description] = {
      status: response.ok ? 'OK' : 'NG',
      statusCode: response.status,
      hasContent: html.length > 100,
      htmlSize: html.length
    };

    console.log(`  Status: ${response.status}`);
    console.log(`  Content size: ${html.length} bytes`);

    // Look for common error patterns
    if (html.includes('Error') || html.includes('error')) {
      console.log('  ⚠️  Contains "error" text');
    }

    return {
      ok: response.ok,
      html: html.substring(0, 500)
    };
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    results.screens[description] = {
      status: 'NG',
      error: error.message
    };
    return { ok: false, html: null };
  }
}

async function testAllRoutes() {
  console.log('=== Growth MVP - STAGE1-4 Testing ===\n');
  console.log(`Testing: ${BASE_URL}`);
  console.log('Waiting for server to be ready...\n');

  // Test root
  await checkUrl('/', 'Root page (/)');

  // Test common stage routes
  await checkUrl('/stage1', 'STAGE1 (/stage1)');
  await checkUrl('/stage2', 'STAGE2 (/stage2)');
  await checkUrl('/stage3', 'STAGE3 (/stage3)');
  await checkUrl('/stage4', 'STAGE4 (/stage4)');

  // Test cascade/okr variants
  await checkUrl('/cascade', 'Cascade (/cascade)');
  await checkUrl('/okr', 'OKR (/okr)');

  // Test auth routes
  await checkUrl('/auth/signin', 'Sign In (/auth/signin)');
  await checkUrl('/auth/callback', 'Auth Callback (/auth/callback)');

  // Print summary
  console.log('\n\n=== TEST SUMMARY ===\n');
  for (const [name, result] of Object.entries(results.screens)) {
    const status = result.status === 'OK' ? '✓' : '✗';
    console.log(`${status} ${name}: ${result.status} (${result.statusCode || 'N/A'})`);
  }
}

// Run tests
await testAllRoutes().catch(console.error);
