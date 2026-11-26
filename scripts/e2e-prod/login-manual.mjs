import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, PROFILE_DIR, RUN_DIR } from './common.mjs';

fs.mkdirSync(PROFILE_DIR, { recursive: true });
fs.mkdirSync(RUN_DIR, { recursive: true });
const statusFile = path.join(RUN_DIR, 'login-status.json');
const writeStatus = (o) => fs.writeFileSync(statusFile, JSON.stringify({ at: new Date().toISOString(), ...o }, null, 2));

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1400, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
writeStatus({ state: 'waiting_for_manual_login' });
console.log('MANUAL_LOGIN_WAITING');

const deadline = Date.now() + 15 * 60 * 1000;
let result = null;
while (Date.now() < deadline) {
  try {
    const pathname = new URL(page.url()).pathname;
    const hasSession = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)),
    );
    if (hasSession && !pathname.startsWith('/login') && !pathname.startsWith('/auth/mfa')) {
      result = { state: 'logged_in', pathname };
      break;
    }
  } catch {
    // 手動操作中の一時的な遷移・ページ再読込は無視する
  }
  await page.waitForTimeout(2000);
}

if (!result) result = { state: 'timeout' };
writeStatus(result);
console.log(`LOGIN_RESULT ${result.state}`);
await ctx.close();
