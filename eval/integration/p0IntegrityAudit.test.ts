/* GROWTH SHIFT P0 数値連動の完全性監査（評価専用。本番DB・実OpenAIには接続しない）。
 * 監査（初回）で再現された不具合の回帰テスト。修正後の仕様を検証する。
 * 各テストの「修正前」は、監査時点で観測した挙動（修正前の値の根拠）。
 * 実際の関数（applyProjectImpactPatch・resolveManualImpacts・inferAutoProjectTargetImpacts・mergeImpacts・
 * getExecutionWeight・unitToYen・normalizeStrategyData）を呼ぶ。 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { applyProjectImpactPatch } from '@/lib/okr/projectImpactPatch';
import { chartEffectiveDelta, resolveManualImpacts, stage6ProjectKeyOf } from '@/lib/okr/impactRows';
import { unitToYen } from '@/lib/okr/impactUnits';
import { inferAutoProjectTargetImpacts, mergeImpacts } from '@/utils/stage6/autoLinking';
import { getExecutionWeight } from '@/utils/stage6/execution';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { generateProjectId } from '@/utils/supabase/stableIdGenerator';
import { computeFinanceEffect, findFinanceEffectOverlapCandidates } from '@/lib/financeEffect';

const OUT_DIR = path.join(__dirname, 'results-verify');
const M = 1_000_000;
const R: Record<string, any> = {};

beforeAll(() => mkdirSync(OUT_DIR, { recursive: true }));
afterAll(() => writeFileSync(path.join(OUT_DIR, 'p0-integrity-audit.json'), JSON.stringify(R, null, 2), 'utf8'));

/* ---------- フィクスチャ ---------- */
const dept = (name: string, projects: any[]) => ({ id: `dept-${name}`, name, projects });
const proj = (title: string, extra: Record<string, any> = {}) => ({ title, role: 'REVENUE', ...extra });
const baseState = (departments: any[], unit = '百万円') => ({
  version: 1,
  departments,
  companyTargets: [{ id: 'rev', label: '売上', unit, base: 1000 }],
  projectTargetImpacts: [] as any[],
});
const withRevenue = (st: any, d: number, p: number, amountMJPY: number) =>
  applyProjectImpactPatch(st, d, p, { impactRevenueMJPY: amountMJPY });
const reorder = (st: any, dIdx: number, order: number[]) => {
  const d = st.departments[dIdx];
  return { ...st, departments: st.departments.map((x: any, i: number) => (i === dIdx ? { ...d, projects: order.map((o) => d.projects[o]) } : x)) };
};

/** 手動行の解決結果（集計に使う行と除外行） */
const resolve = (st: any) => resolveManualImpacts({ rows: st.projectTargetImpacts, departments: st.departments, companyTargets: st.companyTargets });

/** 解決後の行が指す施策（無ければ null） */
function targetOf(st: any, resolvedProjectId: string): any | null {
  let found: any = null;
  st.departments.forEach((d: any) =>
    (d.projects ?? []).forEach((p: any, idx: number) => {
      if (stage6ProjectKeyOf(d, p, idx) === resolvedProjectId) found = p;
    }),
  );
  return found;
}

/** チャートに入る手動行の合計（目標の単位）。集計対象外の行は入らない */
const manualTotal = (st: any) => resolve(st).rows.reduce((s: number, r: any) => s + r.delta, 0);

const sum = (rows: Array<{ delta: number }>) => rows.reduce((s, r) => s + r.delta, 0);

/* =====================================================================
 * 1. 施策と財務効果の同一性
 * ===================================================================== */
describe('1. 施策と金額行の同一性', () => {
  it('1-1 並べ替え：金額行はAに付いたまま（修正前：どの施策にも紐づかず孤立していた）', () => {
    const s0 = withRevenue(baseState([dept('営業部', [proj('A'), proj('B')])]), 0, 0, 10);
    const s1 = reorder(s0, 0, [1, 0]);
    const r = resolve(s1);
    R.S1_1_reorder = {
      入力: 'Aに売上10百万円、[A,B]→[B,A]',
      期待: 'Aの行はAに追随、合計10',
      実測_指す施策: r.rows.map((x: any) => targetOf(s1, x.projectId)?.title),
      実測_合計: manualTotal(s1),
      実測_除外: r.excluded,
      修正前: '行は表に出ず、合計にだけ残る（孤立）',
    };
    expect(targetOf(s1, r.rows[0].projectId).title).toBe('A');
    expect(manualTotal(s1)).toBe(10);
    expect(r.excluded).toEqual([]);
  });

  it('1-2 改名：A→A2 でも金額行はA2に残る（修正前：行が表示から外れた）', () => {
    const s0 = withRevenue(baseState([dept('営業部', [proj('A'), proj('B')])]), 0, 0, 10);
    const a = s0.departments[0].projects[0];
    const s1 = { ...s0, departments: [dept('営業部', [proj('A2', { projectUid: a.projectUid }), proj('B')])] };
    const r = resolve(s1);
    R.S1_2_rename = { 期待: 'A2に10', 実測_指す施策: r.rows.map((x: any) => targetOf(s1, x.projectId)?.title), 実測_合計: manualTotal(s1), 修正前: '指す施策なし（孤立）' };
    expect(targetOf(s1, r.rows[0].projectId).title).toBe('A2');
    expect(manualTotal(s1)).toBe(10);
  });

  it('1-3 施策の追加（先頭）：Aの金額行はAのまま（修正前：先頭の新施策Nへ移った）', () => {
    const s0 = withRevenue(baseState([dept('営業部', [proj('A'), proj('B')])]), 0, 0, 10);
    const [a, b] = s0.departments[0].projects;
    const s1 = { ...s0, departments: [dept('営業部', [proj('N'), a, b])] };
    const r = resolve(s1);
    R.S1_3_add_front = { 期待: 'Aに10', 実測_指す施策: r.rows.map((x: any) => targetOf(s1, x.projectId)?.title), 実測_合計: manualTotal(s1), 修正前: 'Nに移る（添字キー）' };
    expect(targetOf(s1, r.rows[0].projectId).title).toBe('A');
  });

  it('1-4 施策の削除：削除したAの行は集計から外れ、理由つきで残る（修正前：Bへ移り合計に残った）', () => {
    const s0 = withRevenue(baseState([dept('営業部', [proj('A'), proj('B')])]), 0, 0, 10);
    const s1 = { ...s0, departments: [dept('営業部', [proj('B')])] };
    const r = resolve(s1);
    R.S1_4_delete = { 期待: '合計0・除外1件（行は消さない）', 実測_合計: manualTotal(s1), 実測_除外: r.excluded, 実測_状態の行数: s1.projectTargetImpacts.length, 修正前: '添字キーでBを指し、合計に残った' };
    expect(manualTotal(s1)).toBe(0);
    expect(r.excluded).toEqual([expect.objectContaining({ reason: expect.stringContaining('見つからない') })]);
    expect(s1.projectTargetImpacts).toHaveLength(1);
  });

  it('1-5 同名施策：2番目の「新規開拓」の金額は、並べ替えても2番目に残る（修正前：1番目へ移った）', () => {
    const s0 = withRevenue(baseState([dept('営業部', [proj('新規開拓', { memo: '第1' }), proj('新規開拓', { memo: '第2' })])]), 0, 1, 10);
    const s1 = reorder(s0, 0, [1, 0]);
    const r = resolve(s1);
    R.S1_5_same_name = { 期待: 'memo=第2 に10', 実測_指す施策memo: r.rows.map((x: any) => targetOf(s1, x.projectId)?.memo), 修正前: 'memo=第1 へ移った' };
    expect(targetOf(s1, r.rows[0].projectId).memo).toBe('第2');
  });

  it('1-5b 同名施策の旧形式の行：どれか特定できないので集計から外す（修正前：誤った施策へ入った）', () => {
    const st = baseState([dept('営業部', [proj('新規開拓', { memo: '第1' }), proj('新規開拓', { memo: '第2' })])]);
    const legacy = { ...st, projectTargetImpacts: [{ projectId: '営業部::新規開拓::1', targetId: 'rev', delta: 10, source: 'manual', locked: true }] };
    const r = resolve(legacy);
    R.S1_5b_legacy_same_name = { 期待: '集計から外れ、理由に「複数」', 実測_集計: r.rows, 実測_除外: r.excluded };
    expect(r.rows).toEqual([]);
    expect(r.excluded[0].reason).toContain('複数');
  });

  it('1-6 空白のある部門名・施策名：旧形式の行は一意に特定できる（修正前：表から外れた）', () => {
    const st = baseState([dept(' 営業部 ', [proj(' A ')])]);
    const legacy = { ...st, projectTargetImpacts: [{ projectId: '営業部::A::0', targetId: 'rev', delta: 10, source: 'manual', locked: true }] };
    const r = resolve(legacy);
    const displayKey = stage6ProjectKeyOf(legacy.departments[0], legacy.departments[0].projects[0], 0);
    R.S1_6_whitespace = { 期待: '表の参照キーと一致し、集計に入る', 実測_集計キー: r.rows.map((x: any) => x.projectId), 実測_表の参照キー: displayKey, 実測_除外: r.excluded };
    expect(r.rows[0].projectId).toBe(displayKey);
    expect(r.excluded).toEqual([]);
  });

  it('1-6b 部門名が空の旧形式の行：参照できないので集計から外し、理由を出す（修正前：表から外れた）', () => {
    const st = baseState([{ id: 'x', name: '', projects: [proj('A')] }]);
    const legacy = { ...st, projectTargetImpacts: [{ projectId: 'dept1::A::0', targetId: 'rev', delta: 10, source: 'manual', locked: true }] };
    const r = resolve(legacy);
    R.S1_6b_unnamed = { 期待: '集計から外れ、理由あり', 実測_除外: r.excluded };
    expect(r.rows).toEqual([]);
    expect(r.excluded).toHaveLength(1);
  });

  it('1-7 保存・再読込：施策の一意IDと金額行は、再読込後も同じ施策を指す', () => {
    const st = withRevenue(baseState([dept('営業部', [proj('A'), proj('B')])]), 0, 0, 10);
    const reloaded: any = normalizeStrategyData(JSON.parse(JSON.stringify({ departments: st.departments, projectTargetImpacts: st.projectTargetImpacts })) as any);
    const st2 = { ...st, departments: reloaded.departments };
    const r = resolve(st2);
    R.S1_7_reload = { 期待: 'Aに10（一意IDが保存される）', 実測_一意ID: reloaded.departments[0].projects.map((p: any) => ({ title: p.title, projectUid: p.projectUid ?? null })), 実測_指す施策: r.rows.map((x: any) => targetOf(st2, x.projectId)?.title) };
    expect(r.rows.map((x: any) => targetOf(st2, x.projectId)?.title)).toEqual(['A']);
  });

  it('1-8 企業・戦略の切り替え：一意IDは戦略ごとに別なので、別戦略の行は混ざらない（修正前：同じキー）', () => {
    const s1 = withRevenue(baseState([dept('営業部', [proj('A')])]), 0, 0, 10);
    const s2 = withRevenue(baseState([dept('営業部', [proj('A')])]), 0, 0, 99);
    const r = resolve({ ...s2, projectTargetImpacts: s1.projectTargetImpacts });
    R.S1_8_strategy_switch = { 期待: '戦略1の行は戦略2に当たらない（除外される）', 実測_集計: r.rows, 実測_除外: r.excluded, 参考_一意IDの衝突: generateProjectId('S1', 'd', 'A') === generateProjectId('S2', 'd', 'A') };
    expect(r.rows).toEqual([]);
    expect(r.excluded).toHaveLength(1);
  });

  it('1-9 正規化の単体関数を通しても、北極星の手動行は落ちない', () => {
    const st = withRevenue(baseState([dept('営業部', [proj('A')])]), 0, 0, 10);
    const loaded: any = normalizeStrategyData(JSON.parse(JSON.stringify({ departments: st.departments, projectTargetImpacts: st.projectTargetImpacts })) as any);
    R.S1_9_persist_rows = { 正規化後の行: loaded.projectTargetImpacts ?? null, 判定: '正規化で保持（companyTargets・projectTargetImpacts の通し）' };
    expect(loaded.projectTargetImpacts).toEqual(st.projectTargetImpacts);
  });
});

/* =====================================================================
 * 2. 自動連携の計算
 * ===================================================================== */
const kr = (kind: string, weight = 1) => ({ id: kind, kind, label: kind, target: 1, unit: '件', scope: 'project', baseKey: 'x', weight });

function autoRun(label: string, base: number, high: number, krs: Record<string, any[]>, weights: Record<string, number> = {}) {
  return inferAutoProjectTargetImpacts({
    companyTargets: [{ id: 'T', label, unit: '百万円', base, low: base, high } as any],
    projectKeys: Object.keys(krs),
    projectKrsMap: new Map(Object.entries(krs)) as any,
    executionWeightsMap: new Map(Object.entries(weights).map(([k, w]) => [k, { weight: w }])),
    scenarioKey: 'high',
  });
}

describe('2. 自動連携：配分・実行重み・集計', () => {
  it('2-1 実行重みは配分の中で1回だけ働く：自動行の合計は差分のまま、チャートで再度掛けない（修正前：重み²）', () => {
    const rows = autoRun('売上', 1000, 1100, { 'D::P1::0': [kr('REVENUE')], 'D::P2::1': [] }, { 'D::P1::0': 1.2 });
    const chart = rows.map((r) => chartEffectiveDelta(r, 1.2));
    R.S2_1_double_weight = { 入力: 'gap=100百万円、P1のみ関連、実行重み1.2', 期待_合計: 100, 実測_自動行: rows.map((r) => r.delta), 実測_チャート: chart, 修正前: '自動行120、チャート144' };
    expect(sum(rows)).toBeCloseTo(100, 9);
    expect(chart.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 9);
  });

  it('2-2 配分率の合計は100%を超えない（修正前：175%）', () => {
    const rows = autoRun('営業利益', 100, 120, { 'D::P1::0': [kr('REVENUE')], 'D::P2::1': [kr('INVEST')] });
    R.S2_2_share_sum = { 入力: 'gap=20百万円、P1は売上KR、P2は投資KR（負の関連）', 期待_合計: 20, 実測_合計: sum(rows), 実測_行: rows.map((r) => ({ projectId: r.projectId, delta: r.delta })), 修正前: '35（175%）' };
    expect(sum(rows)).toBeCloseTo(20, 9);
  });

  it('2-3 負の関連度を分母に入れず、正の関連度の施策の配分を失わない（修正前：0に落ちた）', () => {
    const rows = autoRun('ROIC', 10, 12, { 'D::P1::0': [kr('REVENUE'), kr('INVEST')], 'D::P2::1': [kr('INVEST')] });
    R.S2_3_negative_total = { 入力: 'gap=+2、P1の関連度+0.05、P2は-0.5', 期待: 'P1に2', 実測_行: rows.map((r) => ({ projectId: r.projectId, delta: r.delta })), 修正前: 'P1の配分0' };
    expect(rows.map((r) => r.projectId)).toEqual(['D::P1::0']);
    expect(rows[0].delta).toBeCloseTo(2, 9);
  });

  it('2-4 分母がゼロ近傍でも、倍率は発散しない（修正前：2.7×10^15倍）', () => {
    const rows = autoRun('PBR', 1, 2, {
      'D::P1::0': [{ ...kr('REVENUE'), weight: 3 }, { ...kr('INVEST'), weight: 0.5 }],
      'D::P2::1': [kr('INVEST')],
    });
    R.S2_4_zero_denominator = { 入力: 'gap=1、P1の関連度0.3（有効）、P2は-0.3（無効）', 期待: 'P1に1（上限は差分）', 実測_行: rows.map((r) => ({ projectId: r.projectId, delta: r.delta })), 修正前: '2.7×10^15' };
    expect(rows.every((r) => Number.isFinite(r.delta))).toBe(true);
    expect(sum(rows)).toBeCloseTo(1, 9);
  });

  it('2-5 関連性のない施策には、均等配分しない（修正前：両施策に50ずつ）', () => {
    const rows = autoRun('売上', 1000, 1100, { 'D::P1::0': [], 'D::P2::1': [] });
    R.S2_5_zero_relevance = { 入力: 'gap=100、両施策ともKRなし', 期待: '行なし（未配分100）', 実測_行: rows, 修正前: '50と50' };
    expect(rows).toEqual([]);
  });

  it('2-6 削除された施策の手動行は、北極星の合計に加算されない（修正前：110、期待100）', () => {
    const st = baseState([dept('営業部', [proj('B', { projectUid: 'uid-B' })])]);
    const withOrphan = { ...st, projectTargetImpacts: [{ projectId: 'uid-A', targetId: 'rev', delta: 10, source: 'manual', locked: true }] };
    const auto = autoRun('売上', 1000, 1100, { '営業部::B::0': [kr('REVENUE')] });
    const r = resolve(withOrphan);
    const effective = mergeImpacts({ manual: r.rows, auto });
    const total = effective.reduce((s, x) => s + chartEffectiveDelta(x, 1), 0);
    R.S2_6_orphan = { 期待_合計: 100, 実測_合計: total, 実測_除外: r.excluded, 修正前: '110（孤立した10が加算）' };
    expect(total).toBeCloseTo(100, 9);
    expect(r.excluded).toHaveLength(1);
  });

  it('2-7 同じ施策・目標の手動行と自動行は、手動行だけが残る（重複加算なし）', () => {
    const merged = mergeImpacts({
      manual: [{ projectId: 'D::A::0', targetId: 'T', delta: 10, source: 'manual', locked: true }] as any,
      auto: [{ projectId: 'D::A::0', targetId: 'T', delta: 50, source: 'auto', locked: false }] as any,
    });
    R.S2_7_manual_vs_auto = { 期待: '10', 実測: merged.map((m) => m.delta) };
    expect(merged.map((m) => m.delta)).toEqual([10]);
  });

  it('2-8 成果見込み%から作る実行重み（残存：STAGE5の成果見込みが重みに入る。定義の見直しは保留）', () => {
    const w = [0, 50, 100].map((p) => getExecutionWeight('A', undefined, { projectKey: 'D::A::0', impactRevenueProgress: p }).weight);
    R.S2_8_exec_weight_from_progress = { 実測: w, 判定: '残存。成果見込み%が重みに入る（保留・報告）' };
    expect(w).toEqual([0.6, 0.8, 1]);
  });

  it('2-9 自動行の値はKRの目標値に依存しない（構造。KRシミュレーションとの二重は報告・保留）', () => {
    const run = (target: number) => autoRun('売上', 1000, 1100, { 'D::P::0': [{ ...kr('ACQ'), target }] })[0].delta;
    R.S2_9_kr_auto_structure = { 実測_KR目標120: run(120), 実測_KR目標1200: run(1200), 判定: '目標差分だけで決まる。KR効果と同じ出所なら二重（保留）' };
    expect(run(120)).toBe(run(1200));
  });
});

/* =====================================================================
 * 3. 上段・下段・単位
 * ===================================================================== */
describe('3. 上段・下段・単位', () => {
  it('3-1 上段と下段の売上の式は定義が違う（残存・保留。今回は一致させない）', () => {
    const weight = getExecutionWeight('A', undefined, { projectKey: 'D::A::0', impactRevenueProgress: 50 }).weight;
    const table = (100 * 50) / 100;
    const chart = chartEffectiveDelta({ delta: 100, source: 'manual' }, weight);
    R.S3_1_upper_lower = { 下段_表: table, 上段_チャート: chart, 判定: '残存。定義の違いを報告（指示どおり一致させない）' };
    expect(table).toBe(50);
    expect(chart).toBeCloseTo(80, 6);
  });

  it.each([
    ['百万円', 10_000_000],
    ['万円', 10_000_000],
    ['円', 10_000_000],
    ['千円', 10_000_000],
  ])('3-2 目標の単位が%sでも、10百万円は同じ金額として集計される（修正前：万円・円で1e4〜1e6倍ずれた）', (unit, expectedYen) => {
    const st = withRevenue(baseState([dept('営業部', [proj('A')])], unit), 0, 0, 10);
    const r = resolve(st);
    const yen = r.rows.reduce((s: number, x: any) => s + (unitToYen(x.delta, unit) ?? NaN), 0);
    R[`S3_2_unit_${unit}`] = { 期待_円: expectedYen, 実測_円: yen, 実測_行の値: r.rows.map((x: any) => x.delta), 実測_除外: r.excluded };
    expect(yen).toBe(expectedYen);
  });

  it('3-2b 目標の単位が特定できないとき、換算せず集計から外す（修正前：黙って円扱い）', () => {
    const st = withRevenue(baseState([dept('営業部', [proj('A')])], '%'), 0, 0, 10);
    const r = resolve(st);
    R.S3_2b_unknown_unit = { 期待: '集計外', 実測_集計: r.rows, 実測_除外: r.excluded };
    expect(r.rows).toEqual([]);
  });

  it('3-3 売上KRのみの施策に、営業利益の自動行が立つ（仕様の確認が必要・残存）', () => {
    const rows = inferAutoProjectTargetImpacts({
      companyTargets: [{ id: 'op', label: '営業利益', unit: '百万円', base: 100, low: 100, high: 110 }],
      projectKeys: ['D::P::0'],
      projectKrsMap: new Map([['D::P::0', [kr('REVENUE')]]]) as any,
      executionWeightsMap: new Map(),
      scenarioKey: 'high',
    } as any);
    R.S3_3_op_auto_for_revenue_project = { 実測: rows.map((r) => ({ projectId: r.projectId, delta: r.delta })), 判定: '残存（保留）' };
    expect(rows).toHaveLength(1);
  });
});

/* =====================================================================
 * 4. 財務効果（北極星への接続と重複）
 * ===================================================================== */
describe('4. 財務効果と北極星の接続', () => {
  const eff = (o: Record<string, any>) => ({
    kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 20 * M, amountBasis: 'ANNUAL', startYm: '2027-04',
    sourceNote: '架空', source: 'USER_INPUT', confirmed: true, confirmedAt: '2026-11-01T00:00:00.000Z', ...o,
  });

  it('4-1 財務効果の状態によらず、北極星の金額行は変わらない（A：未接続）', () => {
    const legacy = withRevenue(baseState([dept('営業部', [proj('A')])]), 0, 0, 10);
    const rowsOf = (s: any) => JSON.stringify(s.projectTargetImpacts);
    const none = applyProjectImpactPatch(legacy, 0, 0, { financeEffect: undefined });
    const draft = applyProjectImpactPatch(legacy, 0, 0, { financeEffect: eff({ confirmed: false }) });
    const confirmed = applyProjectImpactPatch(legacy, 0, 0, { financeEffect: eff({}) });
    expect(rowsOf(none)).toBe(rowsOf(draft));
    expect(rowsOf(draft)).toBe(rowsOf(confirmed));
  });

  it('4-2 旧金額と確認済み財務効果が不一致：北極星は旧金額のまま（意図された移行前。報告）', () => {
    const st = applyProjectImpactPatch(withRevenue(baseState([dept('営業部', [proj('A')])]), 0, 0, 10), 0, 0, { financeEffect: eff({}) });
    R.S4_2_mismatch = { 旧金額: 10, 確認済み財務効果の年額売上: 20, 北極星に入る値: manualTotal(st) };
    expect(manualTotal(st)).toBe(10);
  });

  it('4-3 財務換算しない施策でも、旧金額は残り続ける（意図された移行前。報告）', () => {
    const st = applyProjectImpactPatch(withRevenue(baseState([dept('営業部', [proj('C')])]), 0, 0, 5), 0, 0, {
      financeEffect: { kind: 'NOT_FINANCIAL', source: 'USER_INPUT', confirmed: false },
    });
    R.S4_3_not_financial = { 財務効果: computeFinanceEffect(st.departments[0].projects[0].financeEffect).status, 北極星に入る値: manualTotal(st) };
    expect(manualTotal(st)).toBe(5);
  });

  it('4-4 同一効果の重複候補：検出はするが自動除外はしない（候補表示のみ）', () => {
    const fe = (o: Record<string, any>) => ({ kind: 'REVENUE_UP', method: 'FUNNEL', meetingsPerPeriod: 3, winRatePct: 20, averageDealYen: 10 * M, amountBasis: 'MONTHLY', sourceNote: 'x', source: 'USER_INPUT', confirmed: true, ...o });
    const depts = [{ name: '営業部', projects: [
      { title: 'A', financeEffect: fe({ startYm: '2027-04', scopeNote: '首都圏' }) },
      { title: 'B', financeEffect: fe({ startYm: '2027-04', scopeNote: '首都圏' }) },
    ] }];
    const cands = findFinanceEffectOverlapCandidates(depts, 0, 0);
    R.S4_4_overlap = { 候補: cands, 判定: '表示のみ。統一試算での除外はなし' };
    expect(cands).toEqual(['営業部 / B']);
  });

  it('4-5 施策の並べ替えでも、財務効果は施策オブジェクトと一緒に動く', () => {
    const s0 = applyProjectImpactPatch(baseState([dept('営業部', [proj('A'), proj('B')])]), 0, 0, { financeEffect: eff({}) });
    const s1 = reorder(s0, 0, [1, 0]);
    const titles = s1.departments[0].projects.map((p: any) => ({ title: p.title, 財務効果あり: !!p.financeEffect }));
    R.S4_5_finance_reorder = { 実測: titles };
    expect(titles.find((t: any) => t.title === 'A')!.財務効果あり).toBe(true);
  });
});

/* =====================================================================
 * 5. 入力の型
 * ===================================================================== */
describe('5. 入力の型', () => {
  it('5-1 数値の文字列で入っても、金額行は数値として保存される（修正前も数値化していた）', () => {
    const st = applyProjectImpactPatch(baseState([dept('営業部', [proj('A')])]), 0, 0, { impactRevenueMJPY: '10' as any });
    const row = st.projectTargetImpacts[0];
    R.S5_1_string_amount = { 行の値: row?.delta ?? null, 行の型: typeof row?.delta };
    expect(row.delta).toBe(10);
    expect(typeof row.delta).toBe('number');
  });
});
