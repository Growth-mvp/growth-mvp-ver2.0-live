/* KRの ID・実績・保存の流れを、実コンポーネント（app/okr/page.tsx・app/execution/page.tsx）で検証する（評価専用）。
 * 1 AI案のKRを再読込なしで編集 / 2 保存後の再読込でも編集 / 3 IDのない旧KRの編集 / 4 STAGE5の実績の記録と保存
 * 5 同じAI案の再反映で実績・履歴を保つ / 6 保存失敗時は成功と言わず、実績を巻き戻す / 7 保存中の会社切替で別会社へ書かない
 * 保存は localStorage（stubs/flowStore.ts）。AI案の応答だけは init script で差し替える（file:// のページは
 * Playwright の route.fulfill の対象外のため）。それ以外の通信は file:// 以外すべて遮断する。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

const outDir = path.join(__dirname, '..', 'results-browser');
const OKR_URL = pathToFileURL(path.join(outDir, 'flow-okr.html')).href;
const EXEC_URL = pathToFileURL(path.join(outDir, 'flow-exec.html')).href;

const CO = 'FICTIONAL-CO';
const OTHER = 'FICTIONAL-OTHER';
const KEY = (c) => `flow:${c}`;
const RETENTION = '既存顧客の保守契約更新';
const STANDARD = '点検工程の標準化';
const NEW_CUST = '新規顧客開拓';
const RET_KR = '保守契約の継続率';
const AI_KR = '保守契約の新規更新件数';
const LEGACY_KR = '点検報告の当日提出率';
const LEGACY_OTHER_KR = '新規商談数';

/* AI案の応答（架空）。既存KRは継続率1件のみ。2件目の「新規更新件数」が生成時に新しいIDのKRとして追加される */
const DRAFT = {
  objective: '既存顧客の保守契約を更新し続け、新規の更新件数を増やす',
  role: 'REVENUE',
  kpis: [
    { label: RET_KR, target: 95, unit: '%', due: '2027-06', owner: '鈴木一郎', milestones: [] },
    { label: AI_KR, target: 40, unit: '件', due: '2027-06', owner: '鈴木一郎', milestones: [{ title: '更新対象リストを作る', dueYm: '2026-12' }] },
  ],
  steps: [{ title: '更新対象リストを作る', dueYm: '2026-12' }],
};

/* ページ内の init script：/api/stage4/generate-execution-draft だけを、上の DRAFT で応答する（ネットワークは使わない） */
const DRAFT_INIT = (draft) => {
  const real = window.fetch.bind(window);
  window.__draftCalls = [];
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/stage4/generate-execution-draft') >= 0) {
      window.__draftCalls.push({ url, method: (init && init.method) || 'GET' });
      return new Response(JSON.stringify({ draft }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  };
};

const results = [];
const dialogs = [];
const pageErrors = [];
const consoleErrors = [];
const external = [];
const evidence = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeout = 5000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const mark = () => dialogs.length;
const since = (m) => dialogs.slice(m).map((d) => d.message);
const waitDialog = (m, timeout = 6000) => waitUntil(async () => dialogs.length > m, timeout);
const isFailureMsg = (msgs) => msgs.some((x) => x.includes('保存されませんでした') || x.includes('保存に失敗しました'));
const isSuccessMsg = (msgs) => msgs.some((x) => x.startsWith('AI案を反映しました') || x.includes('反映が完了しました') || x.includes('保存しました'));

async function newContext(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(DRAFT_INIT, DRAFT);
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('file:')) return route.continue();
    external.push(u.slice(0, 140));
    return route.abort();
  });
  ctx.on('page', (p) => {
    p.on('dialog', async (d) => {
      dialogs.push({ label, message: d.message() });
      await d.accept();
    });
    p.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message.slice(0, 300)}`));
    p.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[${label}] ${m.text().slice(0, 240)}`);
    });
  });
  return ctx;
}

const readStore = (page) =>
  page.evaluate(() =>
    window.__getStrategyState().departments.map((d) => ({
      dept: d.name,
      projects: (d.projects || []).map((p) => ({
        title: p.title,
        okrsV2: (p.okrsV2 || []).map((k) => ({
          id: k.id ?? null,
          label: k.label,
          target: k.target ?? null,
          actual: k.actual ?? null,
          actualHistory: k.actualHistory ?? null,
        })),
      })),
    })),
  );
const findKrStore = (depts, title, label) => {
  for (const d of depts) for (const p of d.projects) if (p.title === title) return p.okrsV2.find((k) => k.label === label) ?? null;
  return null;
};
const countKrStore = (depts, title, label) => {
  for (const d of depts) for (const p of d.projects) if (p.title === title) return p.okrsV2.filter((k) => k.label === label).length;
  return 0;
};
const readLs = (page, companyId) =>
  page.evaluate((k) => {
    const s = localStorage.getItem(k);
    return s ? JSON.parse(s) : null;
  }, KEY(companyId));
const lsKr = (ls, title, label) => {
  if (!ls) return null;
  for (const d of ls.departments || []) for (const p of d.projects || []) if (p.title === title) return (p.okrsV2 || []).find((k) => k.label === label) ?? null;
  return null;
};

async function openOkr(page, query = '') {
  await page.goto(OKR_URL + query);
  await page.getByText('プロジェクト一覧').first().waitFor({ timeout: 10000 });
  await sleep(400);
}
async function openProject(page, title) {
  await page.getByText(title, { exact: true }).first().click();
  await sleep(300);
}
const krRowOf = (page, label) =>
  page
    .locator('div.rounded-lg.bg-zinc-50', { hasText: label })
    .filter({ has: page.getByRole('button', { name: '編集', exact: true }) })
    .last();
/* KRの編集フォーム（同時に開くのは1件だけ）。見出しの文言で特定し、ラベルの値は読み込み時に確認する */
const krEditOf = (page, label) => {
  const form = page
    .locator('div.rounded-lg.bg-zinc-50')
    .filter({ has: page.getByText('何を増やす・減らす・良くする？', { exact: true }) })
    .last();
  return form;
};
async function setTarget(page, label, value) {
  await krEditOf(page, label).locator('input[inputmode="decimal"]').first().fill(String(value));
}
async function clickSaveIn(page, label) {
  await krEditOf(page, label).getByRole('button', { name: '保存', exact: true }).click();
}
async function generateAndApply(page) {
  await page.getByRole('button', { name: /AIで実行計画のたたき台を作る/ }).click();
  await page.getByRole('button', { name: 'このAI案を反映する' }).waitFor({ timeout: 5000 });
  const m = mark();
  await page.getByRole('button', { name: 'このAI案を反映する' }).click();
  const got = await waitDialog(m);
  return { got, msgs: since(m) };
}

async function openExec(page) {
  await page.goto(EXEC_URL);
  await page.getByText(RETENTION, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 10000 });
  await sleep(500);
  await page.getByText(RETENTION, { exact: true }).filter({ visible: true }).first().click();
  await sleep(400);
}
const execRow = (page, label) =>
  page.locator('[data-testid="kr-actual-row"]', { hasText: label }).filter({ visible: true }).first();
async function recordActual(page, label, value, asOf, { update = false } = {}) {
  const row = execRow(page, label);
  /* 直前の失敗で入力欄が開いたままなら、ボタンは押さず、その入力欄を使う */
  if (!(await row.getByLabel(/実績値/).isVisible())) {
    await row.getByRole('button', { name: update ? '実績を更新' : '実績を記録' }).click();
  }
  await row.getByLabel(/実績値/).fill(String(value));
  await row.getByLabel(/基準日/).fill(asOf);
  await row.getByRole('button', { name: '保存', exact: true }).click();
  await sleep(400);
}

const check = async (id, name, fn) => {
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', detail: detail ?? '' });
  } catch (e) {
    results.push({ id, name, status: 'FAIL', detail: String(e.message || e).split('\n')[0] });
  }
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  /* ============ ctxA：1・2・4・5（同じブラウザ文脈で、画面をまたいで保存データを使う） ============ */
  const ctxA = await newContext(browser, 'A');
  const okr = await ctxA.newPage();
  await openOkr(okr);
  let aiKrId = null;

  await check('1', 'AI案で作ったKRを、反映・保存の直後（再読込なし）に編集できる', async () => {
    await openProject(okr, RETENTION);
    const { got, msgs } = await generateAndApply(okr);
    evidence.s1_dialogs = msgs;
    if (!got) throw new Error('反映後の通知が出ない');
    if (isFailureMsg(msgs)) throw new Error('反映が保存に失敗: ' + msgs.join(' | '));
    if (!isSuccessMsg(msgs)) throw new Error('成功の通知が出ない: ' + msgs.join(' | '));
    const calls = await okr.evaluate(() => window.__draftCalls.length);
    const kr = findKrStore(await readStore(okr), RETENTION, AI_KR);
    if (!kr) throw new Error('AI案のKRが画面に入っていない');
    if (!kr.id) throw new Error('AI案のKRにIDがない（id=' + JSON.stringify(kr.id) + '）');
    aiKrId = kr.id;
    const lk = lsKr(await readLs(okr, CO), RETENTION, AI_KR);
    evidence.s1_store = kr;
    evidence.s1_saved = lk;
    /* 観察（判定しない）：通知は「目的」を反映したと言うが、このプロジェクトには OKR 本体（mainOKR）がなく、目的は保存されない */
    const deptsText = await okr.evaluate(() => JSON.stringify(window.__getStrategyState().departments));
    evidence.observation_objective = { dialog: msgs[0], dialogMentionsObjective: msgs.some((x) => x.includes('目的')), draftObjectiveStored: deptsText.includes(DRAFT.objective) };
    if (!lk || lk.id !== aiKrId) throw new Error('保存先に同じIDのKRがない: ' + JSON.stringify(lk));
    // 反映直後に、そのKRの「編集」を押す
    const m2 = mark();
    await krRowOf(okr, AI_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(okr, AI_KR).waitFor({ timeout: 5000 });
    const before = findKrStore(await readStore(okr), RETENTION, AI_KR).target;
    await setTarget(okr, AI_KR, 45);
    await clickSaveIn(okr, AI_KR);
    await sleep(400);
    const msgs2 = since(m2);
    if (msgs2.length) throw new Error('編集・保存で通知が出た: ' + msgs2.join(' | '));
    const kr2 = findKrStore(await readStore(okr), RETENTION, AI_KR);
    const lk2 = lsKr(await readLs(okr, CO), RETENTION, AI_KR);
    evidence.s1_edit = { before, after: kr2.target, id: kr2.id, savedTarget: lk2?.target, savedId: lk2?.id };
    if (kr2.target !== 45 || lk2?.target !== 45) throw new Error('編集が保存されない: store=' + kr2.target + ' saved=' + lk2?.target);
    if (kr2.id !== aiKrId || lk2?.id !== aiKrId) throw new Error('編集でIDが変わった');
    return `AI案のKR「${AI_KR}」id=${aiKrId}。反映の通知「${msgs[0]}」。編集で目標 ${before}→45、保存先も 45（同じID）`;
  });

  await check('2', '保存して再読込した後も、そのKRを編集・保存できる', async () => {
    const idBefore = aiKrId;
    await okr.reload();
    await okr.getByText('プロジェクト一覧').first().waitFor({ timeout: 10000 });
    await sleep(400);
    await openProject(okr, RETENTION);
    const kr = findKrStore(await readStore(okr), RETENTION, AI_KR);
    if (!kr || kr.id !== idBefore) throw new Error('再読込後のIDが違う: ' + JSON.stringify(kr?.id) + '（前: ' + idBefore + '）');
    const m = mark();
    await krRowOf(okr, AI_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(okr, AI_KR).waitFor({ timeout: 5000 });
    await setTarget(okr, AI_KR, 46);
    await clickSaveIn(okr, AI_KR);
    await sleep(400);
    const msgs = since(m);
    if (msgs.length) throw new Error('編集・保存で通知が出た: ' + msgs.join(' | '));
    const lk = lsKr(await readLs(okr, CO), RETENTION, AI_KR);
    evidence.s2 = { idBefore, reloadedId: kr.id, savedTarget: lk?.target, savedId: lk?.id };
    if (lk?.target !== 46 || lk?.id !== idBefore) throw new Error('再読込後の編集が保存されない: ' + JSON.stringify(lk));
    return `再読込後も id=${kr.id} のまま。編集して目標 46 を保存（保存先も一致）`;
  });

  const exec = await ctxA.newPage();
  await openExec(exec);

  await check('4a', 'STAGE5：保存済みのAI案のKRに、実績が「未確認」で表示される', async () => {
    const t = await execRow(exec, AI_KR).innerText();
    if (!t.includes('実績：未確認')) throw new Error('未確認の表示がない: ' + t.slice(0, 120));
    return t.replace(/\n+/g, ' | ').slice(0, 160);
  });

  await check('4b', 'STAGE5：実績 38（2026-10）を記録すると、保存先に実績として残る', async () => {
    await recordActual(exec, AI_KR, 38, '2026-10');
    const t = await execRow(exec, AI_KR).innerText();
    if (!t.includes('実績：38 件（基準日 2026-10）')) throw new Error('記録が表示されない: ' + t.slice(0, 140));
    const lk = lsKr(await readLs(exec, CO), RETENTION, AI_KR);
    evidence.s4b_saved = lk?.actual ?? null;
    if (lk?.actual?.value !== 38 || lk?.actual?.asOf !== '2026-10') throw new Error('保存先に実績がない: ' + JSON.stringify(lk?.actual));
    return '表示「実績：38 件（基準日 2026-10）」。保存先 actual.value=38, asOf=2026-10';
  });

  await check('4c', 'STAGE5：実績を 36（2026-11）に更新すると、直前の 38 が履歴に残る', async () => {
    await recordActual(exec, AI_KR, 36, '2026-11', { update: true });
    const t = await execRow(exec, AI_KR).innerText();
    if (!t.includes('実績：36 件（基準日 2026-11）')) throw new Error('更新が表示されない: ' + t.slice(0, 140));
    if (!t.includes('過去の実績 1件を履歴に保存')) throw new Error('履歴の表示がない');
    const lk = lsKr(await readLs(exec, CO), RETENTION, AI_KR);
    evidence.s4c_saved = { actual: lk?.actual, actualHistory: lk?.actualHistory };
    if (lk?.actual?.value !== 36 || !lk?.actualHistory || lk.actualHistory.length !== 1 || lk.actualHistory[0].value !== 38) {
      throw new Error('保存先の履歴が違う: ' + JSON.stringify(lk));
    }
    return '表示「実績：36 件（基準日 2026-11）」「過去の実績 1件を履歴に保存」。保存先 history=[38]';
  });

  await check('4d', 'STAGE5：再読込後も実績と履歴が表示され、同じプロジェクトの別KRは未確認のまま', async () => {
    await exec.reload();
    await exec.getByText(RETENTION, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await sleep(400);
    await exec.getByText(RETENTION, { exact: true }).filter({ visible: true }).first().click();
    await sleep(400);
    const t = await execRow(exec, AI_KR).innerText();
    if (!t.includes('実績：36 件（基準日 2026-11）') || !t.includes('過去の実績 1件を履歴に保存')) throw new Error('再読込後に表示されない: ' + t.slice(0, 140));
    const tr = await execRow(exec, RET_KR).innerText();
    if (!tr.includes('実績：未確認')) throw new Error('別のKRの実績が変わった: ' + tr.slice(0, 100));
    return '再読込後も「実績：36 件」と履歴1件を表示。継続率は未確認のまま';
  });

  await check('5', 'OKR：同じAI案を再反映しても、記録した実績と履歴は残り、KRは増えない', async () => {
    await okr.reload();
    await okr.getByText('プロジェクト一覧').first().waitFor({ timeout: 10000 });
    await sleep(400);
    await openProject(okr, RETENTION);
    const b = await readStore(okr);
    const bKr = findKrStore(b, RETENTION, AI_KR);
    const bCount = countKrStore(b, RETENTION, AI_KR);
    const bLen = b.flatMap((d) => d.projects).find((p) => p.title === RETENTION).okrsV2.length;
    const projSnap = () =>
      okr.evaluate((t) => {
        const p = window.__getStrategyState().departments.flatMap((d) => d.projects).find((x) => x.title === t);
        return {
          okrs: (p.okrs || []).map((o) => ({ objective: o.objective, keyResults: o.keyResults })),
          kpis: p.kpis ?? null,
          okrsV2Labels: (p.okrsV2 || []).map((k) => k.label),
        };
      }, RETENTION);
    const snapBefore = await projSnap();
    const { got, msgs } = await generateAndApply(okr);
    evidence.s5_dialogs = msgs;
    evidence.s5_proj = { before: snapBefore, after: await projSnap() };
    if (!got) throw new Error('反映後の通知が出ない');
    if (isFailureMsg(msgs)) throw new Error('再反映が失敗: ' + msgs.join(' | '));
    const a = await readStore(okr);
    const aKr = findKrStore(a, RETENTION, AI_KR);
    const aCount = countKrStore(a, RETENTION, AI_KR);
    const aLen = a.flatMap((d) => d.projects).find((p) => p.title === RETENTION).okrsV2.length;
    const lk = lsKr(await readLs(okr, CO), RETENTION, AI_KR);
    evidence.s5 = { before: bKr, after: aKr, counts: { bCount, aCount, bLen, aLen }, saved: lk };
    if (aKr.id !== bKr.id) throw new Error('IDが変わった');
    if (!aKr.actual || aKr.actual.value !== 36 || aKr.actual.asOf !== '2026-11') throw new Error('実績が消えた/変わった: ' + JSON.stringify(aKr.actual));
    if (!aKr.actualHistory || aKr.actualHistory.length !== 1 || aKr.actualHistory[0].value !== 38) throw new Error('履歴が消えた/変わった: ' + JSON.stringify(aKr.actualHistory));
    const aLabels = a.flatMap((d) => d.projects).find((p) => p.title === RETENTION).okrsV2.map((k) => JSON.stringify(k.label));
    if (aCount !== 1 || aLen !== bLen) throw new Error(`KRが増えた: 件数 ${bLen}→${aLen}（ラベル: ${aLabels.join(', ')}）`);
    if (lk?.actual?.value !== 36 || lk?.actualHistory?.length !== 1) throw new Error('保存先の実績・履歴が変わった: ' + JSON.stringify(lk));
    return `再反映の通知「${msgs[0]}」。実績 36・履歴1件（38）を保持、KR件数 ${bLen}→${aLen}（重複なし）`;
  });

  await ctxA.close();

  /* 5の対照：再読込をせず、保存の直後に同じAI案を反映すると、KRは増えない（5の失敗が再読込の後に限るかの確認） */
  const ctxH = await newContext(browser, 'H');
  const h = await ctxH.newPage();
  await openOkr(h);
  await check('5c', '対照：再読込なしで、KRを保存した直後に同じAI案を反映しても、KRは増えない', async () => {
    await openProject(h, RETENTION);
    await generateAndApply(h);
    await krRowOf(h, AI_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(h, AI_KR).waitFor({ timeout: 5000 });
    await setTarget(h, AI_KR, 45);
    await clickSaveIn(h, AI_KR);
    await sleep(400);
    const b = await readStore(h);
    const bLen = b.flatMap((d) => d.projects).find((p) => p.title === RETENTION).okrsV2.length;
    const { got, msgs } = await generateAndApply(h);
    const a = await readStore(h);
    const aList = a.flatMap((d) => d.projects).find((p) => p.title === RETENTION).okrsV2.map((k) => k.label);
    evidence.s5c = { dialogs: msgs, labels: aList };
    if (!got || isFailureMsg(msgs)) throw new Error('再反映が失敗: ' + msgs.join(' | '));
    if (aList.length !== bLen) throw new Error(`KRが増えた: ${bLen}→${aList.length}（${aList.join(' / ')}）`);
    return `再読込なしの再反映で KR は ${bLen} 件のまま（${aList.join(' / ')}）`;
  });
  await ctxH.close();

  /* ============ ctxC：3（IDのない旧データ。?legacy=1 は保存データのない初回だけ効く） ============ */
  const ctxC = await newContext(browser, 'C');
  const legacy = await ctxC.newPage();
  await openOkr(legacy, '?legacy=1');
  let legacyId = null;

  await check('3a', '旧データ（IDなし）のKRで「編集」を押すと、そのKRだけにIDが付き、編集フォームが開く', async () => {
    const s0 = await readStore(legacy);
    const kr0 = findKrStore(s0, STANDARD, LEGACY_KR);
    const other0 = findKrStore(s0, NEW_CUST, LEGACY_OTHER_KR);
    evidence.s3_before = { legacyKr: kr0?.id ?? '(none)', otherLegacyKr: other0?.id ?? '(none)' };
    if (kr0?.id) throw new Error('前提が違う：旧データのKRにIDがある（' + kr0.id + '）');
    await openProject(legacy, STANDARD);
    const m = mark();
    await krRowOf(legacy, LEGACY_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(legacy, LEGACY_KR).waitFor({ timeout: 5000 });
    const msgs = since(m);
    if (msgs.length) throw new Error('通知が出た（編集できない扱い）: ' + msgs.join(' | '));
    const s1 = await readStore(legacy);
    legacyId = findKrStore(s1, STANDARD, LEGACY_KR)?.id;
    const other1 = findKrStore(s1, NEW_CUST, LEGACY_OTHER_KR);
    evidence.s3_after_click = { legacyKr: legacyId, otherLegacyKr: other1?.id ?? null };
    if (!legacyId) throw new Error('編集を押してもIDが付かない');
    if (other1?.id) throw new Error('別の旧KR（' + LEGACY_OTHER_KR + '）にもIDが付いた: ' + other1.id);
    return `編集で「${LEGACY_KR}」にだけ id=${legacyId} を付与。別の旧KR「${LEGACY_OTHER_KR}」は id なしのまま`;
  });

  await check('3b', '旧データのKRを編集・保存すると、保存先にIDと新しい目標が残り、別の旧KRは書き換わらない', async () => {
    const m = mark();
    await setTarget(legacy, LEGACY_KR, 92);
    await clickSaveIn(legacy, LEGACY_KR);
    await sleep(400);
    const msgs = since(m);
    if (msgs.length) throw new Error('保存で通知が出た: ' + msgs.join(' | '));
    const ls = await readLs(legacy, CO);
    const lk = lsKr(ls, STANDARD, LEGACY_KR);
    const lo = lsKr(ls, NEW_CUST, LEGACY_OTHER_KR);
    evidence.s3_saved = { legacyKr: lk, otherLegacyKr: lo };
    if (lk?.id !== legacyId || lk?.target !== 92) throw new Error('保存先が違う: ' + JSON.stringify(lk));
    if (lo?.id) throw new Error('別の旧KRに保存でIDが付いた: ' + lo.id);
    return `保存先: 「${LEGACY_KR}」id=${legacyId}, 目標 92。「${LEGACY_OTHER_KR}」は id なしのまま`;
  });

  await check('3c', '保存後に再読込しても、そのKRは編集・保存できる', async () => {
    await legacy.goto(OKR_URL);
    await legacy.getByText('プロジェクト一覧').first().waitFor({ timeout: 10000 });
    await sleep(400);
    await openProject(legacy, STANDARD);
    const kr = findKrStore(await readStore(legacy), STANDARD, LEGACY_KR);
    if (kr?.id !== legacyId) throw new Error('再読込後のIDが違う: ' + JSON.stringify(kr?.id));
    const m = mark();
    await krRowOf(legacy, LEGACY_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(legacy, LEGACY_KR).waitFor({ timeout: 5000 });
    await setTarget(legacy, LEGACY_KR, 93);
    await clickSaveIn(legacy, LEGACY_KR);
    await sleep(400);
    const msgs = since(m);
    if (msgs.length) throw new Error('通知が出た: ' + msgs.join(' | '));
    const lk = lsKr(await readLs(legacy, CO), STANDARD, LEGACY_KR);
    if (lk?.target !== 93 || lk?.id !== legacyId) throw new Error('再読込後の保存が違う: ' + JSON.stringify(lk));
    return `再読込後も id=${legacyId} のまま、目標 93 を保存`;
  });

  await ctxC.close();

  /* ============ ctxF：6（保存失敗：成功の通知を出さず、STAGE5 の実績を巻き戻す） ============ */
  const ctxF = await newContext(browser, 'F');
  const f = await ctxF.newPage();
  await openOkr(f);
  await f.evaluate(() => { window.__flow.failSave = true; });

  await check('6a', '保存失敗（AI案の反映）：成功の通知は出ず、失敗の通知が出る', async () => {
    await openProject(f, RETENTION);
    const { got, msgs } = await generateAndApply(f);
    evidence.s6a_dialogs = msgs;
    if (!got) throw new Error('通知が出ない');
    if (isSuccessMsg(msgs)) throw new Error('成功の通知が出た: ' + msgs.join(' | '));
    if (!msgs.some((x) => x.includes('保存されませんでした') && x.includes('保存に失敗しました'))) throw new Error('失敗の通知がない: ' + msgs.join(' | '));
    const ls = await readLs(f, CO);
    if (ls !== null) throw new Error('失敗したのに保存先に書かれている');
    return '通知「' + msgs[0] + '」。成功の通知なし。保存先は未作成のまま';
  });

  await check('6b', '保存失敗（KR編集）：成功の通知は出ず、失敗の通知が出る', async () => {
    const m = mark();
    await krRowOf(f, RET_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(f, RET_KR).waitFor({ timeout: 5000 });
    await setTarget(f, RET_KR, 97);
    await clickSaveIn(f, RET_KR);
    await sleep(400);
    const msgs = since(m);
    evidence.s6b_dialogs = msgs;
    if (!msgs.some((x) => x === '保存に失敗しました。もう一度お試しください。')) throw new Error('失敗の通知がない: ' + msgs.join(' | '));
    if (isSuccessMsg(msgs)) throw new Error('成功の通知が出た');
    if (lsKr(await readLs(f, CO), RETENTION, RET_KR)) throw new Error('失敗したのに保存先に書かれている');
    return '通知「' + msgs[0] + '」。成功の通知なし';
  });

  await check('6e', '保存の競合（revision競合・KR編集）：成功の通知は出ず、競合の通知が出て、編集は残る', async () => {
    await f.evaluate(() => { window.__flow.failSave = false; window.__flow.conflict = true; });
    await krEditOf(f, RET_KR).getByRole('button', { name: 'キャンセル', exact: true }).click();
    await sleep(200);
    const m = mark();
    await krRowOf(f, RET_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(f, RET_KR).waitFor({ timeout: 5000 });
    await setTarget(f, RET_KR, 98);
    await clickSaveIn(f, RET_KR);
    await sleep(400);
    await f.evaluate(() => { window.__flow.conflict = false; });
    const msgs = since(m);
    evidence.s6e_dialogs = msgs;
    if (!msgs.some((x) => x.includes('他の更新と競合したため'))) throw new Error('競合の通知がない: ' + msgs.join(' | '));
    if (isSuccessMsg(msgs)) throw new Error('成功の通知が出た');
    if (!(await krEditOf(f, RET_KR).isVisible())) throw new Error('競合後に編集フォームが閉じた');
    if (lsKr(await readLs(f, CO), RETENTION, RET_KR)?.target === 98) throw new Error('競合したのに保存先に書かれている');
    return '通知「' + msgs[0] + '」。編集フォームは残り、保存先は未更新';
  });

  const ex6 = await ctxF.newPage();
  await openExec(ex6);
  await ex6.evaluate(() => { window.__flow.failSave = true; });

  await check('6c', '保存失敗（STAGE5の実績記録）：実績は表示されず、店舗の実績も記録前に戻る', async () => {
    await recordActual(ex6, RET_KR, 92, '2026-10');
    const row = execRow(ex6, RET_KR);
    const t = await row.innerText();
    const alert = await row.locator('[role=alert]').innerText().catch(() => '');
    evidence.s6c = { rowText: t.slice(0, 120), alert };
    if (!alert.includes('保存に失敗しました。もう一度お試しください。')) throw new Error('失敗の表示がない: ' + alert);
    if (!t.includes('実績：未確認')) throw new Error('実績が表示に残った: ' + t.slice(0, 120));
    const st = findKrStore(await readStore(ex6), RETENTION, RET_KR);
    if (st.actual !== null) throw new Error('店舗の実績が巻き戻っていない: ' + JSON.stringify(st.actual));
    return '失敗の表示「' + alert + '」。実績は「未確認」、店舗の実績は null（巻き戻し済み）';
  });

  await check('6d', '保存失敗（実績の更新）：直前に保存済みの実績 92 が表示と店舗に残り、履歴は増えない', async () => {
    await ex6.evaluate(() => { window.__flow.failSave = false; });
    await recordActual(ex6, RET_KR, 92, '2026-10');
    const okText = await execRow(ex6, RET_KR).innerText();
    if (!okText.includes('実績：92 %（基準日 2026-10）')) throw new Error('準備の記録に失敗: ' + okText.slice(0, 100));
    await ex6.evaluate(() => { window.__flow.failSave = true; });
    await recordActual(ex6, RET_KR, 90, '2026-11', { update: true });
    const row = execRow(ex6, RET_KR);
    const t = await row.innerText();
    const alert = await row.locator('[role=alert]').innerText().catch(() => '');
    const st = findKrStore(await readStore(ex6), RETENTION, RET_KR);
    const ls = lsKr(await readLs(ex6, CO), RETENTION, RET_KR);
    evidence.s6d = { rowText: t.slice(0, 120), alert, store: st.actual, history: st.actualHistory, saved: ls?.actual };
    if (!alert.includes('保存に失敗しました。もう一度お試しください。')) throw new Error('失敗の表示がない: ' + alert);
    if (!t.includes('実績：92 %（基準日 2026-10）')) throw new Error('表示が巻き戻っていない: ' + t.slice(0, 120));
    if (t.includes('90 %')) throw new Error('失敗した値 90 が表示に残った');
    if (st.actual?.value !== 92) throw new Error('店舗の実績が 92 に戻っていない: ' + JSON.stringify(st.actual));
    if (st.actualHistory) throw new Error('履歴が増えた: ' + JSON.stringify(st.actualHistory));
    if (ls?.actual?.value !== 92) throw new Error('保存先の実績が変わった: ' + JSON.stringify(ls?.actual));
    return '失敗の表示。表示・店舗とも 92 %（2026-10）に戻り、履歴は増えない（保存先も 92）';
  });

  await check('6f', '保存失敗（KRの削除）：削除は画面に反映されるが、保存されなかったことを通知する', async () => {
    await f.evaluate(() => { window.__flow.failSave = true; });
    if (await krEditOf(f, RET_KR).isVisible()) await krEditOf(f, RET_KR).getByRole('button', { name: 'キャンセル', exact: true }).click();
    await sleep(200);
    const m = mark();
    await krRowOf(f, RET_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(f, RET_KR).waitFor({ timeout: 5000 });
    await krEditOf(f, RET_KR).getByRole('button', { name: '削除', exact: true }).click();
    await sleep(400);
    await f.evaluate(() => { window.__flow.failSave = false; });
    const msgs = since(m);
    evidence.s6f_dialogs = msgs;
    if (!msgs.some((x) => x.includes('KRを削除しましたが、保存されませんでした'))) throw new Error('削除の保存失敗の通知がない: ' + msgs.join(' | '));
    if (isSuccessMsg(msgs)) throw new Error('成功の通知が出た');
    return '通知「' + msgs[0] + '」';
  });

  await ctxF.close();

  /* ============ ctxG：7（保存中に会社を切り替える）と、対照（切替なし） ============ */
  const ctxG = await newContext(browser, 'G');
  const g = await ctxG.newPage();
  await openOkr(g);
  await g.evaluate(() => { window.__flow.delayMs = 1500; });

  await check('7a', '保存の応答前に会社を切り替えると、保存は書き込まれず、会社切替の通知が出る', async () => {
    await openProject(g, RETENTION);
    const m = mark();
    await krRowOf(g, RET_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(g, RET_KR).waitFor({ timeout: 5000 });
    await setTarget(g, RET_KR, 96);
    await clickSaveIn(g, RET_KR);
    await sleep(200);
    await g.evaluate(() => window.__flow.switchCompany('FICTIONAL-OTHER'));
    await waitDialog(m, 6000);
    await sleep(500);
    const msgs = since(m);
    const ls = await readLs(g, CO);
    const lsOther = await readLs(g, OTHER);
    const log = await g.evaluate(() => window.__saveLog);
    const curCo = await g.evaluate(() => window.__getStrategyState().companyId);
    const depsNow = await readStore(g);
    evidence.s7a = { dialogs: msgs, saveLog: log, companyNow: curCo, storageCo: ls, storageOther: lsOther ? { departments: lsOther.departments.map((d) => d.name), revision: lsOther.revision } : null };
    if (!msgs.some((x) => x.startsWith('会社または戦略が切り替わったため、保存されませんでした'))) throw new Error('会社切替の通知がない: ' + msgs.join(' | '));
    if (isSuccessMsg(msgs)) throw new Error('成功の通知が出た');
    if (lsKr(ls, RETENTION, RET_KR)) throw new Error('元の会社の保存先に書かれている: ' + JSON.stringify(lsKr(ls, RETENTION, RET_KR)));
    const leaked = JSON.stringify(lsOther ?? {}).includes('既存顧客の保守契約更新') || JSON.stringify(lsOther ?? {}).includes('"target":96');
    if (leaked) throw new Error('別の会社の保存先に、元の会社のデータが書かれた');
    if (!log.some((r) => r.company === CO && r.result === 'scope_changed')) throw new Error('scope_changed の記録がない');
    if (curCo !== OTHER) throw new Error('会社が切り替わっていない');
    void depsNow;
    return `通知「${msgs[0]}」。${CO} の保存先に書き込みなし。${OTHER} の保存先にも元会社のデータなし（保存先: ${lsOther ? 'あり（自社データの自動保存のみ）' : 'なし'}）`;
  });

  const gCtrl = await newContext(browser, 'G2');
  const g2 = await gCtrl.newPage();
  await openOkr(g2);
  await g2.evaluate(() => { window.__flow.delayMs = 1500; });

  await check('7b', '対照：切替をしなければ、同じ保存は元の会社の保存先に書かれる（7a の否定が空振りでないこと）', async () => {
    await openProject(g2, RETENTION);
    const m = mark();
    await krRowOf(g2, RET_KR).getByRole('button', { name: '編集', exact: true }).click();
    await krEditOf(g2, RET_KR).waitFor({ timeout: 5000 });
    await setTarget(g2, RET_KR, 96);
    await clickSaveIn(g2, RET_KR);
    await sleep(2200);
    const msgs = since(m);
    const lk = lsKr(await readLs(g2, CO), RETENTION, RET_KR);
    evidence.s7b = { dialogs: msgs, saved: lk };
    if (msgs.length) throw new Error('通知が出た: ' + msgs.join(' | '));
    if (lk?.target !== 96) throw new Error('対照で保存されない: ' + JSON.stringify(lk));
    return `切替なしの保存は ${CO} の保存先に target=96 として書かれた（通知なし）`;
  });
  await gCtrl.close();
  await ctxG.close();

  /* ============ 全体：例外・外部通信 ============ */
  await check('9', 'ブラウザ実行中に未処理の例外（pageerror）がない', async () => {
    if (pageErrors.length) throw new Error(pageErrors.slice(0, 2).join(' | '));
    return '未処理の例外 0件';
  });
  await check('9b', '外部への通信はすべて遮断（file:// 以外は abort）', async () => {
    if (external.length) throw new Error('遮断した外部通信: ' + external.length + '件（例: ' + external[0] + '）');
    return '外部への通信 0件（遮断）';
  });

  await browser.close();

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    skip: results.filter((r) => r.status === 'SKIP').length,
  };
  const out = { summary, results, evidence, dialogs, pageErrors, consoleErrors: consoleErrors.slice(0, 50), consoleErrorCount: consoleErrors.length, external: external.slice(0, 20), externalCount: external.length };
  fs.writeFileSync(path.join(outDir, 'browser-results-kr-flow.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary));
  for (const r of results) console.log(`${r.status}  ${r.id}  ${r.name}  -- ${r.detail}`);
  if (evidence.observation_objective) console.log('INFO  obs  AI案の通知と目的の保存の食い違い（判定外）  -- ' + JSON.stringify(evidence.observation_objective));
  if (pageErrors.length) console.log('pageerrors:', pageErrors.slice(0, 4));
  if (consoleErrors.length) console.log('console errors (' + consoleErrors.length + '):', consoleErrors.slice(0, 4));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run failed:', e);
  process.exit(2);
});
