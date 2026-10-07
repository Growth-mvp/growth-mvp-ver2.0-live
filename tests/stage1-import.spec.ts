import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * STAGE1 Excel Import Regression Tests
 * Tests Excel/CSV import functionality with various file formats
 * to prevent regression of DOMMatrix and other import-related issues
 */

const TEST_FILES_DIR = path.join(__dirname, '../test-files');

test.describe('STAGE1 Excel Import', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to STAGE1 page
    await page.goto('/stage1', { waitUntil: 'networkidle' });

    // Wait for the import panel to be visible
    await page.waitForSelector('text=資料アップロード');
  });

  test('should handle empty standard format file', async ({ page }) => {
    // Upload empty format file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(TEST_FILES_DIR, 'test-01-empty-format.xlsx'));

    // Wait for processing
    await page.waitForTimeout(2000);

    // Check for success (0 candidates is expected for empty format)
    const successIndicator = page.locator('text=/成功|候補|candidates/i');
    await expect(successIndicator).toBeVisible({ timeout: 5000 });

    // Verify no errors
    const errorText = await page.locator('text=エラー|error|500').count();
    expect(errorText).toBe(0);
  });

  test('should parse company PL data correctly', async ({ page }) => {
    // Upload company PL only file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(TEST_FILES_DIR, 'test-02-company-pl-only.xlsx'));

    // Wait for processing
    await page.waitForTimeout(2000);

    // Look for "全社PL" tab or candidates
    const plIndicator = page.locator('text=全社PL|companyPL');
    await expect(plIndicator).toBeVisible({ timeout: 5000 });

    // Verify HTTP 200 (not 500)
    const errorBanner = page.locator('[class*="error"], [class*="Error"]').first();
    const errorText = await errorBanner.textContent().catch(() => '');
    expect(errorText).not.toContain('500');
  });

  test('should parse company PL and BS data', async ({ page }) => {
    // Upload company PL+BS file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(TEST_FILES_DIR, 'test-03-company-pl-bs.xlsx'));

    // Wait for processing
    await page.waitForTimeout(2000);

    // Check for both PL and BS tabs
    const plTab = page.locator('button:has-text("全社PL")');
    const bsTab = page.locator('button:has-text("全社BS")');

    await expect(plTab).toBeVisible({ timeout: 5000 });
    await expect(bsTab).toBeVisible({ timeout: 5000 });
  });

  test('should parse segment PL data', async ({ page }) => {
    // Upload segment PL file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(TEST_FILES_DIR, 'test-04-company-pl-bs-segment-pl.xlsx'));

    // Wait for processing
    await page.waitForTimeout(2000);

    // Check for segment PL tab
    const segmentPlTab = page.locator('button:has-text("事業別PL")');
    await expect(segmentPlTab).toBeVisible({ timeout: 5000 });

    // Look for segment names (事業部A, 事業部B)
    const segmentIndicator = page.locator('text=/事業部|segment/i');
    await expect(segmentIndicator).toBeVisible({ timeout: 5000 });
  });

  test('should parse all sheets including segment BS', async ({ page }) => {
    // Upload complete file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(TEST_FILES_DIR, 'test-05-all-sheets.xlsx'));

    // Wait for processing
    await page.waitForTimeout(2000);

    // Check for all tabs
    const plTab = page.locator('button:has-text("全社PL")');
    const bsTab = page.locator('button:has-text("全社BS")');
    const segmentPlTab = page.locator('button:has-text("事業別PL")');
    const segmentBsTab = page.locator('button:has-text("事業別BS")');

    await expect(plTab).toBeVisible({ timeout: 5000 });
    await expect(bsTab).toBeVisible({ timeout: 5000 });
    await expect(segmentPlTab).toBeVisible({ timeout: 5000 });
    await expect(segmentBsTab).toBeVisible({ timeout: 5000 });
  });

  test('should return JSON error, not HTML 500', async ({ page }) => {
    // Intercept API responses
    let lastApiResponse: any = null;
    page.on('response', async (response) => {
      if (response.url().includes('/api/stage1/import')) {
        const contentType = response.headers()['content-type'] || '';
        expect(contentType).toContain('application/json');

        if (response.status() >= 400) {
          lastApiResponse = await response.json().catch(() => null);
          // Verify it's JSON, not HTML
          expect(lastApiResponse).toBeDefined();
          if (lastApiResponse && typeof lastApiResponse === 'object') {
            expect(lastApiResponse).toHaveProperty('success');
            expect(lastApiResponse).toHaveProperty('error');
          }
        }
      }
    });

    // Attempt upload
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(TEST_FILES_DIR, 'test-02-company-pl-only.xlsx'));

    await page.waitForTimeout(3000);
  });
});

test.describe('STAGE1 Import Error Handling', () => {
  test('should provide structured error responses', async ({ page }) => {
    await page.goto('/stage1', { waitUntil: 'networkidle' });
    await page.waitForSelector('text=資料アップロード');

    let apiResponse: any = null;

    page.on('response', async (response) => {
      if (response.url().includes('/api/stage1/import')) {
        apiResponse = await response.json().catch(() => ({ error: 'JSON parse failed' }));
      }
    });

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(TEST_FILES_DIR, 'test-02-company-pl-only.xlsx'));

    await page.waitForTimeout(2000);

    // Verify response structure
    if (apiResponse && apiResponse.success === false) {
      expect(apiResponse).toHaveProperty('error');
      // error should be a string, not HTML
      expect(typeof apiResponse.error).toBe('string');
      expect(apiResponse.error).not.toContain('<html');
      expect(apiResponse.error).not.toContain('500');
    }
  });
});
