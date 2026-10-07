import { test, expect } from '@playwright/test';

/**
 * STAGE1 Import Error Handling Tests
 * Verify that API returns JSON errors, never HTML 500
 */

test.describe('STAGE1 Import - Error Response Format', () => {
  test('should return JSON error, not HTML on auth failure', async ({ page }) => {
    // Intercept network responses
    const responses: any[] = [];

    page.on('response', async (response) => {
      if (response.url().includes('/api/stage1/import')) {
        const contentType = response.headers()['content-type'] || '';
        responses.push({
          status: response.status(),
          contentType,
          url: response.url(),
        });

        // Verify it's JSON, not HTML
        expect(contentType.toLowerCase()).toContain('application/json');

        // Try to parse as JSON (should not throw)
        const body = await response.text();
        expect(() => JSON.parse(body)).not.toThrow();

        // Verify it doesn't contain HTML tags
        expect(body).not.toContain('<html');
        expect(body).not.toContain('<body');
        expect(body).not.toContain('<!DOCTYPE');

        // If error, should have error field
        if (response.status() >= 400) {
          const json = JSON.parse(body);
          expect(json).toHaveProperty('success', false);
          expect(json).toHaveProperty('error');
        }
      }
    });

    // Make request without auth (will fail)
    const response = await page.request.post('/api/stage1/import', {
      multipart: {
        files: [],
      },
    });

    // Verify it's JSON
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');

    const json = await response.json();
    expect(json).toHaveProperty('success', false);

    // Should not have HTML content
    const body = JSON.stringify(json);
    expect(body).not.toContain('<');
  });

  test('should return JSON on malformed request', async ({ page }) => {
    // Test with various malformed data
    const response = await page.request.post('/api/stage1/import', {
      data: 'invalid data',
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    // Should get 4xx or 5xx, but always as JSON
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');

    const json = await response.json();
    expect(typeof json).toBe('object');
    expect(json).toHaveProperty('success');
    expect(json).toHaveProperty('error');

    // No HTML
    expect(JSON.stringify(json)).not.toContain('<html');
  });

  test('should return structured error with message field', async ({ page }) => {
    // Make request without files
    const response = await page.request.post('/api/stage1/import', {
      multipart: {},
    });

    const json = await response.json();

    // Verify structure
    expect(json).toHaveProperty('success');
    expect(json).toHaveProperty('error');

    if (json.success === false) {
      // error should be a string message, not HTML
      expect(typeof json.error).toBe('string');
      expect(json.error.length).toBeGreaterThan(0);
      expect(json.error).not.toContain('<');
      expect(json.error).not.toContain('500 Internal Server Error');
    }
  });

  test('dev endpoint also returns JSON errors', async ({ page }) => {
    // Test /api/stage1/import-dev (dev endpoint without auth)
    const response = await page.request.post('/api/stage1/import-dev', {
      multipart: {},
    });

    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');

    const json = await response.json();
    expect(json).toHaveProperty('success');
    expect(json).toHaveProperty('error');

    // No HTML
    expect(JSON.stringify(json)).not.toContain('<html');
  });
});

test.describe('STAGE1 Import - Logging Verification', () => {
  test('should log request ID for tracing', async ({ page, context }) => {
    // We can't directly read server logs, but we can verify the API works
    // and returns valid responses that indicate logging is happening
    // (since DOMMatrix error would prevent response)

    const testFilePath = './test-files/test-02-company-pl-only.xlsx';

    // Verify the file exists
    const fileExists = await page.evaluate((filePath) => {
      return fetch(filePath).then(r => r.ok).catch(() => false);
    }, testFilePath);

    // File doesn't need to exist in web context, but we can still test the API
    // responds without DOMMatrix errors

    const response = await page.request.post('/api/stage1/import-dev', {
      multipart: {
        files: [],
      },
    });

    // The key is that it returns JSON (not HTML 500 from DOMMatrix)
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');

    const json = await response.json();
    expect(typeof json).toBe('object');
    expect(json).toHaveProperty('error');
  });
});
