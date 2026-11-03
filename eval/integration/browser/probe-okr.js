/* 調査用：OKR画面が描画されるか、エラーや通信がないかを確認する（評価専用） */
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  const external = [];
  await p.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 120));
    return route.abort();
  });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 300)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 240)); });
  await p.goto(pathToFileURL(path.join(__dirname, '..', 'results-browser', 'okr.html')).href);
  await p.waitForTimeout(2500);
  const len = (await p.locator('#root').innerHTML()).length;
  console.log('root html length:', len);
  const text = await p.locator('#root').innerText().catch(() => '');
  console.log('text head:', text.slice(0, 600).replace(/\n+/g, ' | '));
  console.log('errors:', errs.slice(0, 6));
  console.log('external requests blocked:', external.length, external.slice(0, 3));
  await b.close();
})().catch((e) => { console.error('ERR', e.message.split('\n')[0]); process.exit(1); });
