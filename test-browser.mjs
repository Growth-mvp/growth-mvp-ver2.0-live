import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3004';
const screenshotDir = './test-screenshots';

// Create screenshot directory
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

const testResults = {
  timestamp: new Date().toISOString(),
  results: []
};

async function testPage(url, pageTitle) {
  let browser = null;
  let context = null;
  let page = null;

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log(`${'='.repeat(60)}`);

    browser = await chromium.launch();
    context = await browser.newContext();
    page = await context.newPage();

    // Collect console messages
    const consoleLogs = { log: [], error: [], warn: [] };
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warn') {
        consoleLogs[type].push(msg.text());
      }
    });

    // Collect page crashes
    let pageCrashed = false;
    page.on('crash', () => {
      pageCrashed = true;
      console.error('❌ Page crashed!');
    });

    // Load page
    console.log('🔄 Loading page...');
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    const statusCode = response.status();
    console.log(`✓ Status: ${statusCode}`);

    // Get page content
    const title = await page.title();
    console.log(`✓ Title: ${title}`);

    // Screenshot
    const screenshotPath = path.join(screenshotDir, `${pageTitle}-1-initial.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved: ${screenshotPath}`);

    // Check for content
    const bodyText = await page.textContent('body');
    const isWhiteScreen = !bodyText || bodyText.trim().length < 20;
    console.log(`\n1️⃣  White screen check: ${isWhiteScreen ? '❌ WHITE SCREEN' : '✓ Content rendered'}`);

    // Console errors
    console.log(`\n2️⃣  Console errors: ${consoleLogs.error.length > 0 ? '❌ ERRORS FOUND' : '✓ No errors'}`);
    if (consoleLogs.error.length > 0) {
      consoleLogs.error.slice(0, 3).forEach(err => console.log(`   ❌ ${err.substring(0, 80)}`));
    }

    // Check for main headings and buttons
    console.log(`\n3️⃣  Main elements check:`);
    const h1Count = await page.locator('h1').count();
    const h2Count = await page.locator('h2').count();
    const buttonCount = await page.locator('button').count();
    const linkCount = await page.locator('a').count();

    console.log(`   - H1 elements: ${h1Count > 0 ? `✓ ${h1Count}` : '❌ 0'}`);
    console.log(`   - H2 elements: ${h2Count > 0 ? `✓ ${h2Count}` : '❌ 0'}`);
    console.log(`   - Buttons: ${buttonCount > 0 ? `✓ ${buttonCount}` : '❌ 0'}`);
    console.log(`   - Links: ${linkCount > 0 ? `✓ ${linkCount}` : '❌ 0'}`);

    // Check button interactivity
    console.log(`\n4️⃣  Button interaction check:`);
    const buttons = page.locator('button');
    let visibleButtonCount = 0;

    for (let i = 0; i < Math.min(3, buttonCount); i++) {
      try {
        const isVisible = await buttons.nth(i).isVisible();
        if (isVisible) {
          visibleButtonCount++;
          const text = await buttons.nth(i).textContent();
          console.log(`   Button ${i + 1}: "${text?.trim()?.substring(0, 30)}..." ✓`);
        }
      } catch (e) {
        // Button may not be available
      }
    }
    console.log(`   ${visibleButtonCount > 0 ? `✓ ${visibleButtonCount} visible button(s)` : '⚠️  No visible buttons'}`);

    // Reload test
    console.log(`\n5️⃣  Page reload check:`);
    try {
      await page.reload({ waitUntil: 'networkidle' });
      const reloadContent = await page.textContent('body');
      const reloadIsOk = reloadContent && reloadContent.trim().length > 20 && !pageCrashed;
      console.log(`   ${reloadIsOk ? '✓ Page reloaded successfully' : '❌ Page crashed on reload'}`);

      // Screenshot after reload
      const reloadScreenshot = path.join(screenshotDir, `${pageTitle}-2-reload.png`);
      await page.screenshot({ path: reloadScreenshot, fullPage: true });
      console.log(`📸 Reload screenshot: ${reloadScreenshot}`);
    } catch (e) {
      console.log(`   ❌ Reload failed: ${e.message.substring(0, 60)}`);
    }

    // Results
    const result = {
      url,
      pageTitle,
      statusCode,
      title,
      whiteScreen: isWhiteScreen,
      consoleErrors: consoleLogs.error.length,
      hasHeadings: h1Count > 0 || h2Count > 0,
      buttonCount,
      linkCount,
      reloadOk: !pageCrashed,
      pageCrashed
    };

    testResults.results.push(result);

    console.log(`\n📋 Summary for ${pageTitle}:`);
    console.log(`   - White screen: ${isWhiteScreen ? '❌' : '✓'}`);
    console.log(`   - Console errors: ${consoleLogs.error.length}`);
    console.log(`   - Headings present: ${result.hasHeadings ? '✓' : '❌'}`);
    console.log(`   - Buttons: ${result.buttonCount}`);
    console.log(`   - Page crashed: ${pageCrashed ? '❌' : '✓'}`);

  } catch (error) {
    console.error(`\n❌ Test failed for ${url}:`);
    console.error(error.message.substring(0, 100));
    testResults.results.push({
      url,
      pageTitle,
      error: error.message
    });
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

async function checkAuthSignInReferences() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('Checking for /auth/signin references in code...');
  console.log(`${'='.repeat(60)}`);

  const { execSync } = await import('child_process');
  try {
    const result = execSync('grep -r "/auth/signin" app/ --include="*.tsx" --include="*.ts" 2>/dev/null || true', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (result.trim()) {
      console.log('⚠️  Found references to /auth/signin:');
      result.split('\n').filter(l => l).slice(0, 5).forEach(line => console.log(`   ${line}`));
    } else {
      console.log('✓ No /auth/signin references found');
    }
  } catch (e) {
    console.log('⚠️  Could not check for references');
  }
}

async function runAllTests() {
  console.log('🚀 Starting Playwright browser tests...\n');

  const pages = [
    ['/', 'home'],
    ['/stage1', 'stage1'],
    ['/stage2', 'stage2'],
    ['/cascade', 'cascade'],
    ['/okr', 'okr']
  ];

  for (const [urlPath, title] of pages) {
    await testPage(`${BASE_URL}${urlPath}`, title);
  }

  await checkAuthSignInReferences();

  // Save results
  const resultsFile = './test-results.json';
  fs.writeFileSync(resultsFile, JSON.stringify(testResults, null, 2));
  console.log(`\n📄 Results saved to: ${resultsFile}`);

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('FINAL SUMMARY');
  console.log(`${'='.repeat(60)}`);

  let passCount = 0;
  let failCount = 0;

  testResults.results.forEach(r => {
    if (r.error) {
      console.log(`❌ ${r.pageTitle}: ERROR - ${r.error.substring(0, 50)}`);
      failCount++;
    } else {
      const status = (!r.whiteScreen && r.consoleErrors === 0 && r.reloadOk) ? '✓' : '❌';
      if (status === '✓') passCount++;
      else failCount++;
      console.log(`${status} ${r.pageTitle.padEnd(10)} | Status: ${r.statusCode} | Errors: ${r.consoleErrors} | Buttons: ${r.buttonCount}`);
    }
  });

  console.log(`\nPassed: ${passCount} / Failed: ${failCount}`);
}

runAllTests().catch(console.error);
