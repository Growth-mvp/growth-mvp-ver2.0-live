/* 新STAGE3の今回の変更箇所だけを、ブラウザ（Chromium）で確かめる（評価専用）。
 * プロジェクト詳細の開閉と区別、6つの問いの一覧と回答の保存、未保存の回答の再生成への反映、保存に失敗した時に再生成しないこと。
 * 架空データ・ローカルDB（PGlite）・AIの固定応答を使う。外部への接続はしない。1つでも失敗すれば終了コード1。 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { build } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3918);
const shots = path.join(here, 'out', 'shots');

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
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`);
});

const harnessState = async () => page.evaluate(async () => (await fetch('/harness/state')).json());
const tabBtn = (name) => page.getByRole('navigation').getByRole('button', { name: new RegExp('^' + name) });
const btn = (name) => page.getByRole('button', { name, exact: true });
const text = (t) => page.getByText(t, { exact: false }).first();
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
const answerBox = () => page.locator('textarea').first();
const openDetails = async (title) => {
  const d = page.locator('details', { has: page.locator('summary', { hasText: title }) }).first();
  await d.locator('summary').click();
  return d;
};

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0]);
    await page.screenshot({ path: path.join(shots, `focused-fail-${results.length}.png`), fullPage: true }).catch(() => {});
  }
}

try {
  fs.mkdirSync(shots, { recursive: true });
  await page.goto(base + '/');
  await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });

  await step('A たたき台：営業部のAIたたき台を作成する', async () => {
    await tabBtn('営業部').click();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book') && r.request().method() === 'PUT'),
      btn('AIで戦略書のたたき台を作成').click(),
    ]);
    await text('初回のたたき台').waitFor({ timeout: 30000 });
    check('A たたき台が作られ、未確定として表示される', true);
  });

  await step('B プロジェクト詳細：開くと詳細が出て、正式と新規候補が区別できる', async () => {
    const candidate = await openDetails('初回案：営業部の新しい施策');
    const candidateReason = await candidate.getByText('既存顧客の再発注の手間を減らす施策', { exact: false }).first().isVisible();
    const candidateLabel = await candidate.getByText('新規候補（採用前）', { exact: true }).count();
    const official = page.locator('details', { has: page.locator('summary', { hasText: '既存顧客の再受注施策' }) }).first();
    const closedBefore = await official.evaluate((d) => !d.open);
    await official.locator('summary').click();
    const officialGoal = await official.getByText('再受注率 40%', { exact: false }).first().isVisible();
    const officialLabel = await official.getByText('既存（正式データ）', { exact: true }).count();
    const summaryText = await text('既存のプロジェクト').textContent();
    const official_ = (await harnessState()).departments[0].projects;
    const notMixed = official_.length === 1 && !official_.some((p) => String(p.title).includes('新しい施策'));
    check(
      'B プロジェクト詳細：開閉でき、狙い・目標が出て、正式と新規候補が区別できる（候補は正式データに入らない）',
      closedBefore && candidateReason && candidateLabel === 1 && officialGoal && officialLabel === 1 && notMixed,
      `候補の理由 ${candidateReason} / 候補の表示 ${candidateLabel} / 正式の目標 ${officialGoal} / 正式の表示 ${officialLabel} / 正式データに候補なし ${notMixed} / 件数「${summaryText?.trim().slice(0, 40)}」`,
    );
    await shot('focused-B-project-cards');
  });

  await step('C 6つの問い：テーマ名の一覧で表示され、回答を保存して次のテーマへ進める', async () => {
    await btn('6つの問いへ進む').click();
    await text('既存の6問（空欄でも可）').waitFor({ timeout: 15000 });
    await btn('このテーマを生成').click();
    await text('検証用のテーマ1').waitFor({ timeout: 15000 });
    const pending = await page.getByText('未生成', { exact: true }).count();
    const sixRows = await page.locator('button[aria-expanded]').count();
    await answerBox().fill('既存顧客の再発注は、書類の作成を一度で済ませる形にする');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/harness/answers') && r.request().method() === 'POST'),
      btn('次のテーマへ').click(),
    ]);
    await text('検証用のテーマ2').waitFor({ timeout: 15000 });
    const st = await harnessState();
    const steps = st.departments[0].answers2?.[0]?.steps ?? [];
    const saved = steps.some((s) => String(s.answer ?? '').includes('書類の作成'));
    const autoGen = await btn('テーマを生成').count();
    check(
      'C 6つの問い：一覧（6行）で表示し、回答は保存され、次のテーマが自動で出る',
      sixRows === 6 && pending >= 4 && saved && autoGen === 0,
      `行 ${sixRows} / 未生成 ${pending} / 保存 ${saved} / テーマを生成 ${autoGen}件`,
    );
    await shot('focused-C-six-questions');
  });

  await step('D 未保存の回答：保存ボタンを押さなくても、再生成のときに保存されて反映される', async () => {
    await answerBox().fill('未保存の回答：新規顧客は展示会で開拓する');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/harness/answers') && r.request().method() === 'POST'),
      page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book') && r.request().method() === 'PUT'),
      btn('6問を反映して戦略書を再生成').click(),
    ]);
    await text('再生成した戦略書を保存しました').waitFor({ timeout: 40000 });
    const st = await harnessState();
    const steps = st.departments[0].answers2?.[0]?.steps ?? [];
    check('D 未保存の回答が保存され、再生成まで完了する', steps.some((s) => String(s.answer ?? '').includes('展示会で開拓')), `回答 ${steps.length}件`);
    await shot('focused-D-regen');
  });

  await step('E 保存に失敗したら、再生成は行わず、エラーを出し、入力も残す', async () => {
    await page.getByText('以前の内容を見る・修正する').click();
    await btn('6つの問いを見直す').click();
    await text('既存の6問（空欄でも可）').waitFor({ timeout: 15000 });
    await page.route('**/harness/answers', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' })
        : route.continue(),
    );
    await answerBox().fill('保存されない回答：失敗の確認');
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
    const kept = (await answerBox().inputValue()) === '保存されない回答：失敗の確認';
    check('E 保存に失敗すると再生成は行われず、エラーが出て、入力も残る', generateCalls === 0 && kept, `再生成の要求 ${generateCalls}件 / 入力の保持 ${kept}`);
    await shot('focused-E-save-failure');
  });

  await step('F 保存が直ったあと、もう一度再生成すると、残っていた回答が保存されて再生成される', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/harness/answers') && r.request().method() === 'POST'),
      btn('6問を反映して戦略書を再生成').click(),
    ]);
    await text('6問反映案').waitFor({ timeout: 40000 });
    const st = await harnessState();
    const steps = st.departments[0].answers2?.[0]?.steps ?? [];
    check('F 失敗のあとの再生成で、残っていた回答が保存されて反映される', steps.some((s) => String(s.answer ?? '').includes('保存されない回答')), `回答 ${steps.length}件`);
  });
} finally {
  const realErrors = pageErrors.filter((e) => !/Download the React DevTools|favicon|Failed to load resource/i.test(e));
  check('ページのエラーが出ていない', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n合計 ${results.length} 件 / 失敗 ${failed.length} 件`);
process.exit(failed.length > 0 ? 1 : 0);
