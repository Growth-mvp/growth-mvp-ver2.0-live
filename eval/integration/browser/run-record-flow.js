/* STAGE5 の記録（社内の共有・フィードバック・自分の履歴）の保存・編集・削除・再読込を実ブラウザで検証する（評価専用）。
 * 実際の app/execution/page.tsx を描画し、保存先は stubs/recordStore.ts（localStorage の表）。通信・外部送信は遮断する。
 * 確認：本人の投稿だけ「…」を出す、編集は入力欄に戻して更新する、削除は確認を通したときだけ消す、
 *       今、困っていることの入力を消さない、再読込後も結果が残る、他の人の記録は操作できない。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const PROJECT = '既存顧客の保守契約更新';
const SHARE_TEXT = '記録フローの共有投稿（テスト）';
const SHARE_EDITED = '記録フローの共有投稿（編集後）';
const PROBLEM = '今の困りごと（未保存）';
const FB_OWN = '自分が書いたフィードバック（テスト用）';
const FB_EDITED = '自分のフィードバックを修正（テスト用）';
const SEED_IDS = ['fb-latest', 'fb-old', 'fb-mine', 'memo-other', 'memo-mine', 'fb-other-project'];
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

const rowsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('record:progress_logs') || '[]'));
const rowById = async (page, id) => (await rowsOf(page)).find((r) => r.id === id) ?? null;
const rowWith = async (page, text) => (await rowsOf(page)).find((r) => String(r.content).includes(text)) ?? null;
const okrCalls = (page) => page.evaluate(() => (window.__okrCalls || []).length);

async function openProject(page) {
  await page.goto(pathToFileURL(path.join(outDir, 'record-flow.html')).href);
  await page.waitForTimeout(1800);
  await page.getByText(PROJECT, { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(700);
}

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const page = await newPage(browser);
  await openProject(page);

  const panel = page.locator('section[aria-label="実行支援"]').first();
  const fbSection = () => panel.getByText('フィードバック（管理者）', { exact: true }).locator('xpath=ancestor::section[1]');
  const sectionOf = (title) => panel.getByText(title, { exact: true }).locator('xpath=ancestor::section[1]');
  const openDetails = async (title) => {
    await panel.locator('summary', { hasText: title }).first().click();
    await page.waitForTimeout(150);
  };
  const menuOfRow = (scope, text) => scope.locator('li').filter({ hasText: text }).first().getByRole('button', { name: '記録の操作' });
  const pickMenu = async (label) => {
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await page.waitForTimeout(400);
  };
  const problemValue = () => panel.locator('#stage5-problem').inputValue();

  await panel.locator('#stage5-problem').fill(PROBLEM);

  await check('共有：「社内に協力を求める」の投稿は、共有操作をしたときだけ保存し、今、困っていることの入力を消さない', async () => {
    const before = await rowsOf(page);
    const callsBefore = await okrCalls(page);
    await panel.getByRole('button', { name: '社内に協力を求める' }).first().click();
    await panel.getByPlaceholder('協力してほしいことを書いてください').fill(SHARE_TEXT);
    await page.waitForTimeout(150);
    const beforeSave = await rowsOf(page);
    if (beforeSave.length !== before.length) throw new Error('入力中に保存された');
    await panel.getByRole('button', { name: '社内に共有する', exact: true }).click();
    await page.waitForTimeout(800);
    const after = await rowsOf(page);
    const added = after.filter((r) => !SEED_IDS.includes(r.id));
    if (added.length !== 1) throw new Error('追加が1件でない: ' + added.length);
    if (added[0].user_id !== 'u-test' || !String(added[0].content).endsWith(SHARE_TEXT)) throw new Error('保存内容が違う: ' + JSON.stringify(added[0]));
    if (!String(added[0].okr_id).startsWith('okr-anchor-')) throw new Error('紐づくOKRが違う: ' + added[0].okr_id);
    const calls = (await okrCalls(page)) - callsBefore;
    if (calls !== 1) throw new Error('OKRの作成が保存時に1回でない: ' + calls);
    const problem = await problemValue();
    if (problem !== PROBLEM) throw new Error('今、困っていることの入力が消えた: ' + problem);
    return '本人の投稿を1件保存（OKRは保存時に作成）。入力中の困りごとは残る';
  });

  await check('フィードバック：今、困っていることの直下に直近の1件を出し、別の案件の記録は出さない', async () => {
    const fb = fbSection();
    await fb.waitFor({ state: 'visible', timeout: 5000 });
    const t = await fb.innerText();
    if (!t.includes('来週の引き継ぎの場は')) throw new Error('直近のフィードバックが出ていない: ' + t.slice(0, 160));
    if (t.includes('別の案件へのフィードバック')) throw new Error('別の案件のフィードバックが出ている');
    if (!t.includes('保存済みの記録です')) throw new Error('保存済みの記録である旨が出ていない');
    const consult = await panel.locator('#stage5-problem').boundingBox();
    const box = await fb.boundingBox();
    if (!consult || !box || box.y < consult.y) throw new Error('フィードバックが今、困っていることの下にない');
    return '直近の1件と注記を表示。位置は今、困っていることの下';
  });

  await check('「…」：自分のフィードバックだけに出し、他の人の記録には出さない', async () => {
    await openDetails('過去のフィードバック');
    const fb = fbSection();
    const total = await fb.getByRole('button', { name: '記録の操作' }).count();
    if (total !== 1) throw new Error('フィードバック欄の「…」が' + total + '件（1件のはず）');
    if ((await menuOfRow(fb, FB_OWN).count()) !== 1) throw new Error('自分のフィードバックに「…」がない');
    if ((await menuOfRow(fb, '更新案内の文面').count()) !== 0) throw new Error('他の人のフィードバックに「…」がある');
    await menuOfRow(fb, FB_OWN).click();
    await page.waitForTimeout(200);
    await panel.screenshot({ path: path.join(outDir, 'shots', 'record-feedback-menu-open.png') });
    await menuOfRow(fb, FB_OWN).click();
    return '「…」は自分のフィードバック1件だけ';
  });

  await check('フィードバック編集：「…」→編集で入力欄に元の本文が入り、更新すると保存済みの記録が書き換わる', async () => {
    const fb = fbSection();
    await menuOfRow(fb, FB_OWN).click();
    await pickMenu('編集');
    const ta = fb.getByPlaceholder('見直した方がよい点・次に活かしたい気づきを書いてください。');
    const v = await ta.inputValue();
    if (v !== FB_OWN) throw new Error('入力欄に元の本文が入っていない: ' + v);
    if ((await fb.getByRole('button', { name: 'フィードバックを更新', exact: true }).count()) !== 1) throw new Error('更新の表示になっていない');
    await ta.fill(FB_EDITED);
    await fb.getByRole('button', { name: 'フィードバックを更新', exact: true }).click();
    await page.waitForTimeout(800);
    const row = await rowById(page, 'fb-mine');
    if (!row || !row.content.includes('[FB]') || !row.content.endsWith(FB_EDITED)) throw new Error('保存内容が更新されていない: ' + JSON.stringify(row));
    return '同じ記録（fb-mine）を更新';
  });

  await check('フィードバック編集：「編集をやめる」で入力欄を空にし、保存済みの記録は変わらない', async () => {
    const fb = fbSection();
    await menuOfRow(fb, FB_EDITED).click();
    await pickMenu('編集');
    await fb.getByRole('button', { name: '編集をやめる', exact: true }).click();
    await page.waitForTimeout(200);
    const v = await fb.getByPlaceholder('見直した方がよい点・次に活かしたい気づきを書いてください。').inputValue();
    if (v !== '') throw new Error('入力欄が空になっていない: ' + v);
    const row = await rowById(page, 'fb-mine');
    if (!row || !row.content.includes(FB_EDITED)) throw new Error('記録が変わった');
    return '入力欄を空に戻し、記録は変わらない';
  });

  await check('削除：確認で「キャンセル」を選ぶと削除されない', async () => {
    const fb = fbSection();
    page.once('dialog', (d) => d.dismiss());
    await menuOfRow(fb, FB_EDITED).click();
    await pickMenu('削除');
    await page.waitForTimeout(300);
    if (!(await rowById(page, 'fb-mine'))) throw new Error('キャンセルなのに削除された');
    return '確認をキャンセルすると残る';
  });

  await check('削除：確認で「OK」を選ぶと、保存済みの記録と表示から消える', async () => {
    const fb = fbSection();
    page.once('dialog', (d) => d.accept());
    await menuOfRow(fb, FB_EDITED).click();
    await pickMenu('削除');
    await page.waitForTimeout(700);
    if (await rowById(page, 'fb-mine')) throw new Error('削除されていない');
    const t = await fb.innerText();
    if (t.includes('自分のフィードバックを修正')) throw new Error('表示に残っている');
    return 'フィードバックを削除し、表示からも消える';
  });

  await check('社内の共有記録：他の人の投稿には「…」を出さず、自分の投稿には出す', async () => {
    await openDetails('社内の共有記録（全文）');
    if ((await menuOfRow(panel, '担当が変わった顧客').count()) !== 0) throw new Error('他の人の投稿に「…」がある');
    if ((await menuOfRow(panel, SHARE_TEXT).count()) !== 1) throw new Error('自分の投稿に「…」がない');
    return '他の人の投稿は操作不可、自分の投稿は操作可';
  });

  await check('社内の投稿編集：「…」→編集で共有の欄に入り、更新すると同じ投稿が書き換わり、今、困っていることは残る', async () => {
    const editId = (await rowWith(page, SHARE_TEXT)).id;
    await menuOfRow(panel, SHARE_TEXT).click();
    await pickMenu('編集');
    await page.waitForTimeout(400);
    const sec = sectionOf('社内に共有した投稿を編集');
    const ta = sec.getByPlaceholder('協力してほしいことを書いてください');
    if ((await ta.inputValue()) !== SHARE_TEXT) throw new Error('共有の欄に元の本文が入っていない');
    await panel.screenshot({ path: path.join(outDir, 'shots', 'record-share-edit-open.png') });
    await ta.fill(SHARE_EDITED);
    await sec.getByRole('button', { name: '更新する', exact: true }).click();
    await page.waitForTimeout(800);
    const row = await rowById(page, editId);
    if (!row || !String(row.content).endsWith(SHARE_EDITED)) throw new Error('同じ投稿が更新されていない: ' + JSON.stringify(row));
    if ((await problemValue()) !== PROBLEM) throw new Error('今、困っていることの入力が消えた');
    return '同じ投稿（ID一致）を更新';
  });

  await check('社内の投稿編集：「編集をやめる」で共有の欄を閉じ、投稿は変わらない', async () => {
    await menuOfRow(panel, SHARE_EDITED).click();
    await pickMenu('編集');
    await sectionOf('社内に共有した投稿を編集').getByRole('button', { name: '編集をやめる', exact: true }).click();
    await page.waitForTimeout(300);
    if ((await panel.getByText('社内に共有した投稿を編集', { exact: true }).count()) !== 0) throw new Error('共有の欄が閉じていない');
    const row = await rowWith(page, SHARE_EDITED);
    if (!row) throw new Error('投稿が変わった');
    return '編集をやめると、欄を閉じて投稿は変わらない';
  });

  await check('社内の投稿削除：確認を通したときだけ消え、社内の共有記録からも消える', async () => {
    const id = (await rowWith(page, SHARE_EDITED)).id;
    page.once('dialog', (d) => d.dismiss());
    await menuOfRow(panel, SHARE_EDITED).click();
    await pickMenu('削除');
    await page.waitForTimeout(300);
    if (!(await rowById(page, id))) throw new Error('キャンセルなのに削除された');
    page.once('dialog', (d) => d.accept());
    await menuOfRow(panel, SHARE_EDITED).click();
    await pickMenu('削除');
    await page.waitForTimeout(700);
    if (await rowById(page, id)) throw new Error('削除されていない');
    const t = await sectionOf('社内の共有記録（全文）').innerText();
    if (t.includes(SHARE_EDITED)) throw new Error('共有記録に残っている');
    return '確認を通すと削除し、共有記録からも消える';
  });

  await page.screenshot({ path: path.join(outDir, 'shots', 'record-flow-after-ops.png'), fullPage: false });

  await page.reload();
  await page.waitForTimeout(1500);
  await openProject(page);
  await openDetails('自分の履歴（編集・削除）');

  await check('再読込：保存・編集・削除の結果が残り、消した記録は出ない', async () => {
    const rows = await rowsOf(page);
    if (rows.some((r) => r.id === 'fb-mine')) throw new Error('削除したフィードバックが残っている');
    if (rows.some((r) => String(r.content).includes(SHARE_EDITED))) throw new Error('削除した投稿が残っている');
    if (!rows.some((r) => r.id === 'memo-mine')) throw new Error('既存の自分の投稿が消えた');
    const hist = await sectionOf('自分の履歴（編集・削除）').innerText();
    if (hist.includes(FB_EDITED) || hist.includes(SHARE_EDITED)) throw new Error('履歴に削除した記録が残っている');
    if (!hist.includes('自分の共有投稿（テスト用）')) throw new Error('再読込後の履歴に既存の投稿が出ていない');
    return '削除結果は残り、既存の自分の投稿は残る';
  });

  await check('他の人の記録：再読込後も、他の人の投稿・フィードバックは残り、操作できない', async () => {
    const rows = await rowsOf(page);
    if (!rows.some((r) => r.id === 'memo-other') || !rows.some((r) => r.id === 'fb-latest')) throw new Error('他の人の記録が消えた');
    if ((await menuOfRow(panel, '担当が変わった顧客').count()) !== 0) throw new Error('他の人の投稿に「…」がある');
    return '他の人の記録は残り、操作は出ない';
  });

  await page.locator('section[aria-label="実行支援"]').first().screenshot({ path: path.join(outDir, 'shots', 'record-flow-final.png') });

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
  fs.writeFileSync(path.join(outDir, 'record-flow-results.json'), JSON.stringify(summary, null, 2));
  for (const r of results) console.log(`${r.status}  ${r.name}  ${r.detail}`);
  console.log(`\n${summary.pass}/${summary.total} PASS`);
  process.exit(summary.fail ? 1 : 0);
})();
