/* 新STAGE3の操作の流れを、ブラウザ（Chromium）で確かめる（評価専用）。
 * 旧方式の未判断が残った状態から、STEP1〜5を通して確定できること、STEP切替で編集が消えないこと、確定後の導線を確認する。
 * 架空データ・ローカルDB（PGlite）・AIの固定応答を使う。外部への接続はしない。1つでも失敗すれば終了コード1。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3919);
const shots = path.join(here, 'out', 'shots-flow');

const results = [];
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
page.on('response', (r) => {
  if (r.url().includes('/api/stage3/') && r.status() >= 400) apiFailures.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
});

const api = (url, body) =>
  page.evaluate(
    async ({ url, body }) => {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test:00000000-0000-4000-8000-00000000ad01' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { url: base + url, body },
  );
const harnessState = async () => (await api('/harness/state')).body;
const btn = (name) => page.getByRole('button', { name, exact: true });
const stepBtn = (prefix) => page.getByRole('navigation', { name: '戦略書の作業手順' }).getByRole('button', { name: new RegExp(`^${prefix}`) });
const deptTab = (name) => page.getByRole('navigation', { name: '事業・部門ごとのタブ' }).getByRole('button', { name: new RegExp(`^${name}`) });
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
const savedOnClick = (fn) =>
  Promise.all([page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book') && r.request().method() === 'PUT'), fn()]);

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0]);
    await page.screenshot({ path: path.join(shots, `fail-${results.length}.png`), fullPage: true }).catch(() => {});
  }
}

const IDS = { company: '00000000-0000-4000-8000-00000000c0de', strategy: '00000000-0000-4000-8000-0000000057a1' };
const statusOf = (stepLabel) => stepBtn(stepLabel).getAttribute('aria-current');

try {
  fs.mkdirSync(shots, { recursive: true });

  await step('準備：検証用データを初期化して画面を開く', async () => {
    await page.goto(base + '/harness/state');
    await api('/harness/reset', {});
    await page.goto(base + '/');
    await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });
    await deptTab('営業部').waitFor({ timeout: 30000 });
    check('準備：部門タブが表示される', true);
  });

  await step('STEP1：営業部・マーケティング部のたたき台を作る（未確定）', async () => {
    await savedOnClick(() => btn('AIで戦略書のたたき台を作成').click());
    await page.getByText('たたき台作成済み').first().waitFor({ timeout: 30000 });
    check('STEP1：たたき台が作られ、STEP1が現在のSTEPになる', (await statusOf('STEP1')) === 'step', `aria-current=${await statusOf('STEP1')}`);
    await deptTab('マーケティング部').click();
    await savedOnClick(() => btn('AIで戦略書のたたき台を作成').click());
    await deptTab('営業部').click();
    check('STEP1：両部門のたたき台が保存される', true);
  });

  await step('STEP2：6問を反映して再生成する（両部門）', async () => {
    for (const name of ['営業部', 'マーケティング部']) {
      await deptTab(name).click();
      await stepBtn('STEP2').click();
      await savedOnClick(() => btn('6問を反映して戦略書を再生成').click());
      await page.getByText('再生成版・未確定').first().waitFor({ timeout: 30000 });
    }
    check('STEP2：両部門の再生成が保存される', true);
  });

  await step('旧方式の未判断を再現：マーケティング部の変更案が「未判断」のまま残った状態で開き直す', async () => {
    const r = await api('/harness/legacy-pending', {});
    check('再現：旧方式の未判断の選択を作った', r.status === 200 && r.body?.pending > 0, `選択 ${r.body?.pending}件`);
    await page.reload();
    await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });
    await deptTab('営業部').waitFor({ timeout: 30000 });
    const sel = await api(`/api/stage3/strategy-book?companyId=${IDS.company}&strategyId=${IDS.strategy}`);
    const pendingLeft = (sel.body?.state?.selections ?? []).filter((s) => s.decision === 'pending').length;
    check('解消：読み込み時に、旧方式の未判断が確定の対象として残らない', sel.status === 200 && pendingLeft === 0, `未判断 ${pendingLeft}件 / 整理 ${JSON.stringify(sel.body?.legacySettled)}`);
    check('解消：画面に「未判断の変更案が…件」の表示が出ない', (await page.getByText('未判断の変更案が').count()) === 0);
  });

  await step('STEP3：戦略書の使命を編集して保存する（営業部）', async () => {
    await deptTab('営業部').click();
    await stepBtn('STEP3').click();
    await btn('戦略書を編集').click();
    await page.getByRole('button', { name: '事業・部門の使命を修正する' }).click();
    const mission = page.getByRole('textbox', { name: '事業・部門の使命' });
    await mission.fill('編集後：書類作成の手間をなくし、既存顧客の再発注を支える');
    await savedOnClick(() => btn('編集を保存').click());
    await page.getByText('戦略書の編集を保存しました').first().waitFor({ timeout: 15000 });
    check('STEP3：編集の保存が完了する', true);
  });

  await step('STEP切替：未保存の編集があると、移動の前に確認が出る（キャンセルでは移動しない）', async () => {
    await btn('戦略書を編集').click();
    await page.getByRole('button', { name: '事業・部門の使命を修正する' }).click();
    const mission = page.getByRole('textbox', { name: '事業・部門の使命' });
    await mission.fill('未保存の編集（移動で消えるか確認）');
    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      d.dismiss();
    });
    await stepBtn('STEP1').click();
    await page.waitForTimeout(300);
    check('STEP切替：移動の前に確認が出る', asked.includes('保存していない編集'), asked.slice(0, 40));
    check('STEP切替：キャンセルすると編集中のままSTEP3に残る', (await statusOf('STEP3')) === 'step' && (await btn('編集を保存').count()) > 0);
    page.once('dialog', (d) => d.accept());
    await stepBtn('STEP1').click();
    await page.waitForTimeout(300);
    check('STEP切替：承諾すると移動する', (await statusOf('STEP1')) === 'step');
    await stepBtn('STEP3').click();
    await page.waitForTimeout(200);
    const restored = await page.getByText('編集後：書類作成の手間をなくし').count();
    check('STEP切替：保存済みの編集はSTEPを行き来しても残る', restored > 0);
  });

  await step('STEP切替：6問の回答は、STEPを移動しても残る', async () => {
    await deptTab('営業部').click();
    page.once('dialog', (d) => d.accept());
    await stepBtn('STEP2').click();
    if ((await btn('このテーマを生成').count()) > 0) await btn('このテーマを生成').first().click();
    const answer = page.locator('textarea').first();
    await answer.waitFor({ timeout: 30000 });
    await answer.fill('STEP切替で消えないか確認する回答');
    await stepBtn('STEP1').click();
    await page.waitForTimeout(300);
    await stepBtn('STEP2').click();
    await page.waitForTimeout(300);
    const kept = await page.locator('textarea').first().inputValue();
    check('STEP切替：6問の未保存の回答が、移動の後も残る', kept.includes('STEP切替で消えない'), kept.slice(0, 20));
  });

  await step('STEP4：確認・確定の画面に、判断を求める旧方式の表示が無く、確定ボタンが押せる', async () => {
    await stepBtn('STEP4').click();
    await page.getByText('正式に確定する内容').first().waitFor({ timeout: 15000 });
    check('STEP4：「既存の計画（変更しません）」の一覧が無い', (await page.getByText('既存の計画（変更しません）').count()) === 0);
    const adopt = btn('採用する').first();
    await savedOnClick(() => adopt.click());
    const afterAdopt = await api(`/api/stage3/strategy-book?companyId=${IDS.company}&strategyId=${IDS.strategy}`);
    const adopted = (afterAdopt.body?.state?.projectSelections ?? []).filter((p) => p.decision === 'applied').length;
    check('新規候補：採用した1件が、確定の前に保存される', adopted === 1, `採用 ${adopted}件`);
    const adjustN = await btn('採用').count();
    for (let i = 0; i < adjustN; i += 1) await savedOnClick(() => btn('採用').nth(i).click());
    check('STEP4：部門間調整の候補に、採否を選んだ', adjustN > 0, `候補 ${adjustN}件`);
    const afterAdj = await api(`/api/stage3/strategy-book?companyId=${IDS.company}&strategyId=${IDS.strategy}`);
    const decided = Object.values(afterAdj.body?.state?.candidateDecisions ?? {}).filter((d) => d === 'adopted').length;
    check('部門間調整：採用の判断が、確定の前に保存される', decided === adjustN, `採用 ${decided}件`);
    const confirmBtn = btn('戦略書を確定する');
    check('STEP4：確定ボタンが押せる', await confirmBtn.isEnabled());
    await shot('flow-step4-before-confirm');
  });

  await step('確定：確定APIが成功し、「事業・部門戦略書が確定しました」とSTEP5が出る', async () => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book/confirm') && r.request().method() === 'POST'),
      btn('戦略書を確定する').click(),
    ]);
    check('確定：確定APIの応答が200', res.status() === 200, `status=${res.status()}`);
    await page.getByText('事業・部門戦略書が確定しました').first().waitFor({ timeout: 20000 });
    check('確定：成功の表示が出る', true);
    check('STEP5：確定版PDFの出力ボタンが出る', (await btn('確定版PDFを出力').count()) > 0);
    const link = page.locator('a', { hasText: 'STAGE4で実行計画書を作る' }).first();
    const href = (await link.count()) > 0 ? await link.getAttribute('href') : '';
    check('STEP5：STAGE4へのリンクが、確定した部門の計画で出る', href.includes('/okr?from=stage3') && href.includes('projectId='), href);
    await shot('flow-step5-confirmed');
  });

  await step('確定の内容：正式データへの反映（旧方式の変更案は表示どおり、新規候補は保留のまま）', async () => {
    const st = await harnessState();
    const sales = st.departments[0];
    const mkt = st.departments[1];
    check('正式：営業部の使命が、編集後の内容で反映される', String(sales.mission ?? '').includes('編集後'), String(sales.mission ?? '').slice(0, 30));
    check('正式：マーケティング部の旧方式の変更案が、表示どおり反映される', String(mkt.interDeptCollab ?? '').length > 0 || (Array.isArray(mkt.interDeptCollab) && mkt.interDeptCollab.length > 0), JSON.stringify(mkt.interDeptCollab ?? null).slice(0, 60));
    const newInOfficial = [sales, mkt].flatMap((d) => d.projects).filter((p) => String(p.title ?? '').includes('新しい施策')).length;
    const salesNew = sales.projects.filter((p) => String(p.title ?? '').includes('新しい施策')).length;
    const mktNew = mkt.projects.filter((p) => String(p.title ?? '').includes('新しい施策')).length;
    check('正式：採用した新規プロジェクトだけが営業部に入り、保留の候補は入らない', salesNew === 1 && mktNew === 0 && newInOfficial === 1, `営業部 ${salesNew}件 / マーケ ${mktNew}件`);
    const sel = await api(`/api/stage3/strategy-book?companyId=${IDS.company}&strategyId=${IDS.strategy}`);
    const projects = sel.body?.state?.projectSelections ?? [];
    check('作業状態：確定後、未選択の新規候補は保留として残る', projects.every((p) => p.decision !== 'pending') && projects.length > 0, `${projects.map((p) => p.decision).join(',')}`);
  });

  await step('確定後の再読み込み：確定済みの事業・部門はSTEP5を初期表示し、上部は簡素な表示になる', async () => {
    await page.reload();
    await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });
    await page.getByText('事業・部門戦略書が確定しました').first().waitFor({ timeout: 15000 });
    check('再読み込み：確定済みの事業・部門はSTEP5が初期表示される', (await statusOf('STEP5')) === 'step');
    check('上部：全社戦略の「確定済み」と「全社戦略書を読む」だけが出る', (await page.getByText('全社戦略書を読む').count()) > 0 && (await page.getByText(/作業版 d+/).count()) === 0 && (await page.getByText(/反映d+件/).count()) === 0);
    await stepBtn('STEP1').click();
    await page.waitForTimeout(200);
    check('STEP1：過去のたたき台であることが分かる（確定後も戻れる）', (await page.getByText('これは最初のたたき台（過去の版）です').count()) > 0 && (await statusOf('STEP1')) === 'step');
    await stepBtn('STEP5').click();
    await page.waitForTimeout(200);
    check('STEP5へ戻れる', (await statusOf('STEP5')) === 'step');
  });

  await step('PDF：確定版PDFが出力され、開ける', async () => {
    await page.reload();
    await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });
    await deptTab('営業部').click();
    await stepBtn('STEP5').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), btn('確定版PDFを出力').click()]);
    const pdfPath = path.join(shots, 'confirmed-sales.pdf');
    await download.saveAs(pdfPath);
    const head = fs.readFileSync(pdfPath).subarray(0, 4).toString('latin1');
    check('PDF：確定版のPDFとして保存される', head === '%PDF', `${fs.statSync(pdfPath).size} bytes`);
  });

  await step('監査：確定が記録されている', async () => {
    const audit = await api('/harness/audit');
    check('監査：確定の記録がある', (audit.body?.audit ?? []).some((a) => a.action === 'stage3_strategy_book_confirmed'));
  });

  check('ページのエラーが出ていない', pageErrors.filter((e) => !/Download the React DevTools|favicon|Failed to load resource/i.test(e)).length === 0, pageErrors.slice(0, 3).join(' | '));
  check('APIの失敗（4xx・5xx）が出ていない', apiFailures.length === 0, apiFailures.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n合計 ${results.length} 件 / 失敗 ${failed.length} 件`);
process.exit(failed.length > 0 ? 1 : 0);
