/* 新STAGE3の一連操作をブラウザ（Chromium）で確かめる（評価専用）。
 * 2部門の架空データ、ローカルDB（PGlite）、既存のAIモックを使う。外部への接続はしない。1つでも失敗すれば終了コード1。
 * 画面は、上部の部門管理と、概要・部門別・部門間調整のタブで操作する。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3917);
const shots = path.join(here, 'out', 'shots');

const results = [];

/* ダウンロードしたPDFを、PDF.js（既存の依存）で開いて検査する（ページ数・大きさ） */
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
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
const openMgmt = async () => {
  const open = btn('事業・部門の追加・管理');
  if ((await open.count()) > 0) await open.click();
};

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
  await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });

  await step('① 概要：STAGE2確定版は「全社戦略書を読む」で別タブに開き、本文は展開せず、誤った案内も出ない', async () => {
    const link = page.getByRole('link', { name: '全社戦略書を読む', exact: true });
    const href = (await link.getAttribute('href')) ?? '';
    const target = (await link.getAttribute('target')) ?? '';
    const expanded = await text('再発注の処理時間が半分になれば').count();
    const misleading = await page.getByText('STAGE2の確定版がありません').count();
    const alerts = await page.getByRole('alert').count();
    check('① 概要：「全社戦略書を読む」は別タブで戦略書を開き、本文は展開されない', href === '/report/stage2-strategy' && target === '_blank' && expanded === 0 && misleading === 0 && alerts === 0, `href=${href} target=${target} 展開${expanded}件 誤表示${misleading}件 上部の案内${alerts}件`);
    await shot('01-overview');
  });

  await step('① 部門の削除：承認済みの計画がある部門は、削除できない理由を簡潔に示して押せない', async () => {
    await openMgmt();
    const disabled = await page.locator('li').filter({ hasText: '営業部' }).getByRole('button', { name: '削除', exact: true }).isDisabled();
    const reason = await page.getByText('関連データがあるため削除できません', { exact: false }).count();
    check('① 部門の削除：承認済みの計画がある部門は削除できず、理由が出る', disabled && reason > 0, `disabled=${disabled}`);
  });

  await step('② 概要：AIで戦略書のたたき台を作成（全部門）→ 未確定の草案として保存される', async () => {
    await savedOnClick(() => btn('全部門のたたき台をAIで作成').click());
    await text('版 1：初回のたたき台').waitFor({ timeout: 30000 });
    const st = await harnessState();
    check('② 初回のたたき台が保存され、正式な部門データは変わらない', st.departments[0].projects.length === 1 && st.departments[0].interDeptCollab === undefined);
  });

  await step('④ 営業部のたたき台：プロジェクトは開いて詳細を読め、正式と新規候補が区別できる', async () => {
    await tabBtn('営業部').click();
    const candidate = page.locator('details', { has: page.locator('summary', { hasText: '初回案：営業部の新しい施策' }) }).first();
    await candidate.locator('summary').click();
    const candidateReason = await candidate.getByText('既存顧客の再発注の手間を減らす施策', { exact: false }).isVisible();
    const candidateLabel = await candidate.getByText('新規候補（採用前）', { exact: true }).count();
    const official = page.locator('details', { has: page.locator('summary', { hasText: '既存顧客の再受注施策' }) }).first();
    const closedBefore = await official.evaluate((d) => !d.open);
    await official.locator('summary').click();
    const officialGoal = await official.getByText('再受注率 40%', { exact: false }).isVisible();
    const officialLabel = await official.getByText('既存（正式データ）', { exact: true }).count();
    check(
      '④ プロジェクト案：開くと詳細が出て、正式と新規候補が区別できる',
      closedBefore && candidateReason && candidateLabel === 1 && officialGoal && officialLabel === 1,
      `候補の理由 ${candidateReason} / 候補の表示 ${candidateLabel} / 正式の目標 ${officialGoal} / 正式の表示 ${officialLabel}`,
    );
    await shot('C-project-cards');
  });

  await step('③-a 営業部タブ：既存の6問に1件回答して保存（残りは空欄）', async () => {
    await tabBtn('営業部').click();
    await text('既存の6問（空欄でも可）').waitFor();
    await page.locator('textarea').first().fill('既存顧客の再発注は、書類の作成を一度で済ませる形にする');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/harness/answers') && r.request().method() === 'POST'),
      btn('次のテーマへ').first().click(),
    ]);
    const st = await harnessState();
    const steps = st.departments[0].answers2?.[0]?.steps ?? [];
    check('③-a 6問の回答が保存される（部門の回答に残る）', steps.some((s) => String(s.answer ?? '').includes('書類の作成')), `回答 ${steps.length}件`);
    await text('検証用のテーマ2').waitFor({ timeout: 15000 });
    const genBtn = await btn('テーマを生成').count();
    check('③-a 「次のテーマへ」で次のテーマが自動で出て、「テーマを生成」は表示されない', genBtn === 0, `テーマを生成 ${genBtn}件`);
    await shot('B-six-questions');
  });

  await step('③-d 営業部：保存していない回答も、再生成のときに保存されて反映される', async () => {
    await page.locator('textarea').first().fill('未保存の回答：新規顧客は展示会で開拓する');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/harness/answers') && r.request().method() === 'POST'),
      savedOnClick(() => btn('6問を反映して戦略書を再生成').click()),
    ]);
    await text('再生成した戦略書を保存しました').waitFor({ timeout: 40000 });
    const st = await harnessState();
    const steps = st.departments[0].answers2?.[0]?.steps ?? [];
    check('③-d 未保存の回答が保存され、再生成に反映される', steps.some((s) => String(s.answer ?? '').includes('展示会で開拓')), `回答 ${steps.length}件`);
    await shot('D-regen-with-unsaved');
  });

  await step('③-e 営業部：回答の保存に失敗したら、再生成は行わず、エラーを出し、入力も残す', async () => {
    await tabBtn('営業部').click();
    await text('既存の6問（空欄でも可）').waitFor();
    await page.route('**/harness/answers', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' })
        : route.continue(),
    );
    const input = page.locator('textarea').first();
    await input.fill('保存されない回答：失敗の確認');
    let generateCalls = 0;
    const counter = (req) => {
      if (req.url().includes('/harness/generate')) generateCalls += 1;
    };
    page.on('request', counter);
    await btn('6問を反映して戦略書を再生成').click();
    await text('回答の保存に失敗したため、再生成していません').waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    page.off('request', counter);
    await page.unroute('**/harness/answers');
    const kept = (await input.inputValue()) === '保存されない回答：失敗の確認';
    check('③-e 保存に失敗すると再生成は実行されず、エラーが出て、入力も残る', generateCalls === 0 && kept, `再生成の要求 ${generateCalls}件 / 入力の保持 ${kept}`);
    await shot('E-save-failure');
  });

  await step('③-b 営業部タブ：6問を反映して戦略書を再生成 → 部門間の調整が最新案で自動分析される', async () => {
    await savedOnClick(() => btn('6問を反映して戦略書を再生成').click());
    await text('部門間の調整候補を1件表示しました').waitFor({ timeout: 40000 });
    await text('採用しませんでした').waitFor();
    check('③-b 再生成後、最新案で部門間調整が分析され、存在しないIDの候補は採用されない', true);
  });

  await step('③-c マーケティング部タブ：6問は空欄のまま再生成する（両部門の変更案がそろう）', async () => {
    await tabBtn('マーケティング部').click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/stage3/adjustment/analyze') && r.request().method() === 'POST'),
      savedOnClick(() => btn('6問を反映して戦略書を再生成').click()),
    ]);
    await tabBtn('マーケティング部').click();
    await text('新規の候補').waitFor({ timeout: 15000 });
    check('③-c マーケティング部：空欄の6問でも再生成でき、新規の候補が出る', true);
  });

  await step('④ 部門間調整タブ：候補を採用し、話し合いの結果を反映して変更案を作り直す', async () => {
    await tabBtn('部門間調整').click();
    await btn('採用').first().click();
    await page.getByPlaceholder('関係部門の話し合いの結果').first().fill('営業が担当し、マーケ部はリストを渡す');
    await savedOnClick(() => btn('話し合いの結果を保存').click());
    await savedOnClick(() => btn('話し合いの結果を反映して変更案を作る').click());
    await text('変更案を').waitFor({ timeout: 30000 });
    await shot('03-compare');
    check('④ 部門間調整タブで候補を採用し、話し合いの結果を反映して変更案を作り直せる', true);
  });

  await step('⑤-a 営業部タブ：戦略書の項目（使命）を編集して保存し、変更案を反映する', async () => {
    await tabBtn('営業部').click();
    const card = page.locator('div.rounded-xl.border-zinc-200').filter({ hasText: '事業・部門の使命' }).first();
    await card.getByRole('button', { name: '編集', exact: true }).click();
    await card.locator('textarea').fill('編集後：書類作成の手間をなくし、既存顧客の再発注を支える');
    await savedOnClick(() => card.getByRole('button', { name: '保存', exact: true }).click());
    const n = await btn('反映する').count();
    for (let i = 0; i < n; i += 1) await savedOnClick(() => btn('反映する').nth(i).click());
    check('⑤-a 営業部：戦略書の項目を編集して保存し、変更案を反映できる', n > 0, `反映 ${n}件`);
    await shot('C-regenerated-document');
  });

  await step('⑤-b 営業部タブ：新規プロジェクトを採用する', async () => {
    const adopt = btn('採用');
    if ((await adopt.count()) === 0) throw new Error('採用ボタンがない');
    await savedOnClick(() => adopt.first().click());
    check('⑤-b 営業部：新規プロジェクトを採用できる', true);
  });

  await step('⑤-c マーケティング部タブ：変更案は保留、不要な変更は反映しない、新規プロジェクトは不採用', async () => {
    await tabBtn('マーケティング部').click();
    await text('新規の候補').waitFor();
    await savedOnClick(() => btn('保留').first().click());
    const n = await btn('反映しない').count();
    for (let i = 0; i < n; i += 1) await savedOnClick(() => btn('反映しない').nth(i).click());
    const discard = await btn('不採用').count();
    for (let i = 0; i < discard; i += 1) await savedOnClick(() => btn('不採用').nth(i).click());
    check('⑤-c マーケティング部：保留・反映しない・不採用の判断ができる', true);
  });

  await step('⑥ 再読み込みで、編集・採否が復元される（営業部タブ）', async () => {
    await page.reload();
    await text('全社戦略（STAGE2）').waitFor();
    await tabBtn('営業部').click();
    await text('編集後：書類作成の手間をなくし').waitFor({ state: 'attached', timeout: 15000 });
    check('⑥ 再読み込み後も、編集した項目と採否が残っている', true);
  });

  await step('⑦ 部門間調整タブの確定：未判断がなくなった状態で、一括で確定する', async () => {
    await tabBtn('部門間調整').click();
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
    check('⑦-4 編集した使命と採用した変更が、正式データに反映された', String(sales.mission ?? '').includes('編集後'), String(sales.mission ?? ''));
    await shot('05-confirmed');
  });

  await step('⑧ 営業部タブ：この部門の戦略書をPDF出力（PDFとして開ける）', async () => {
    await tabBtn('営業部').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), btn('この部門の戦略書をPDF出力').click()]);
    const pdfPath = path.join(here, 'out', 'pdf', 'sales.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    await download.saveAs(pdfPath);
    const pdf = await inspectPdf(pdfPath);
    check('⑧-1 営業部のPDFが出力され、開ける', pdf.isPdf && pdf.pages >= 1, `${pdf.pages}ページ / ${(pdf.bytes / 1024).toFixed(0)}KB`);
    const reportText = JSON.stringify(await page.evaluate(() => window.__reportFor('営業部')));
    check('⑧-2 PDFの内容：会社名・部門名・採用した新規プロジェクト・既存の計画', reportText.includes('架空精密計測') && reportText.includes('既存顧客の再受注施策') && reportText.includes('6問反映案'));
    check('⑧-3 PDFの内容：他部門（マーケティング部）の計画が混入しない', !reportText.includes('既存顧客向けセミナー'));
  });

  await step('⑧-4 マーケティング部タブ：この部門の戦略書をPDF出力できる', async () => {
    await tabBtn('マーケティング部').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), btn('この部門の戦略書をPDF出力').click()]);
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
    await btn('この部門の戦略書をPDF出力').waitFor();
    check('⑨ 確定後も、確定済みの状態と部門のPDFボタンが出る', true);
  });

  await step('⑩ 監査ログに、確定が記録されている', async () => {
    const audit = await page.evaluate(async () => (await fetch('/harness/audit')).json());
    check('⑩ 監査ログに、確定が記録されている', (audit.audit ?? []).some((a) => a.action === 'stage3_strategy_book_confirmed'));
  });

  await step('⑪ 部門の追加：上部から部門を追加すると、自動で新しいタブが開く', async () => {
    await openMgmt();
    await page.getByLabel('新しい部門名').fill('研究開発部');
    await Promise.all([page.waitForResponse((r) => r.url().includes('/harness/department')), btn('部門を追加').click()]);
    await tabBtn('研究開発部').waitFor({ timeout: 15000 });
    await text('① 初回のたたき台').waitFor({ timeout: 15000 });
    const st = await harnessState();
    const firstAction = await btn('AIで戦略書のたたき台を作成').isEnabled();
    check('⑪ 部門を追加すると、正式な部門一覧に入り、新しいタブが開き、主ボタンが押せる', st.departments.length === 3 && st.departments[2].name === '研究開発部' && firstAction);
    const close = btn('事業・部門の管理を閉じる');
    if ((await close.count()) > 0) await close.click();
    await shot('A-initial-before-generate');
  });

  await step('⑪-a 新しい部門：たたき台をAIで作成できる', async () => {
    await savedOnClick(() => btn('AIで戦略書のたたき台を作成').click());
    await page.getByText('完了（開いて確認できます）').first().waitFor({ timeout: 30000 });
    const nextText = await text('6問は空欄のままでも構いません').count();
    check('⑪-a 新しい部門のたたき台が作成され、①は完了として折りたたまれ、次の操作（6問）が開く', nextText > 0);
    await shot('D-new-department-after-draft');
  });

  await step('⑫ 部門名の変更：名称を変えても、タブと一覧に反映される', async () => {
    await openMgmt();
    const row = page.locator('li').filter({ hasText: '研究開発部' }).first();
    await row.getByRole('button', { name: '名称を変更', exact: true }).click();
    await page.locator('input[aria-label="新しい部門名"]').fill('研究部');
    await Promise.all([page.waitForResponse((r) => r.url().includes('/harness/department')), btn('名称を保存').click()]);
    await tabBtn('研究部').waitFor({ timeout: 15000 });
    check('⑫ 部門名を変更すると、タブ名が変わる', true);
  });

  await step('⑬ 部門の削除：関連データのない新しい部門は削除できる', async () => {
    await openMgmt();
    const row = page.locator('li').filter({ hasText: '研究部' }).first();
    await Promise.all([page.waitForResponse((r) => r.url().includes('/harness/department')), row.getByRole('button', { name: '削除', exact: true }).click()]);
    await page.waitForTimeout(500);
    const left = await page.getByRole('navigation').getByRole('button', { name: /^研究部/ }).count();
    check('⑬ 関連データのない部門は削除でき、タブからも消える', left === 0, `残り ${left}件`);
    await shot('07-department-deleted');
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
