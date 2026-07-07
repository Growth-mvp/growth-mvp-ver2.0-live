import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const response = await page.goto('http://localhost:3000/stage0', { waitUntil: 'networkidle' });
  console.log('Response status:', response?.status());
  console.log('Final URL:', page.url());
  
  const content = await page.content();
  if (content.includes('会議前の一息')) {
    console.log('✅ STAGE0 component content found!');
  }
  if (content.includes('stage0')) {
    console.log('✅ STAGE0 page rendered!');
  }
  
  // Check for key elements
  const header = await page.textContent('h1');
  console.log('H1 text:', header?.substring(0, 50));
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await browser.close();
}
