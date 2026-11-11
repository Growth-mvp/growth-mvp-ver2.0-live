/* STAGE2 全社戦略書：旧データ（確定済み）と初回確定前のドラフトを、実アプリの報告画面で表示し、既存のPDF出力で書き出す（評価専用。DB・外部APIには接続しない） */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.join(__dirname, '..', 'results-browser');
const fileUrl = (name) => 'file:///' + path.join(outDir, name).replace(/\\/g, '/');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });

const FIXED_TEXTS = ['KEY MESSAGE', 'Strategic Implications', 'Next Questions', 'Downstream Design', '次のステップ', '社員に伝えたい', '既存市場の延長では', '対象年度'];

async function openAndExport(browser, shellName, pdfName) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(fileUrl(shellName));
  await page.waitForSelector('#stage2-strategy-report', { state: 'attached', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#stage2-strategy-report')?.innerText.includes('全社戦略書'), null, { timeout: 60000 });
  const text = await page.locator('#stage2-strategy-report').innerText();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('button', { name: 'PDF出力' }).click(),
  ]);
  const pdfPath = path.join(outDir, pdfName);
  await download.saveAs(pdfPath);
  await page.close();
  return { text, pdfPath, errors };
}

(async () => {
  const browser = await chromium.launch();

  // 旧データ：確定済みのまま表示され、保存済みの値が使われ、固定文は出ない
  const legacy = await openAndExport(browser, 'shell-stage2-report-legacy.html', 'stage2-report-legacy.pdf');
  check('旧データ：確定版と表示される', legacy.text.includes('状態：確定版'));
  check('旧データ：未確定扱いにならない', !legacy.text.includes('未確定'));
  check('旧データ：保存済みの結論を使う', legacy.text.includes('旧データで保存済みの結論'));
  check('旧データ：AI結論で上書きしない', !legacy.text.includes('AI生成の結論'));
  check('旧データ：4章本文を含む', ['確定版・第1章', '確定版・第4章'].every((t) => legacy.text.includes(t)));
  check('旧データ：中計の判断基準を含む', legacy.text.includes('顧客の稼働率を高める投資を優先する'));
  check('旧データ：数値目標の単位・年度', ['12,000 百万円', '1,500 百万円'].every((t) => legacy.text.includes(t)) && legacy.text.includes('2029年度'));
  check('旧データ：対象年度を表示しない', !legacy.text.includes('対象年度'));
  check('旧データ：固定文を含まない', FIXED_TEXTS.filter((t) => t !== '対象年度').every((t) => !legacy.text.includes(t)), FIXED_TEXTS.filter((t) => legacy.text.includes(t)).join(','));
  check('旧データ：画面のエラーなし', legacy.errors.length === 0, legacy.errors.join(' | '));

  // 初回確定前のドラフト：確定版と誤表示されない
  const draft = await openAndExport(browser, 'shell-stage2-report-draft.html', 'stage2-report-draft.pdf');
  check('ドラフト：確定版と表示しない', !draft.text.includes('状態：確定版') && draft.text.includes('ドラフト（未確定）'));
  check(
    'ドラフト：下書きの結論はドラフト表示の下に表示（確定版の表記なし）',
    draft.text.indexOf('ドラフト（未確定）') < draft.text.indexOf('未確定の下書き結論') && !draft.text.includes('確定版'),
  );
  check('ドラフト：画面のエラーなし', draft.errors.length === 0, draft.errors.join(' | '));

  // STAGE2 画面の最終確定タブ：確定状態の表示、未確定の変更の表示（実際の画面操作）
  async function openFinalTab(shellName) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(fileUrl(shellName));
    await page.waitForFunction(() => document.body.innerText.includes('最終確定'), null, { timeout: 60000 });
    await page.getByRole('button', { name: '最終確定' }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes('全社戦略書'), null, { timeout: 60000 });
    const text = await page.locator('body').innerText();
    await page.close();
    return { text, errors };
  }

  const finalLegacy = await openFinalTab('shell-stage2-final-legacy.html');
  check('最終確定（旧データ）：確定済みと表示', finalLegacy.text.includes('✓ 確定済み'));
  check('最終確定（旧データ）：未確定の表示なし', !finalLegacy.text.includes('変更内容は未確定です'));
  check('最終確定（旧データ）：保存済みの結論を表示', finalLegacy.text.includes('旧データで保存済みの結論'));
  check('最終確定（旧データ）：画面のエラーなし', finalLegacy.errors.length === 0, finalLegacy.errors.join(' | '));

  const finalUnconfirmed = await openFinalTab('shell-stage2-final-unconfirmed.html');
  check('最終確定（確定後の編集）：未確定と表示', finalUnconfirmed.text.includes('変更内容は未確定です'));
  check('最終確定（確定後の編集）：確定済みの表示なし', !finalUnconfirmed.text.includes('✓ 確定済み'));
  check('最終確定（確定後の編集）：保存した本文を表示', finalUnconfirmed.text.includes('下書き本文・第1章'));
  check('最終確定（確定後の編集）：保存した結論・判断基準を表示', finalUnconfirmed.text.includes('下書きの結論（未確定）') && finalUnconfirmed.text.includes('下書きの判断基準（未確定）'));
  check('最終確定（確定後の編集）：画面のエラーなし', finalUnconfirmed.errors.length === 0, finalUnconfirmed.errors.join(' | '));

  const mismatch = await openFinalTab('shell-stage2-final-mismatch.html');
  check('確定前の検査：業績目標の不一致を知らせる', mismatch.text.includes('確定前に確認してください') && mismatch.text.includes('業績目標（120億円') === false && mismatch.text.includes('一致しません'));
  check('確定前の検査：社内の工程名を知らせる', mismatch.text.includes('社内の工程名'));
  check('確定前の検査：画面のエラーなし', mismatch.errors.length === 0, mismatch.errors.join(' | '));

  // 中計の空項目：既存の構造化データからの候補を、編集画面で確認して採用する（確定値への自動書込みはない）
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(fileUrl('shell-stage2-final-candidates.html'));
    await page.waitForFunction(() => document.body.innerText.includes('最終確定'), null, { timeout: 60000 });
    await page.getByRole('button', { name: '最終確定' }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes('全社戦略書'), null, { timeout: 60000 });
    const before = await page.locator('body').innerText();
    check('候補：閲覧画面には候補を出さない', !before.includes('既存データからの候補'));
    await page.getByRole('button', { name: '本文を編集する' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('既存データからの候補'), null, { timeout: 60000 });
    const editing = await page.locator('body').innerText();
    check('候補：編集画面で既存データからの候補を表示', editing.includes('点検サービスの高付加価値化') && editing.includes('設備を止めない提案力'));
    const countBefore = (editing.match(/既存データからの候補/g) || []).length;
    await page.getByRole('button', { name: 'この候補を採用' }).first().click();
    const after = await page.locator('body').innerText();
    const countAfter = (after.match(/既存データからの候補/g) || []).length;
    check('候補：採用すると入力欄に入り、候補の表示が減る', countAfter === countBefore - 1, countBefore + '→' + countAfter);
    const inField = await page.locator('textarea').evaluateAll((els) => els.some((e) => e.value.includes('設備を止めない提案力')));
    check('候補：採用した項目が入力欄に入る', inField);
    check('候補：画面のエラーなし', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // 業績目標の不一致：確定を開始せず、修正箇所を知らせる
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(fileUrl('shell-stage2-final-mismatch.html'));
    await page.waitForFunction(() => document.body.innerText.includes('最終確定'), null, { timeout: 60000 });
    await page.getByRole('button', { name: '最終確定' }).first().click();
    await page.waitForFunction(() => document.body.innerText.includes('全社戦略書'), null, { timeout: 60000 });
    await page.getByRole('button', { name: '全社戦略を確定し、STAGE3へ引き渡す' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('確定できません'), null, { timeout: 30000 });
    const blocked = await page.locator('body').innerText();
    check('不一致：確定をブロックし、修正箇所を知らせる', blocked.includes('登録目標 12,000 百万円（2029年度）') && blocked.includes('売上130億円'));
    check('不一致：確定を開始していない（確定済みにならない）', !blocked.includes('✓ 確定済み') && !blocked.includes('STAGE3へ引き渡しました'));
    check('不一致：画面のエラーなし', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  const noMidterm = await openAndExport(browser, 'shell-stage2-report-no-midterm.html', 'stage2-report-no-midterm.pdf');
  check('中計未生成：PDFに「（未入力）」が出ない', !noMidterm.text.includes('（未入力）'), noMidterm.text.match(/（未入力）/g)?.length ?? 0);
  check('中計未生成：空の項目の見出しを出さない', !noMidterm.text.includes('目指す姿') && !noMidterm.text.includes('重点戦略テーマ'));
  check('中計未生成：結論と数値目標は表示', noMidterm.text.includes('保存済みの結論') && noMidterm.text.includes('12,000 百万円'));
  check('中計未生成：画面のエラーなし', noMidterm.errors.length === 0, noMidterm.errors.join(' | '));

  for (const name of ['stage2-report-legacy.pdf', 'stage2-report-no-midterm.pdf']) {
    const size = fs.statSync(path.join(outDir, name)).size;
    check('PDFサイズ：' + name, size < 10 * 1024 * 1024, Math.round(size / 1024 / 1024 * 10) / 10 + ' MB');
  }

  await browser.close();
  for (const r of results) console.log(`${r.status}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  fs.writeFileSync(path.join(outDir, 'stage2-document-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some((r) => r.status === 'FAIL') ? 1 : 0);
})().catch((e) => {
  console.error('run failed:', e.message);
  process.exit(1);
});
