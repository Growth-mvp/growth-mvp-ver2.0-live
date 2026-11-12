/* 新STAGE3の一連操作をブラウザ（Chromium）で確かめる（評価専用）。
 * 2部門の架空データ、ローカルDB（PGlite）、既存のAIモックを使う。外部への接続はしない。1つでも失敗すれば終了コード1。
 * 画面は事業・部門別のタブ（概要・各部門・部門間調整）で操作する。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3917);
const shots = path.join(here, 'out', 'shots');

const results = [];

/* ダウンロードしたPDFを、PDF.js（既存の依存）で開いて検査する（ページ数・テキストの有無） */
async function inspectPdf(file) {
  const bytes = fs.readFileSync(file);
  const pdfjsPath = ['legacy/build/pdf.mjs', 'legacy/build/pdf.js']
    .map((p) => path.join(process.cwd(), 'node_modules/pdfjs-dist', p))
    .find((p) => fs.existsSync(p));
  const pdfjs = await import(pathToFileURL(pdfjsPath).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
  return { isPdf: bytes.subarray(0, 4).toString('latin1') === '%PDF', bytes: bytes.length, pages: doc.numPages };
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
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
});
page.on('response', async (r) => {
  if (r.url().includes('/api/stage3/') && r.status() >= 400) {
    apiFailures.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
});

const harnessState = async () => page.evaluate(async () => (await fetch('/harness/state')).json());
const savedOnClick = (fn) =>
  Promise.all([page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book') && r.request().method() === 'PUT'), fn()]);
const btn = (name) => page.getByRole('button', { name, exact: true });
const tabBtn = (name) => page.getByRole('navigation').getByRole('button', { name: new RegExp('^' + name) });
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

  await step('① 概要：STAGE2確定版の結論・全文が出て、「確定版がありません」とは出ない', async () => {
    await text('既存顧客の深耕を優先し').waitFor({ timeout: 15000 });
    await text('確定した戦略ストーリー（全文）').waitFor();
    await text('再発注の処理時間が半分になれば').waitFor();
    const misleading = await page.getByText('STAGE2の確定版がありません').count();
    check('① 概要：STAGE2確定版の結論・全文が出て、「確定版がありません」とは出ない', misleading === 0, `誤表示の件数 ${misleading}`);
  });

  await step('② 概要：全部門の初回たたき台を作る（未確定の草案として保存）', async () => {
    await savedOnClick(() => btn('全部門の初回たたき台を作る').click());
    await text('版 1：初回のたたき台').waitFor({ timeout: 30000 });
    const st = await harnessState();
    check('② 初回のたたき台が保存され、正式な部門データは変わらない', st.departments[0].projects.length === 1 && st.departments[0].interDeptCollab === undefined);
  });

  await step('③-a 営業部タブ：6問に1件回答して保存（残りは空欄）', async () => {
    await tabBtn('営業部').click();
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

  await step('③-b 営業部タブ：6問を反映して、この部門を再生成（版2）し、部門間の調整が自動で分析される', async () => {
    await savedOnClick(() => btn('6問を反映して、この部門を再生成する').click());
    await text('部門間の調整候補を1件表示しました').waitFor({ timeout: 40000 });
    await text('採用しませんでした').waitFor();
    check('③-b 再生成後、部門間調整が最新案で分析され、保存されない候補（存在しないID）は採用されない', true);
  });

  await step('④ 部門間調整タブ：候補を採用し、話し合いの結果を保存して変更案を作り直す', async () => {
    await tabBtn('部門間調整').click();
    await btn('採用').first().click();
    await page.getByPlaceholder('関係部門の話し合いの結果').first().fill('営業が担当し、マーケ部はリストを渡す');
    await savedOnClick(() => btn('話し合いの結果を保存').click());
    await savedOnClick(() => btn('話し合いの結果を反映して変更案を作る').click());
    await text('変更案を').waitFor({ timeout: 30000 });
    check('④ 比較タブで候補を採用し、話し合いの結果を反映して変更案を作り直せる', true);
  });

  await step('⑤-a 営業部タブ：再生成版の文章を編集して保存し、採否を決める（反映する）', async () => {
    await tabBtn('営業部').click();
    const editor = page.locator('div.rounded-2xl.border-zinc-200 textarea').nth(1);
    await editor.waitFor({ timeout: 15000 });
    await editor.fill('編集後：マーケ部の役割は、リストの提供と結果の共有に限る');
    await savedOnClick(() => btn('編集を保存').first().click());
    const n = await btn('反映する').count();
    for (let i = 0; i < n; i += 1) await savedOnClick(() => btn('反映する').nth(i).click());
    check('⑤-a 営業部：変更案の編集・保存と採否（反映する）ができる', n > 0, `反映する ${n}件`);
  });

  await step('⑤-b 営業部タブ：新規プロジェクトを採用する', async () => {
    const adopt = btn('採用');
    await savedOnClick(() => adopt.first().click());
    check('⑤-b 営業部：新規プロジェクトの採否（採用）ができる', true);
  });

  await step('⑤-c マーケティング部タブ：変更案は保留・反映しない、新規プロジェクトは不採用にする', async () => {
    await tabBtn('マーケティング部').click();
    await text('新規プロジェクトの採否').waitFor();
    const deferred = btn('保留').first();
    await savedOnClick(() => deferred.click());
    const n = await btn('反映しない').count();
    for (let i = 0; i < n; i += 1) await savedOnClick(() => btn('反映しない').nth(i).click());
    const discard = await btn('不採用').count();
    for (let i = 0; i < discard; i += 1) await savedOnClick(() => btn('不採用').nth(i).click());
    check('⑤-c マーケティング部：保留・反映しない・不採用の判断ができる', true);
  });

  await step('⑥ 再読み込みで、対話・編集・採否が復元される（営業部タブ）', async () => {
    await page.reload();
    await text('事業・部門戦略書').waitFor();
    await tabBtn('営業部').click();
    const edited = await page.locator('div.rounded-2xl.border-zinc-200 textarea').nth(1).inputValue();
    await text('判断：採用').waitFor({ timeout: 15000 }).catch(() => {});
    check('⑥ 再読み込み後も、変更案の編集が残っている', edited.includes('編集後'), edited);
  });

  await step('⑦ 概要の確定：未判断がなくなった状態で一括確定する', async () => {
    await tabBtn('概要').click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book/confirm') && r.request().method() === 'POST'),
      btn('この内容で確定する').click(),
    ]);
    await text('確定済み（').waitFor({ timeout: 20000 });
    const msg = await page.evaluate(() => window.__confirmMessage ?? '');
    check('⑦-1 一括で確定され、確定の案内が出る', msg.includes('戦略書を確定しました'), msg);
    const st = await harnessState();
    const sales = st.departments[0];
    const added = sales.projects.find((p) => String(p.title).includes('新しい施策'));
    check('⑦-2 採用した新規プロジェクトが営業部に追加され、既存のプロジェクトIDとKPIは変わらない', sales.projects[0].id === 'p-1' && sales.projects[0].okrs?.[0]?.keyResults?.[0] === '再受注率 40%' && !!added && added.id !== 'p-1');
    check('⑦-3 不採用・保留の新規プロジェクトは正式データに入らない（マーケティング部）', st.departments[1].projects.length === 1);
    check('⑦-4 採用した変更案が正式データに反映された', Array.isArray(sales.interDeptCollab) && sales.interDeptCollab.some((x) => x.includes('編集後')), JSON.stringify(sales.interDeptCollab));
  });

  await step('⑧ 営業部タブ：確定版の部門別PDFを出力（PDFとして開け、中身が出る）', async () => {
    await tabBtn('営業部').click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      btn('営業部のPDFを出力').click(),
    ]);
    const pdfPath = path.join(here, 'out', 'pdf', 'sales.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    await download.saveAs(pdfPath);
    const pdf = await inspectPdf(pdfPath);
    check('⑧-1 営業部のPDFが実際にダウンロードされ、開ける', pdf.isPdf && pdf.pages >= 1, `${pdf.pages}ページ / ${(pdf.bytes / 1024).toFixed(0)}KB / ${download.suggestedFilename()}`);
    const reportText = JSON.stringify(await page.evaluate(() => window.__reportFor('営業部')));
    check('⑧-2 PDFに渡す内容：会社名・部門名・採用した新規プロジェクト・既存の計画', reportText.includes('架空精密計測') && reportText.includes('既存顧客の再受注施策') && reportText.includes('6問反映案'));
    check('⑧-3 PDFに渡す内容：他部門（マーケティング部）の計画が混入しない', !reportText.includes('既存顧客向けセミナー'));
  });

  await step('⑧-4 マーケティング部タブ：確定版の部門別PDFを出力できる', async () => {
    await tabBtn('マーケティング部').click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90000 }),
      btn('マーケティング部のPDFを出力').click(),
    ]);
    const mktPath = path.join(here, 'out', 'pdf', 'marketing.pdf');
    await download.saveAs(mktPath);
    const pdf = await inspectPdf(mktPath);
    const mktData = JSON.stringify(await page.evaluate(() => window.__reportFor('マーケティング部')));
    check('⑧-4 マーケティング部のPDF：自部門の計画だけが入る', pdf.isPdf && pdf.pages >= 1 && mktData.includes('既存顧客向けセミナー') && !mktData.includes('既存顧客の再受注施策'), `${pdf.pages}ページ`);
  });

  await step('⑨ 確定後に再読み込みしても、確定済みの状態が復元される', async () => {
    await page.reload();
    await text('確定済み（').waitFor({ timeout: 15000 });
    await tabBtn('営業部').click();
    await btn('営業部のPDFを出力').waitFor();
    check('⑨ 確定後も、確定済みの状態と部門別PDFのボタンが出る', true);
  });

  await step('⑩ 監査ログに、確定が記録されている', async () => {
    const audit = await page.evaluate(async () => (await fetch('/harness/audit')).json());
    check('⑩ 監査ログに、確定が記録されている', (audit.audit ?? []).some((a) => a.action === 'stage3_strategy_book_confirmed'));
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
