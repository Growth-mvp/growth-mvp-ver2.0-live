const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    await page.goto('http://localhost:3000/okr', { waitUntil: 'networkidle', timeout: 30000 });
    
    // Wait for the page to load
    await page.waitForTimeout(3000);
    
    // Check if the KPI担当 input field exists
    const kpiOwnerLabel = await page.locator('label:has-text("KPI担当")');
    const kpiOwnerLabelCount = await kpiOwnerLabel.count();
    
    console.log(`KPI担当 labels found: ${kpiOwnerLabelCount}`);
    
    // Check if grid-cols-2 exists
    const gridDiv = await page.locator('div.grid.grid-cols-2:has(label:has-text("プロジェクト責任者"))');
    const gridDivCount = await gridDiv.count();
    
    console.log(`Grid cols-2 with Project Owner: ${gridDivCount}`);
    
    // Take screenshot
    await page.screenshot({ path: './okr_screenshot.png', fullPage: true });
    console.log('Screenshot saved to ./okr_screenshot.png');
    
    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    await browser.close();
    process.exit(1);
  }
})();
