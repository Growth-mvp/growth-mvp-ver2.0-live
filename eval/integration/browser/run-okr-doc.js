/* 実際の /okr 画面（実レイアウトの中）で、開発用の文書型実行計画書を操作して検証する（評価専用）。
 * 認証・通信・保存はstubs/で差し替えたハーネスで動かし、file:// 以外への通信は遮断する。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const shotsDir = path.join(outDir, 'okr-doc-shots');
const results = [];
const external = [];
const errors = [];

const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', detail: detail ?? '' });
    console.log('PASS ' + name + (detail ? '  -- ' + detail : ''));
  } catch (e) {
    const detail = String(e.message || e).split('\n')[0];
    results.push({ name, status: 'FAIL', detail });
    console.log('FAIL ' + name + ' -- ' + detail);
  }
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/* 内部コード・状態ラベル・開発用の文言は、文書の本文に出してはいけない */
const FORBIDDEN = [
  'S1', 'S2', 'S3', 'A1', 'A2', 'A3', 'LEADING', 'CUSTOMER_OUTCOME', 'COMPANY_RESULT', 'UNCLASSIFIED',
  'STAGE_DATA', 'HYPOTHESIS', 'UNCONFIRMED', 'AI_PROVISIONAL', 'PROPOSAL', 'DERIVED',
  '入力どおり', 'AI草案', '根拠を見る', '測り方を見る', '確かめ方を見る', 'kpi:', 'action:', 'task:', 'BEFORE_START', 'STAGE3KpiId',
];

const REFLECT_TEXT = '検証用：取り組む理由を反映した文';
const DISCARD_TEXT = '検証用：取り消すべき文';
const CHAT_TEXT = '検証用：AIへの入力（開閉後も残る）';

async function newPage(browser, w, h, label) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text().includes('ERR_FILE_NOT_FOUND')) return;
    errors.push(`${label} console ${m.text()}`);
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(pathToFileURL(path.join(outDir, 'okr-shell.html')).href);
  await page.waitForTimeout(1200);
  return page;
}

const toggleBtn = (page) => page.getByRole('button', { name: /開発用：新しい実行計画書を表示/ });
const paper = (page) => page.locator('.plan-paper');
const writeCalls = (page) => page.evaluate(() => (window.__dbWriteCalls || []).length + (window.__okrCalls || []).length);

async function openDevDoc(page) {
  await toggleBtn(page).click();
  await paper(page).waitFor({ state: 'visible', timeout: 8000 });
}

async function runDesktop(browser) {
  const page = await newPage(browser, 1440, 900, 'デスクトップ');
  const label = 'デスクトップ';

  await check(`${label}：既存のSTAGEナビゲーションと右のAI経営コンサルタントが同時に見える`, async () => {
    const nav = await page.getByText('現場は何をするのか').first().isVisible();
    assert(nav, '既存のSTAGEナビゲーションが見えない');
    const ai = page.locator('aside').filter({ has: page.getByPlaceholder('質問を入力してください') }).getByText('AI経営コンサルタント', { exact: true }).first();
    await ai.waitFor({ state: 'visible', timeout: 8000 });
    const box = await ai.boundingBox();
    assert(box && box.x > 1100, `AI経営コンサルタントが右側にない（x=${box && box.x}）`);
    return `AI経営コンサルタントは右側（x=${Math.round(box.x)}）`;
  });

  await check(`${label}：従来の画面（入力フォーム側）は残り、開発用の表示を閉じると戻る`, async () => {
    const legacyList = page.locator('aside.w-\\[280px\\]');
    assert((await legacyList.isVisible()) === true, '従来のプロジェクト一覧が見えない');
    await openDevDoc(page);
    assert((await legacyList.isVisible()) === false, '文書表示中に従来の一覧が残っている');
    await page.getByRole('button', { name: /開発用の試作を閉じて/ }).click();
    await page.waitForTimeout(400);
    assert((await legacyList.isVisible()) === true, '閉じたあとに従来の一覧が戻らない');
    await openDevDoc(page);
    return '表示の切り替えを確認';
  });

  const baselineWrites = await writeCalls(page);

  await check(`${label}：文書型の計画書に、5つの章が Word の計画書のように並ぶ`, async () => {
    const text = await paper(page).innerText();
    for (const t of ['目的・背景', '目標・期待成果', '具体的な実施事項', '推進体制・スケジュール', '業績への貢献と留意事項']) {
      assert(text.includes(t), `章がない：${t}`);
    }
    assert(text.includes('実行計画書'), '文書の題名がない');
    return '5章と題名を確認';
  });

  await check(`${label}：内部コード・状態ラベル・開発用の文言が本文に出ない`, async () => {
    const text = await paper(page).innerText();
    const hits = FORBIDDEN.filter((w) => text.includes(w));
    assert(hits.length === 0, `出てはいけない表示：${hits.join(', ')}`);
    return '本文に内部コードなし';
  });

  await check(`${label}：通常表示に編集ボタンが並ばない（修正は「計画書を修正する」の1か所）`, async () => {
    const n = await paper(page).locator('[aria-label$="を修正する"]').count();
    assert(n === 0, `通常表示に編集の入口が ${n} 個ある`);
    return '編集の入口は0';
  });

  await check(`${label}：STAGE3のKPI（確定・入力済み）は表示どおりで、編集の入口がない`, async () => {
    const rows = paper(page).locator('tr', { hasText: '入力済み（確定の印なし）' });
    const n = await rows.count();
    assert(n >= 1, 'STAGE3のKPIの行がない');
    await page.getByRole('button', { name: '計画書を修正する' }).click();
    const editable = await rows.locator('.plan-edit-target').count();
    assert(editable === 0, `STAGE3のKPIに編集の入口が ${editable} 個ある`);
    const total = await paper(page).locator('.plan-edit-target').count();
    assert(total >= 8, `修正できる箇所が少ない（${total}）`);
    await page.getByRole('button', { name: '修正をやめる' }).click();
    return `確定の印が無いKPI ${n} 件は編集不可・「入力済み」と表示。修正できる箇所 ${total} か所`;
  });

  await check(`${label}：部分編集を反映すると、その部分だけが変わる`, async () => {
    const before = await paper(page).innerText();
    await page.getByRole('button', { name: '計画書を修正する' }).click();
    await page.getByRole('button', { name: '取り組む理由を修正する' }).click();
    await page.getByLabel('取り組む理由', { exact: true }).fill(REFLECT_TEXT);
    await page.getByRole('button', { name: 'この部分を閉じる' }).first().click();
    await page.getByRole('button', { name: '修正を反映する' }).click();
    const after = await paper(page).innerText();
    assert(after.includes(REFLECT_TEXT), '反映されていない');
    assert(after.includes('修正した箇所：1 件') || (await page.getByText('修正した箇所：1 件').count()) > 0, '修正の件数が出ない');
    assert(after.includes('実現したい状態') && before.includes('実現したい状態'), '他の章が消えた');
    return '1件を反映、他の章はそのまま';
  });

  await check(`${label}：修正をやめると、やめた内容は残らない`, async () => {
    await page.getByRole('button', { name: '計画書を修正する' }).click();
    await page.getByRole('button', { name: '実現したい状態を修正する' }).click();
    await page.getByLabel('実現したい状態', { exact: true }).fill(DISCARD_TEXT);
    await page.getByRole('button', { name: '修正をやめる' }).click();
    assert(!(await paper(page).innerText()).includes(DISCARD_TEXT), 'やめたのに内容が残った');
    assert((await paper(page).innerText()).includes(REFLECT_TEXT), '反映済みの修正まで消えた');
    return '取り消しを確認（反映済みは残る）';
  });

  await check(`${label}：プロジェクトを切り替えても、別の計画書に修正が混ざらない`, async () => {
    const select = page.getByLabel('プロジェクト選択', { exact: true });
    await select.selectOption('profit');
    await paper(page).locator('h1', { hasText: '工場の歩留まり改善と原価低減' }).waitFor({ timeout: 5000 });
    assert(!(await paper(page).innerText()).includes(REFLECT_TEXT), '別のプロジェクトに修正が混ざった');
    await select.selectOption('growth');
    await paper(page).locator('h1', { hasText: '医療機関向け計測ソリューションの試験導入' }).waitFor({ timeout: 5000 });
    assert((await paper(page).innerText()).includes(REFLECT_TEXT), '元のプロジェクトの修正が戻らない');
    return '切り替えても、各計画書の修正は分かれたまま';
  });

  await page.screenshot({ path: path.join(shotsDir, '10-desktop-document.png') });

  await check(`${label}：採用は文書の確認後にでき、未確認の事項があっても採用できる`, async () => {
    const adopt = page.getByRole('button', { name: 'この計画案を採用する' });
    await adopt.waitFor({ state: 'visible', timeout: 5000 });
    assert(await adopt.isEnabled(), '採用できない');
    await adopt.click();
    assert((await page.getByText('採用済み（画面内の状態）').count()) === 1, '採用の表示が出ない');
    return '採用できた（未確認の事項は残ったまま）';
  });

  await check(`${label}：実行開始は、別の画面で条件を確かめてから行う`, async () => {
    await page.getByRole('button', { name: '実行開始の確認', exact: true }).click();
    await page.getByRole('heading', { name: '実行開始の確認' }).waitFor({ timeout: 5000 });
    const start = page.getByRole('button', { name: '実行を開始する（画面内の状態）' });
    assert(await start.isDisabled(), '条件がそろう前に開始できてしまう');
    await page.screenshot({ path: path.join(shotsDir, '11-desktop-start.png') });
    return '条件がそろうまで開始できない';
  });

  await check(`${label}：実行責任者を確定すると、確定の記録が残る`, async () => {
    const confirm = page.getByRole('button', { name: /を実行責任者として確定する/ });
    if ((await confirm.count()) > 0) await confirm.first().click();
    assert((await page.getByText(/確定済み：/).count()) === 1, '責任者の確定が反映されない');
    return '責任者を確定';
  });

  await check(`${label}：主要な実行条件を確かめたあと、規制・安全の記録が無ければ開始できない`, async () => {
    const boxes = page.locator('section input[type="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
    }
    const blocked = page.getByText('規制・安全の確認（判断内容・確認者・確認日）を記録してください');
    if ((await blocked.count()) === 0) {
      return `主要な実行条件 ${n} 件を確認（この計画には規制・安全の確認事項がないため、この検査は対象外）`;
    }
    const start = page.getByRole('button', { name: '実行を開始する（画面内の状態）' });
    assert(await start.isDisabled(), 'チェックだけで規制・安全を満たしてしまう');
    return `主要な実行条件 ${n} 件にチェック。規制・安全の記録が無いので開始できない`;
  });

  await check(`${label}：規制・安全の判断・確認者・確認日を記録すると、開始できる`, async () => {
    const radios = page.locator('input[name="regulatory-decision"]');
    if ((await radios.count()) === 0) return '規制・安全の確認事項なし（対象外）';
    await radios.nth(1).check();
    await page.locator('label', { hasText: '判断の内容' }).locator('textarea').fill('所定の手続きを確認した');
    await page.locator('label', { hasText: '確認者' }).locator('input').fill('検証担当（架空）');
    await page.locator('input[type="date"]').fill('2027-01-15');
    const start = page.getByRole('button', { name: '実行を開始する（画面内の状態）' });
    await start.waitFor({ state: 'visible' });
    assert(await start.isEnabled(), '記録を入れても開始できない');
    await start.click();
    assert((await page.getByText('実行開始（画面内の状態）').count()) === 1, '開始の表示が出ない');
    return '記録をそろえて、画面内で開始';
  });

  await check(`${label}：文書を修正して反映すると、採用と開始は解除され、理由が出る`, async () => {
    await page.getByRole('button', { name: '計画書を読む' }).click();
    await paper(page).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '計画書を修正する' }).click();
    await page.getByRole('button', { name: '実現したい状態を修正する' }).click();
    await page.getByLabel('実現したい状態', { exact: true }).fill('採用後に変えた内容');
    await page.getByRole('button', { name: '修正を反映する' }).click();
    assert((await page.getByText('修正を反映したため、採用と実行開始の状態を解除しました').count()) === 1, '解除の理由が出ない');
    assert((await page.getByRole('button', { name: 'この計画案を採用する' }).count()) === 1, '採用が解除されていない');
    return '採用と開始を解除し、理由を表示';
  });

  await check(`${label}：右側のAI経営コンサルタントの幅を、ドラッグで変えられる`, async () => {
    const handle = page.getByRole('separator', { name: 'AI経営コンサルタントの幅' });
    const box = await handle.boundingBox();
    assert(box, '幅の調整ハンドルが見えない');
    const x0 = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 - 90, y0, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await handle.boundingBox();
    const delta = Math.round(box.x - after.x);
    assert(delta >= 60, `幅が変わっていない（変化 ${delta}px）`);
    assert((await paper(page).isVisible()) === true, 'ドラッグ後に計画書が見えない');
    await page.screenshot({ path: path.join(shotsDir, '12-desktop-resized.png') });
    return `ドラッグで AI パネルが約 ${delta}px 広がった。計画書は見えたまま`;
  });

  await check(`${label}：保存処理への書き込みが増えていない`, async () => {
    const now = await writeCalls(page);
    assert(now === baselineWrites, `書き込みの呼び出しが増えた（${baselineWrites} → ${now}）`);
    return `開発用の表示中の操作で、保存の呼び出し 0 件（起動時の既存の呼び出し ${baselineWrites} 件は除く）`;
  });

  await page.close();
}

async function runTablet(browser, w, h, shotBase) {
  const label = `タブレット ${w}px`;
  const page = await newPage(browser, w, h, label);
  const appScroll = page.locator('#app-scroll');
  const headerBtn = appScroll.getByRole('button', { name: 'AI経営コンサルタント', exact: true });
  const drawer = page.locator('div[aria-hidden].fixed.inset-0').filter({ has: page.getByPlaceholder('質問を入力してください') });
  const drawerOpen = async () => (await drawer.getAttribute('aria-hidden')) === 'false';
  const drawerClose = () => drawer.getByRole('button', { name: '閉じる', exact: true });

  await check(`${label}：従来の画面では、ドロワーに「閉じる」を出さない（既存の挙動のまま）`, async () => {
    await headerBtn.click();
    await page.waitForTimeout(350);
    const n = await drawerClose().count();
    await page.mouse.click(Math.round(w * 0.2), 450);
    await page.waitForTimeout(350);
    assert(n === 0, `従来の画面に閉じるボタンが出ている（${n}）`);
    return '従来の画面は既存のまま（背景タップで閉じる）';
  });

  await openDevDoc(page);

  await check(`${label}：初期状態でAI経営コンサルタントは閉じ、計画書が読みやすい幅で出る`, async () => {
    assert((await drawerOpen()) === false, '初期状態で開いている');
    const p = await paper(page).boundingBox();
    const min = w >= 1024 ? 700 : 560;
    assert(p.width > min, `計画書が狭い（${Math.round(p.width)}px）`);
    await page.screenshot({ path: path.join(shotsDir, `${shotBase}-closed.png`) });
    return `計画書 ${Math.round(p.width)}px`;
  });

  await check(`${label}：ボタンで開き、「閉じる」ボタンで閉じられる`, async () => {
    await headerBtn.click();
    await page.waitForTimeout(400);
    assert((await drawerOpen()) === true, 'ボタンで開かない');
    assert((await drawerClose().count()) === 1, '閉じるボタンがない');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shotsDir, `${shotBase}-open.png`) });
    await drawerClose().click();
    await page.waitForTimeout(400);
    assert((await drawerOpen()) === false, '閉じるボタンで閉じない');
    return '開閉を確認';
  });

  await check(`${label}：背景をタップしても閉じられる`, async () => {
    await headerBtn.click();
    await page.waitForTimeout(400);
    await page.mouse.click(Math.round(w * 0.2), 450);
    await page.waitForTimeout(400);
    assert((await drawerOpen()) === false, '背景タップで閉じない');
    return null;
  });

  await check(`${label}：開閉しても、修正内容・AIへの入力・スクロール位置が失われない`, async () => {
    await page.getByRole('button', { name: '計画書を修正する' }).click();
    await page.getByRole('button', { name: '取り組む理由を修正する' }).click();
    await page.getByLabel('取り組む理由', { exact: true }).fill(REFLECT_TEXT);
    await page.getByRole('button', { name: 'この部分を閉じる' }).first().click();
    await appScroll.evaluate((el) => { el.scrollTop = 400; });
    const before = await appScroll.evaluate((el) => el.scrollTop);

    await headerBtn.click();
    await page.waitForTimeout(350);
    await drawer.getByPlaceholder('質問を入力してください').fill(CHAT_TEXT);
    await drawerClose().click();
    await page.waitForTimeout(350);

    await headerBtn.click();
    await page.waitForTimeout(350);
    const chat = await drawer.getByPlaceholder('質問を入力してください').inputValue();
    assert(chat === CHAT_TEXT, 'AIへの入力が消えた');
    await drawerClose().click();
    await page.waitForTimeout(350);

    const after = await appScroll.evaluate((el) => el.scrollTop);
    assert(Math.abs(after - before) <= 2, `スクロールが変わった（${before} → ${after}）`);
    assert((await paper(page).innerText()).includes(REFLECT_TEXT), '修正内容が消えた');
    assert((await page.getByRole('button', { name: '修正を反映する' }).count()) === 1, '編集の状態が終わった');
    await page.getByRole('button', { name: '修正をやめる' }).click();
    return `スクロール ${Math.round(before)}px のまま、修正・AIへの入力を保持`;
  });

  await check(`${label}：AI経営コンサルタントの見出しが重複しない`, async () => {
    await headerBtn.click();
    await page.waitForTimeout(350);
    const text = await drawer.innerText();
    const n = text.split('AI経営コンサルタント').length - 1;
    await drawerClose().click();
    await page.waitForTimeout(300);
    assert(n === 1, `見出しが ${n} 回出ている`);
    return '見出しは1回';
  });

  await page.close();
}

(async () => {
  fs.mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch();

  await runDesktop(browser);
  await runTablet(browser, 1024, 768, '20-tablet-1024');
  await runTablet(browser, 768, 1024, '21-tablet-768');

  await check('通信：file:// 以外への通信がない', async () => {
    assert(external.length === 0, `外部通信 ${external.length} 件：${external.slice(0, 3).join(', ')}`);
    return '外部通信0件';
  });
  await check('ブラウザ実行中に例外・コンソールエラーがない', async () => {
    assert(errors.length === 0, errors.slice(0, 3).join(' | '));
    return 'エラー0件';
  });

  await browser.close();
  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(JSON.stringify({ total: results.length, pass }));
  if (pass !== results.length) process.exitCode = 1;
})();
