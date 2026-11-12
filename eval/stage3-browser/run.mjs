/* 新STAGE3の一連操作をブラウザ（Chromium）で確かめる（評価専用）。
 * 2部門の架空データ、ローカルDB（PGlite）、既存のAIモックを使う。外部への接続はしない。1つでも失敗すれば終了コード1。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3917);
const shots = path.join(here, 'out', 'shots');

const results = [];
let pdfReport = null;

/* ダウンロードしたPDFを、PDF.js（既存の依存）で開いて検査する */
async function inspectPdf(file) {
  const bytes = fs.readFileSync(file);
  const pdfjsPath = ['legacy/build/pdf.mjs', 'legacy/build/pdf.js'].map((p) => path.join(process.cwd(), 'node_modules/pdfjs-dist', p)).find((p) => fs.existsSync(p));
  const pdfjs = await import(pathToFileURL(pdfjsPath).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
  const pageTexts = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((it) => it.str).join(''));
  }
  return {
    isPdf: bytes.subarray(0, 4).toString('latin1') === '%PDF',
    bytes: bytes.length,
    pages: doc.numPages,
    pageTexts,
    text: pageTexts.join('\n'),
  };
}

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  -- ${detail}` : ''}`);
};

await build();
const { start } = await import(pathToFileURL(path.join(here, 'out', 'server.mjs')).href);
const clientJs = fs.readFileSync(path.join(here, 'out', 'client.js'), 'utf8');
const server = await start(PORT, clientJs);
const base = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
const apiFailures = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('response', async (r) => {
  if (r.url().includes('/api/stage3/') && r.status() >= 400) {
    apiFailures.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
});
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
});

const harnessState = async () => page.evaluate(async () => (await fetch('/harness/state')).json());
const savedOnClick = (fn) =>
  Promise.all([page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book') && r.request().method() === 'PUT'), fn()]);
const btn = (name) => page.getByRole('button', { name, exact: true });
const text = (t) => page.getByText(t, { exact: false }).first();

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0]);
    await page.screenshot({ path: path.join(shots, `fail-${results.length}.png`), fullPage: true }).catch(() => {});
  }
}

try {
  fs.mkdirSync(shots, { recursive: true });
  await page.goto(base + '/');
  await page.waitForSelector('text=事業・部門戦略書', { timeout: 30000 });

  await step('① 全社戦略（STAGE2確定版）の結論と全文が画面に出る', async () => {
    await text('既存顧客の深耕を優先し').waitFor({ timeout: 15000 });
    await text('確定した戦略ストーリー（全文）').waitFor();
    await text('再発注の処理時間が半分になれば').waitFor();
    check('① 全社戦略（STAGE2確定版）の結論と全文が画面に出る', true);
  });

  await step('② 初回のたたき台を作る（2部門）', async () => {
    await savedOnClick(() => btn('たたき台を作る（全部門）').click());
    await text('版 1（初回のたたき台').waitFor({ timeout: 20000 });
    await text('営業部の新しい施策').waitFor();
    await text('初回案：マーケティング部の新しい施策').waitFor();
    const st = await harnessState();
    check('② 初回のたたき台が2部門分、未確定の案として出る（正式データは変わらない）', st.departments[0].projects.length === 1 && st.departments[0].interDeptCollab === undefined);
  });

  await step('③-a 6問に回答し、回答が保存される（営業部は1件だけ回答）', async () => {
    await text('既存の6問への回答（空欄でも可）').waitFor();
    await page.locator('textarea').first().fill('既存顧客の再発注は、書類の作成を一度で済ませる形にする');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/harness/answers') && r.request().method() === 'POST'),
      btn('次のテーマへ').first().click(),
    ]);
    const st = await harnessState();
    const steps = st.departments[0].answers2?.[0]?.steps ?? [];
    check('③-a 6問の回答が保存される（部門の回答に残る）', steps.some((s) => String(s.answer ?? '').includes('書類の作成')), `回答 ${steps.length}件`);
  });

  await step('③ 残りの6問は空欄のまま、6問を反映して再生成し、最新案で部門間の調整候補を出す', async () => {
    await text('既存の6問への回答（空欄でも可）').waitFor();
    await savedOnClick(() => btn('6問を反映して再生成し、部門間の調整を分析する').click());
    await text('版 2（6問を反映した再生成案').waitFor({ timeout: 30000 });
    await text('部門間の調整候補を1件表示しました').waitFor({ timeout: 30000 });
    await text('既存顧客への重複施策').waitFor();
    await text('採用しませんでした').waitFor();
    check('③ 空欄の6問で再生成でき、保存されない候補（存在しないID）は採用せず件数が出る', true);
  });

  await step('④ 話し合いの結果を入力して保存し、変更案を作り直す', async () => {
    await page.getByPlaceholder('関係部門の話し合いの結果').first().fill('営業が担当し、マーケ部はリストを渡す');
    await savedOnClick(() => btn('話し合いの結果を保存').click());
    await savedOnClick(() => btn('話し合いの結果を反映して変更案を作る').click());
    await text('変更案を').waitFor({ timeout: 20000 });
    check('④ 話し合いの結果を入力して保存し、変更案を作り直せる', true);
  });

  await step('⑤ 候補・新規プロジェクトの採否を決め、変更案を編集して保存する', async () => {
    const adopt = page.getByRole('button', { name: '採用', exact: true });
    const n = await adopt.count();
    for (let i = 0; i < n; i += 1) {
      await savedOnClick(() => page.getByRole('button', { name: '採用', exact: true }).nth(i).click());
    }
    const editor = page.locator('div.rounded-2xl.border-zinc-200 textarea').nth(1);
    await editor.fill('編集後：マーケ部の役割は、リストの提供と結果の共有に限る');
    await savedOnClick(() => btn('編集を保存').first().click());
    check('⑤ 候補・新規プロジェクトを採用し、変更案の文章を編集して保存できる', true, `採用ボタン${n}件`);
  });

  await step('⑥ 再読み込みで、候補・対話・編集・採否が復元される', async () => {
    await page.reload();
    await text('事業・部門戦略書').waitFor();
    await text('既存顧客への重複施策').waitFor({ timeout: 15000 });
    await page.getByPlaceholder('関係部門の話し合いの結果').first().waitFor();
    const restoredDialogue = await page.getByPlaceholder('関係部門の話し合いの結果').first().inputValue();
    const restoredEdit = await page.locator('div.rounded-2xl.border-zinc-200 textarea').nth(1).inputValue();
    check('⑥ 再読み込みで、対話の結果・変更案の編集・採否が復元される', restoredDialogue.includes('営業が担当') && restoredEdit.includes('編集後'), `対話「${restoredDialogue}」`);
  });

  await step('⑦ 変更案を反映すると判断し、一括で確定する', async () => {
    const n = await btn('反映する').count();
    for (let i = 0; i < n; i += 1) {
      await savedOnClick(() => btn('反映する').nth(i).click());
    }
    const before = await harnessState();
    check('⑦-1 確定前は、正式データ（部門・プロジェクト）が変わっていない', before.departments[0].projects.length === 1 && before.departments[0].interDeptCollab === undefined);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book/confirm') && r.request().method() === 'POST'),
      btn('この内容で確定する').click(),
    ]);
    await text('確定済み（').waitFor({ timeout: 20000 });
    const msg = await page.evaluate(() => window.__confirmMessage ?? '');
    check('⑦-2 一括で確定され、確定の案内が出る', msg.includes('戦略書を確定しました'), msg);
  });

  await step('⑦-3 確定後の正式データ：新規プロジェクトは追加され、既存のプロジェクトIDとKPIは変わらない', async () => {
    const st = await harnessState();
    const sales = st.departments[0];
    const added = sales.projects.find((p) => String(p.title).includes('新しい施策'));
    check('⑦-3 確定後の正式データ：採用した新規プロジェクトが追加され、既存のプロジェクトIDとKPIは変わらない', sales.projects[0].id === 'p-1' && sales.projects[0].okrs?.[0]?.keyResults?.[0] === '再受注率 40%' && !!added && typeof added.id === 'string' && added.id !== 'p-1', `追加：${added?.title ?? 'なし'}・ID ${added?.id ?? ''}`);
    check('⑦-4 旧データの計画には、IDを自動で付けていない', st.departments[1].projects[0].id === undefined);
    check('⑦-5 協働の変更（採用した変更案）が正式データに反映された', typeof sales.interDeptCollab !== 'undefined' && sales.interDeptCollab.length > 0, JSON.stringify(sales.interDeptCollab));
  });

  await step('⑧ 部門別にPDF出力できる（確定版の内容を部門ごとに渡す）', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      btn('営業部のPDF').click(),
    ]);
    const pdfPath = path.join(here, 'out', 'pdf', 'sales.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    await download.saveAs(pdfPath);
    const pdf = await inspectPdf(pdfPath);
    pdf.fileName = download.suggestedFilename();
    pdfReport = pdf;
    check('⑧-1 営業部のPDFが実際にダウンロードされる（PDFファイルとして開ける）', pdf.isPdf && pdf.pages >= 1, `${pdf.pages}ページ / ${pdf.bytes}バイト / ${pdf.fileName}`);
    const reportText = JSON.stringify(await page.evaluate(() => window.__reportFor('営業部')));
    check('⑧-2 PDFに渡す報告データ：会社名・部門名・採用した新規プロジェクト・既存の計画が入る', reportText.includes('架空精密計測') && reportText.includes('営業部') && reportText.includes('既存顧客の再受注施策') && reportText.includes('6問反映案'));
    check('⑧-3 PDFに渡す報告データ：他部門（マーケティング部）の行動計画が混入しない', !reportText.includes('既存顧客向けセミナー'));
    check('⑧-4 PDFの大きさが配布できる範囲（20MB未満）', pdf.bytes < 20 * 1024 * 1024, `${(pdf.bytes / 1024 / 1024).toFixed(1)}MB`);
    const view = await browser.newPage({ viewport: { width: 900, height: 1200 } });
    await view.goto(base + '/pdfview?src=/pdf/sales.pdf');
    await view.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
    const pageCount = await view.evaluate(() => window.__pages);
    const ink = await view.evaluate(() => window.__ink);
    for (let i = 1; i <= pageCount; i += 1) {
      await view.locator(`#page-${i}`).screenshot({ path: path.join(here, 'out', 'pdf', `page-${i}.png`) });
    }
    await view.close();
    check('⑧-5 PDF：全ページが描画され、白紙のページがない（ページごとの描画量）', ink.length === pageCount && ink.every((r) => r > 0.01), ink.map((r) => r.toFixed(3)).join(','));
    pdfReport = { ...pdf, pageCount, ink };

    const [mktDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      btn('マーケティング部のPDF').click(),
    ]);
    const mktPath = path.join(here, 'out', 'pdf', 'marketing.pdf');
    await mktDownload.saveAs(mktPath);
    const mkt = await inspectPdf(mktPath);
    const mktData = JSON.stringify(await page.evaluate(() => window.__reportFor('マーケティング部')));
    check('⑧-6 マーケティング部のPDF：自部門の計画だけが入り、営業部の計画は入らない', mkt.isPdf && mkt.pages >= 1 && mktData.includes('既存顧客向けセミナー') && !mktData.includes('既存顧客の再受注施策'), `${mkt.pages}ページ / ${(mkt.bytes / 1024).toFixed(0)}KB / ${mktDownload.suggestedFilename()}`);
  });

  await step('⑨ 確定後に再読み込みしても、確定済みの状態が復元される', async () => {
    await page.reload();
    await text('確定済み（').waitFor({ timeout: 15000 });
    await btn('営業部のPDF').waitFor();
    check('⑨ 確定後に再読み込みしても、確定済みの状態とPDF出力ボタンが出る', true);
  });

  await step('⑩ 監査ログに、確定が記録されている', async () => {
    const audit = await page.evaluate(async () => (await fetch('/harness/audit')).json());
    const hit = (audit.audit ?? []).some((a) => a.action === 'stage3_strategy_book_confirmed');
    check('⑩ 監査ログに、確定が記録されている', hit);
  });

  await page.screenshot({ path: path.join(shots, 'final.png'), fullPage: true });
} finally {
  for (const f of apiFailures) console.log('  API ' + f);
  const realErrors = pageErrors.filter((e) => !/Download the React DevTools|favicon|Failed to load resource/i.test(e));
  check('ページのエラーが出ていない', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n合計 ${results.length} 件 / 失敗 ${failed.length} 件`);
process.exit(failed.length > 0 ? 1 : 0);
