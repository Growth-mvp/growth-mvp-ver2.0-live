/* 新STAGE3の今回の変更箇所だけを、ブラウザ（Chromium）で確かめる（評価専用）。
 * プロジェクト詳細の開閉と区別、6つの問いの一覧と回答の保存、未保存の回答の再生成への反映、保存に失敗した時に再生成しないこと。
 * 架空データ・ローカルDB（PGlite）・AIの固定応答を使う。外部への接続はしない。1つでも失敗すれば終了コード1。 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
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

/* PDFを実物として調べる：ページごとの埋め込み画像を取り出してPNGにし、ページ数・大きさ・描画の割合・フッターの文字を返す */
async function inspectPdf(file, outPrefix) {
  const pdfjs = await import(pathToFileURL(path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const { createCanvas, loadImage } = createRequire(path.join(here, 'out', '.canvas', 'package.json'))('canvas');
  const raw = fs.readFileSync(file);
  const jpegs = [];
  for (let at = raw.indexOf('/DCTDecode'); at >= 0; at = raw.indexOf('/DCTDecode', jpegs.at(-1).end)) {
    const dictStart = raw.lastIndexOf(' obj', at);
    const streamAt = raw.indexOf('stream', at);
    const length = Number(/\/Length (\d+)/.exec(raw.slice(dictStart, streamAt).toString('latin1'))?.[1]);
    const dataStart = streamAt + (raw[streamAt + 6] === 0x0d ? 8 : 7);
    jpegs.push({ bytes: raw.subarray(dataStart, dataStart + length), end: dataStart + length });
  }
  let inkRatio = 0;
  const pngFiles = [];
  const heights = [];
  for (const [index, { bytes }] of jpegs.entries()) {
    const img = await loadImage(bytes);
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    const pngFile = `${outPrefix}-${index + 1}.png`;
    fs.writeFileSync(pngFile, canvas.toBuffer('image/png'));
    pngFiles.push(pngFile);
    heights.push(img.height);
    if (index === 0) {
      const { data: px } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] < 240 || px[i + 1] < 240 || px[i + 2] < 240) ink += 1;
      inkRatio = ink / (px.length / 4);
    }
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(raw), useSystemFonts: true }).promise;
  const first = await doc.getPage(1);
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    fullText += content.items.map((it) => it.str).join('') + '\n';
  }
  return {
    pages: doc.numPages,
    images: jpegs.length,
    pngFiles,
    heights,
    width: first.view[2],
    height: first.view[3],
    inkRatio,
    text: fullText,
  };
}

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

  await step('B 戦略書：使命・役割・重点課題が読め、プロジェクトの目的・選定理由・仮説が出て、既存と候補が区別できる', async () => {
    const docOk = await text('重点プロジェクト').isVisible();
    const candidateReason = await page.getByText('既存顧客の再発注の手間を減らす施策', { exact: false }).first().isVisible();
    const candidateLabel = await page.getByText('新規候補（採用前）', { exact: true }).count();
    const officialGoal = await page.getByText('再受注率 40%', { exact: false }).first().isVisible();
    const officialLabel = await page.getByText('既存のプロジェクト', { exact: true }).count();
    const official_ = (await harnessState()).departments[0].projects;
    const notMixed = official_.length === 1 && !official_.some((p) => String(p.title).includes('新しい施策'));
    check(
      'B 戦略書：使命が読め、目的・選定理由・仮説・目標が出て、既存と候補が区別でき、候補は正式データに入らない',
      docOk && candidateReason && candidateLabel === 1 && officialGoal && officialLabel === 1 && notMixed,
      `使命 ${docOk} / 候補の理由 ${candidateReason} / 候補の表示 ${candidateLabel} / 正式の目標 ${officialGoal} / 正式の表示 ${officialLabel} / 正式データに候補なし ${notMixed}`,
    );
    await shot('focused-B-strategy-document');
  });

  await step('C 6つの問い：テーマ名の一覧で表示され、回答を保存して次のテーマへ進める', async () => {
    await btn('6つの問いへ進む').click();
    await text('戦略書を読みながら、6つの問いに答える').waitFor({ timeout: 15000 });
    await btn('このテーマを生成').click();
    await text('検証用のテーマ1').waitFor({ timeout: 15000 });
    const pending = await page.getByText('未生成', { exact: true }).count();
    const sixRows = await page.locator('button').filter({ hasText: /^Q[1-6]/ }).count();
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

  await step('C2 横幅が十分あるとき：戦略書と現在の問いが並んで見える', async () => {
    const both = (await text('重点プロジェクト').isVisible()) && (await answerBox().isVisible());
    check('C2 横幅が十分あるとき：戦略書と現在の問いを並べて見られる', both);
  });

  await step('D 未保存の回答：保存ボタンを押さなくても、再生成のときに保存されて反映される', async () => {
    await answerBox().fill('未保存の回答：新規顧客は展示会で開拓する');
    const [, , analyzeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/harness/answers') && r.request().method() === 'POST'),
      page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book') && r.request().method() === 'PUT'),
      page.waitForResponse((r) => r.url().includes('/api/stage3/adjustment/analyze') && r.request().method() === 'POST', { timeout: 40000 }),
      btn('6問を反映して戦略書を再生成').click(),
    ]);
    if (analyzeRes.status() !== 200) throw new Error(`analyze_status_${analyzeRes.status()}`);
    const st = await harnessState();
    const steps = st.departments[0].answers2?.[0]?.steps ?? [];
    check('D 未保存の回答が保存され、再生成まで完了する', steps.some((s) => String(s.answer ?? '').includes('展示会で開拓')), `回答 ${steps.length}件`);
    await shot('focused-D-regen');
  });

  await step('E 保存に失敗したら、再生成は行わず、エラーを出し、入力も残す', async () => {
    await page.getByText('以前の内容を見る・修正する').click();
    await btn('6つの問いを見直す').click();
    await text('戦略書を読みながら、6つの問いに答える').waitFor({ timeout: 15000 });
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

  await step('H 横幅が狭いとき：6つの問いは開閉でき、閉じると戦略書を読める', async () => {
    await page.setViewportSize({ width: 800, height: 900 });
    const toggleClose = page.getByRole('button', { name: '6つの問いを閉じて戦略書を読む', exact: true });
    const toggleVisible = await toggleClose.isVisible();
    const openBefore = await answerBox().isVisible();
    await toggleClose.click();
    const closedAfter = !(await answerBox().isVisible());
    const docVisible = await text('重点プロジェクト').isVisible();
    await page.getByRole('button', { name: '6つの問いを開く', exact: true }).click();
    const reopened = await answerBox().isVisible();
    check(
      'H 横幅が狭いとき：6つの問いを開閉でき、閉じると戦略書を読める',
      toggleVisible && openBefore && closedAfter && docVisible && reopened,
      `切替ボタン ${toggleVisible} / 開いていた ${openBefore} / 閉じると回答欄が消える ${closedAfter} / 戦略書が見える ${docVisible} / 再び開く ${reopened}`,
    );
    await shot('focused-H-narrow');
    await page.setViewportSize({ width: 1280, height: 900 });
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
  const editTargets = () => page.getByRole('button', { name: /を修正する$/ });
  await step('G 戦略書の編集：通常表示に編集ボタンは並ばず、「戦略書を編集」で直して「編集を保存」すると作業版に残る', async () => {
    await page.reload();
    await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });
    await tabBtn('営業部').click();
    const readTargets = await editTargets().count();
    await btn('戦略書を編集').click();
    const editMode = (await editTargets().count()) > 0;
    await page.getByRole('button', { name: '他の事業・部門との連携を修正する', exact: true }).click();
    await page.getByRole('textbox', { name: '他の事業・部門との連携', exact: true }).fill('G編集した連携：開発部と新用途の試作を月次で決める');
    await shot('focused-G-editing');
    await btn('編集を保存').click();
    await text('戦略書の編集を保存しました').waitFor({ timeout: 15000 });
    const backToRead = (await editTargets().count()) === 0 && (await btn('戦略書を編集').isVisible());
    await page.reload();
    await page.waitForSelector('text=全社戦略（STAGE2）', { timeout: 30000 });
    await tabBtn('営業部').click();
    await text('G編集した連携').waitFor({ timeout: 15000 });
    const shown = await text('G編集した連携').isVisible();
    const notYetOfficial = !(JSON.stringify((await harnessState()).departments[0]).includes('G編集した連携'));
    check(
      'G 通常表示は編集ボタンなし・編集中だけ項目を直せる・保存後は文書表示に戻り、再読み込み後も残り、正式データには入らない',
      readTargets === 0 && editMode && backToRead && shown && notYetOfficial,
      `通常表示の編集欄 ${readTargets} / 編集中の編集欄 ${editMode} / 保存後の文書表示 ${backToRead} / 再読み込み後の表示 ${shown} / 正式データ未反映 ${notYetOfficial}`,
    );
    await shot('focused-G-edit-persisted');
  });

  await step('G2 作業版PDF：長文の編集を保存し、作業版のPDFは約6ページで、正式データは変わらない', async () => {
    const officialBefore = JSON.stringify((await harnessState()).departments);
    await btn('戦略書を編集').click();
    const sentence = (tag, i) => `${tag}${i}：営業の受注を平準化するため、既存顧客の発注計画を月次で共有し、缶の生産計画と突き合わせて見直す。数量と価格の前提は部門で一つにそろえる。`;
    const fills = [
      ['重点課題と勝ち筋', 'K', 30],
      ['事業内・部門内の連携', 'I', 10],
      ['認識のズレが起きやすいポイント', 'A', 18],
      ['再考ポイント・部門横断論点', 'R', 20],
      ['停止事項', 'S', 8],
      ['リスク注記', 'N', 10],
    ];
    for (const [label, tag, count] of fills) {
      await page.getByRole('button', { name: `${label}を修正する`, exact: true }).click();
      await page.getByRole('textbox', { name: label, exact: true }).fill(Array.from({ length: count }, (_, i) => sentence(tag, i + 1)).join('\n'));
    }
    const pdfBlockedWhileEditing = await btn('PDF出力').first().isDisabled();
    const blockNote = await text('編集中のためPDFは出力できません').isVisible();
    await btn('編集を保存').click();
    await text('戦略書の編集を保存しました').waitFor({ timeout: 15000 });
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await btn('PDF出力').first().click();
    const download = await dl;
    const name = download.suggestedFilename();
    const file = path.join(shots, name);
    await download.saveAs(file);
    const info = await inspectPdf(file, path.join(shots, 'focused-G2-working'));
    const officialAfter = JSON.stringify((await harnessState()).departments);
    check(
      'G2 作業版PDF：編集中は出力を止め、保存後は作業版として約6ページで出力でき、正式データは変わらない',
      pdfBlockedWhileEditing && blockNote && name === 'GROWTHSHIFT_営業部_事業戦略書_作業版.pdf' && info.pages >= 5 && info.images > info.pages && info.heights[0] > 1200 && officialBefore === officialAfter,
      `編集中の出力停止 ${pdfBlockedWhileEditing} / 注記 ${blockNote} / ${name} / ${info.pages}ページ / 画像 ${info.images}（ページ画像 ${info.pages} とフッターの画像）/ 正式データ不変 ${officialBefore === officialAfter}`,
    );
  });

  const EDITED_TITLE = 'P編集：既存顧客の再受注施策（改）';
  const visibleText = (t, tag) => page.locator(tag + ':visible', { hasText: t }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  const setOkrReference = (on) =>
    page.evaluate(
      async ([projectId, flag]) =>
        fetch('/harness/okr-reference', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, on: flag }) }),
      ['p-1', on],
    );
  await step('P 既存プロジェクト：内容を直して保存でき、参照があれば外せず、外すと予定になり、元に戻せる', async () => {
    const officialBefore = JSON.stringify((await harnessState()).departments[0].projects);
    await btn('戦略書を編集').click();
    await page.getByRole('button', { name: 'プロジェクト名を修正する', exact: true }).click();
    await page.getByRole('textbox', { name: 'プロジェクト名', exact: true }).fill(EDITED_TITLE);
    await page.getByRole('button', { name: '目的・選定理由を修正する', exact: true }).click();
    await page.getByRole('textbox', { name: '目的・選定理由', exact: true }).fill('P編集：再受注の手間を減らし、既存顧客の発注を安定させる');
    await shot('focused-P-project-editing');
    await btn('編集を保存').click();
    await text('戦略書の編集を保存しました').waitFor({ timeout: 15000 });
    const editedShown = await visibleText(EDITED_TITLE, 'h5');
    const officialUnchangedBySave = JSON.stringify((await harnessState()).departments[0].projects) === officialBefore;

    await setOkrReference(true);
    await btn('戦略書を編集').click();
    await btn('計画から外す').first().click();
    await text('計画から外せません').waitFor({ timeout: 15000 });
    const blocked = await text('計画から外せません').isVisible();
    const stillListed = await visibleText(EDITED_TITLE, 'span');
    await setOkrReference(false);

    await btn('計画から外す').first().click();
    await text('計画から外す予定にしました').waitFor({ timeout: 15000 });
    const removedShown = await visibleText('計画から外す予定', 'h4');
    const officialStillHasProject = (await harnessState()).departments[0].projects.some((p) => String(p.id) === 'p-1');
    await btn('編集をやめる').click();
    const dlRemoved = page.waitForEvent('download', { timeout: 120000 });
    await btn('PDF出力').first().click();
    const removedPdf = await dlRemoved;
    const removedFile = path.join(shots, removedPdf.suggestedFilename());
    await removedPdf.saveAs(removedFile);
    const removedInfo = await inspectPdf(removedFile, path.join(shots, 'focused-P-removed-working'));

    await btn('元に戻す').first().click();
    await text('を元に戻しました').waitFor({ timeout: 15000 });
    const restored = (await page.locator('h5:visible', { hasText: EDITED_TITLE }).count()) > 0 && !(await text('計画から外す予定にしました').isVisible());
    const removedGone = (await page.getByText('計画から外す予定', { exact: true }).count()) === 0;
    check(
      'P 既存プロジェクト：内容は作業版に保存され正式データは変わらず、参照があれば外せず、外すと予定に区別され、元に戻せる',
      editedShown && officialUnchangedBySave && blocked && stillListed && removedShown && officialStillHasProject && removedInfo.pages >= 1 && restored && removedGone,
      `保存後の表示 ${editedShown} / 保存で正式データ不変 ${officialUnchangedBySave} / 参照で停止 ${blocked} / 停止後も表示 ${stillListed} / 予定の表示 ${removedShown} / 正式データに残る ${officialStillHasProject} / 予定PDF ${removedInfo.pages}ページ / 元に戻す ${restored} / 予定の表示は消える ${removedGone}`,
    );
    await shot('focused-P-restored');
  });

  let beforeConfirm = null;
  await step('J 確定：編集内容が正式データへ反映され、既存のプロジェクトIDとKPIは変わらず、候補は入らない', async () => {
    beforeConfirm = (await harnessState()).departments[0];
    await btn('保留する').first().click();
    await tabBtn('部門間調整').click();
    await btn('不採用').first().click();
    await tabBtn('営業部').click();
    if (!(await btn('戦略書を確定する').isVisible())) {
      const history = page.locator('details', { has: page.locator('summary', { hasText: '以前の内容を見る' }) }).first();
      if (!(await history.evaluate((d) => d.open))) await history.locator('summary').click();
      await btn('部門間調整・確定を確認する').click();
    }
    await btn('戦略書を確定する').waitFor({ timeout: 15000 });
    const [confirmRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/stage3/strategy-book/confirm') && r.request().method() === 'POST'),
      btn('戦略書を確定する').click(),
    ]);
    if (confirmRes.status() !== 200) throw new Error(`confirm_status_${confirmRes.status()}`);
    await btn('PDF出力').first().waitFor({ timeout: 30000 });
    const after = (await harnessState()).departments[0];
    const edited = String(after.interDeptCollab ?? '').includes('G編集した連携') || JSON.stringify(after).includes('G編集した連携');
    const p1After = after.projects.find((p) => String(p.id) === 'p-1');
    const p1Before = beforeConfirm.projects.find((p) => String(p.id) === 'p-1');
    const titleApplied = p1After?.title === EDITED_TITLE;
    const kpiSafe = JSON.stringify(p1After?.okrs) === JSON.stringify(p1Before?.okrs) && JSON.stringify(p1After?.kpis) === JSON.stringify(p1Before?.kpis);
    const idSame = p1After?.id === p1Before?.id && after.projects.length === beforeConfirm.projects.length;
    const noCandidate = !JSON.stringify(after.projects).includes('6問反映案');
    check(
      'J 確定：編集内容が正式データに入り、既存のプロジェクトIDとKPIは変わらず、未採用の候補は入らない',
      edited && titleApplied && kpiSafe && idSame && noCandidate,
      `編集の反映 ${edited} / プロジェクト名の反映 ${titleApplied} / KPI・OKR同一 ${kpiSafe} / ID・件数同一 ${idSame} / 候補なし ${noCandidate}`,
    );
    await shot('focused-J-confirmed');
  });

  await step('K 部門別PDF：確定版の戦略書をPDFで出力でき、ページ数と描画を確認できる', async () => {
    const dl = page.waitForEvent('download', { timeout: 120000 });
    await btn('PDF出力').first().click();
    const download = await dl;
    const name = download.suggestedFilename();
    const file = path.join(shots, name);
    await download.saveAs(file);
    const info = await inspectPdf(file, path.join(shots, 'focused-K-confirmed'));
    const expected = 'GROWTHSHIFT_営業部_事業戦略書.pdf';
    check(
      'K PDF：確定版はファイル名どおりに出力され、A4縦で、空白ページではない',
      name === expected && info.pages >= 1 && info.width < info.height && info.inkRatio > 0.005,
      `${name} / ${info.pages}ページ / ${Math.round(info.width)}x${Math.round(info.height)}pt / 描画の割合 ${info.inkRatio.toFixed(4)}`,
    );
    const leaked = /proj-|d-can|d-other|6問反映案|別事業|作業版/.exec(info.text);
    const pageNumbered = /1\s*\/\s*\d+/.test(info.text);
    check(
      'K PDF：各ページにページ番号と「確定版」の表示（画像）が入り、作業版の表記や内部IDは含まれない（本文と表示は画像のため目視で確認）',
      pageNumbered && info.images > info.pages && !leaked,
      `ページ番号 ${pageNumbered} / 画像 ${info.images}（ページ画像 ${info.pages} とフッターの画像）/ 混入 ${leaked ? leaked[0] : 'なし'}`,
    );
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
