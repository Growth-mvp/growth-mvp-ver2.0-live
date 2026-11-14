/* STAGE4で開始した計画の、STAGE5の画面での流れを実ブラウザで検証する（評価専用）。
 * 実際の app/execution/page.tsx を描画し、計画の取得・OKRの作成・活動ログ・部分更新・PDFは stubs/ で遮断する。
 * 確認：上部カードの撤去、モーダル内の計画（STAGE4で修正したKPI）、開くだけでは書かない、実施事項の保存と再読込、
 *       OKRが無い案件は保存時にだけ作る、PDFの内容（修正後のKPI）、例外・外部通信がない。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const PROJECT = '既存顧客の保守契約更新';
const EDITED_KPI = '3社（ハーネス修正）';
const results = [];
const errors = [];
const external = [];

const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', detail: detail ?? '' });
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 120));
    return route.abort();
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 240));
  });
  return page;
}

const counters = (page) =>
  page.evaluate(() => ({
    okrCalls: (window.__okrCalls || []).length,
    partialWrites: (window.__partialWrites || []).length,
    progressInserts: (window.__progressInserts || []).length,
    pdfDocs: (window.__pdfDocs || []).length,
  }));

const projectOfStorage = (page, title) =>
  page.evaluate((t) => {
    const raw = Object.keys(localStorage).filter((k) => k.startsWith('flow:'));
    for (const k of raw) {
      const p = JSON.parse(localStorage.getItem(k));
      const pr = (p.departments || []).flatMap((d) => d.projects || []).find((x) => x.title === t);
      if (pr) return pr;
    }
    return null;
  }, title);

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const page = await newPage(browser);
  await page.goto(pathToFileURL(path.join(outDir, 'plan-flow.html')).href);
  await page.waitForTimeout(1800);

  await check('上部カード：STAGE5 の上に独立した「実行計画」一覧を出さない', async () => {
    const n = await page.locator('section[aria-label="実行計画"]').count();
    if (n !== 0) throw new Error(`上部に計画の一覧が ${n} 件ある`);
    return '上部の計画一覧なし';
  });

  await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));

  await check('モーダル：STAGE4で開始した計画を表示し、STAGE4で修正したKPIの目標を出す', async () => {
    const section = page.locator('section[aria-label="実行計画"]').first();
    await section.waitFor({ state: 'visible', timeout: 5000 });
    const t = await section.innerText();
    if (!t.includes('実行計画（STAGE4・実行開始済み）')) throw new Error('計画の見出しがない');
    if (!t.includes(EDITED_KPI)) throw new Error('STAGE4で修正したKPIの目標が出ていない: ' + t.slice(0, 120));
    return `修正後のKPI目標「${EDITED_KPI}」を表示`;
  });

  await check('モーダル：旧KPI一覧（名前だけ）は出さない（重複をなくす）', async () => {
    if ((await page.getByText('主なKPI', { exact: true }).count()) !== 0) throw new Error('主なKPIが残っている');
    return '旧KPI一覧なし';
  });

  await check('モーダルを開いただけでは、OKR・計画・実績の書き込みをしない', async () => {
    const c = await counters(page);
    if (c.okrCalls !== 0 || c.partialWrites !== 0 || c.progressInserts !== 0) throw new Error('書き込みが起きた: ' + JSON.stringify(c));
    return 'OKR作成0件・部分更新0件・活動ログ0件';
  });

  await page.locator('section[aria-label="実行計画"]').first().screenshot({ path: path.join(outDir, 'shots', 'plan-section.png') });

  const action = (no) => page.locator('section[aria-label="実行計画"]').first();
  await check('実施事項：進捗・課題・次の行動を保存し、部分更新で1回だけ書く', async () => {
    await action().getByLabel('1. の進捗').selectOption('IN_PROGRESS');
    await action().getByLabel('1. の課題').fill('担当者が不足');
    await action().getByLabel('1. の次の行動').fill('来週の打ち合わせで決める');
    await action().getByRole('button', { name: '進捗を保存' }).first().click();
    await action().getByRole('status').first().waitFor({ state: 'visible', timeout: 5000 });
    const msg = await action().getByRole('status').first().innerText();
    if (!msg.includes('保存しました')) throw new Error('保存の案内が出ない: ' + msg);
    const c = await counters(page);
    if (c.partialWrites !== 1) throw new Error('部分更新の回数が違う: ' + c.partialWrites);
    const pr = await projectOfStorage(page, PROJECT);
    const rec = Object.values(pr?.executionProgress ?? {})[0];
    if (!rec || rec.issue !== '担当者が不足' || rec.nextAction !== '来週の打ち合わせで決める' || rec.status !== 'IN_PROGRESS') {
      throw new Error('保存された内容が違う: ' + JSON.stringify(rec));
    }
    return '進行中・課題・次の行動を保存（部分更新1回）';
  });

  await page.reload();
  await page.waitForTimeout(1800);
  await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));

  await check('再読込：保存した進捗・課題・次の行動が残っている', async () => {
    const s = page.locator('section[aria-label="実行計画"]').first();
    await s.waitFor({ state: 'visible', timeout: 5000 });
    const status = await s.getByLabel('1. の進捗').inputValue();
    const issue = await s.getByLabel('1. の課題').inputValue();
    const next = await s.getByLabel('1. の次の行動').inputValue();
    if (status !== 'IN_PROGRESS' || issue !== '担当者が不足' || next !== '来週の打ち合わせで決める') {
      throw new Error(`再読込後の値が違う: ${status} / ${issue} / ${next}`);
    }
    return '進行中・課題・次の行動を再読込後も表示';
  });

  await check('OKRが無い案件：活動ログは保存時にだけ、OKRを作ってから保存する', async () => {
    const before = await counters(page);
    await page.getByRole('button', { name: '組織に協力を求める' }).first().click();
    await page.getByPlaceholder('協力してほしいことを書いてください').fill('ハーネスの共有投稿');
    await page.getByRole('button', { name: '社内に共有する' }).first().click();
    await page.waitForTimeout(600);
    const after = await counters(page);
    if (after.okrCalls !== before.okrCalls + 1) throw new Error(`OKR作成が1回でない: ${before.okrCalls} -> ${after.okrCalls}`);
    if (after.progressInserts !== before.progressInserts + 1) throw new Error('活動ログが1件保存されていない');
    const last = await page.evaluate(() => window.__progressInserts[window.__progressInserts.length - 1]);
    if (!String(last.okrId).startsWith('okr-anchor-')) throw new Error('活動ログの参照先がOKRでない: ' + last.okrId);
    return `OKRを保存時に作成（${last.okrId}）し、活動ログを1件保存`;
  });

  await check('PDF：モーダルのボタンで開き、STAGE4で修正したKPIを含む計画書を作る（計画は変えない）', async () => {
    await page.getByRole('button', { name: '実行計画書をPDFで開く' }).first().click();
    await page.waitForTimeout(500);
    const c = await counters(page);
    if (c.pdfDocs !== 1) throw new Error('PDFが作られていない: ' + c.pdfDocs);
    const out = await page.evaluate(() => {
      const { doc, fileName } = window.__pdfDocs[0];
      const table = doc.blocks.find((b) => b.type === 'table' && b.header[0] && b.header[0][0] && b.header[0][0].text === 'KPI');
      const cells = table ? table.rows.map((r) => r.map((c) => c[0].text)) : [];
      return { title: doc.title, subtitle: doc.subtitle, fileName, kpiRows: cells, headings: doc.blocks.filter((b) => b.type === 'heading').map((b) => b.runs[0].text) };
    });
    if (!out.fileName.endsWith('.pdf')) throw new Error('ファイル名が違う: ' + out.fileName);
    const hit = out.kpiRows.find((r) => r[1] === EDITED_KPI);
    if (!hit) throw new Error('PDFのKPI表に修正後の目標がない: ' + JSON.stringify(out.kpiRows).slice(0, 160));
    if (out.headings.length !== 7) throw new Error('節の数が違う: ' + out.headings.length);
    fs.writeFileSync(path.join(outDir, 'plan-pdf-document.json'), JSON.stringify(out, null, 2));
    return `PDF内容：${out.title}（節${out.headings.length}・KPI「${hit[0]}」の目標は修正後）`;
  });

  await check('ブラウザ実行中に例外・コンソールエラー・外部通信がない', async () => {
    const real = errors.filter((e) => !e.includes('STAGE5-load-db-okrs'));
    if (real.length) throw new Error(real.slice(0, 2).join(' | '));
    if (external.length) throw new Error('外部通信: ' + external.length);
    return 'エラー0件・外部通信0件';
  });

  await browser.close();
  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    results,
  };
  fs.writeFileSync(path.join(outDir, 'plan-flow-results.json'), JSON.stringify(summary, null, 2));
  for (const r of results) console.log(`${r.status}  ${r.name}  ${r.detail}`);
  console.log(`\n${summary.pass}/${summary.total} PASS`);
  process.exit(summary.fail ? 1 : 0);
})();
