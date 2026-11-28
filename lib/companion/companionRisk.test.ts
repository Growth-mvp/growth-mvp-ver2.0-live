import {
  MAX_FACTS,
  PLAN_GAP_RATIO,
  RISK_GUARD,
  buildRiskPrompt,
  dueEndOf,
  detectRiskFacts,
  isSeriousRisk,
  renderRiskFacts,
  riskFingerprint,
  type RiskInput,
} from './companionRisk';

const NOW = new Date(2026, 10, 19, 10, 0, 0);
const OLD = new Date(2026, 8, 1, 10, 0, 0).toISOString();
const RECENT = new Date(2026, 10, 10, 10, 0, 0).toISOString();

const EMPTY: RiskInput = { now: NOW, cash: [], targets: [], planGaps: [], krs: [], actions: [] };

describe('経営点検：事実の判定（プログラムで決める）', () => {
  it('入力が何もなければ、事実は無い（AIを呼ぶ理由がない）', () => {
    expect(detectRiskFacts(EMPTY)).toEqual([]);
  });

  it('資金不足は、予測年度で不足がある年度だけ事実にする', () => {
    const facts = detectRiskFacts({
      ...EMPTY,
      cash: [
        { year: 2027, isForecast: true, shortfallYen: 3_000_000 },
        { year: 2026, isForecast: false, shortfallYen: 9_000_000 },
        { year: 2028, isForecast: true, shortfallYen: 0 },
        { year: 2029, isForecast: true, shortfallYen: null },
      ],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('CASH');
    expect(facts[0].text).toContain('2027年度');
    expect(facts[0].text).toContain('3,000,000円');
    expect(facts[0].text).toContain('下回る見込み');
  });

  it('経営目標の不足は、不足がある時だけ事実にする（超過や未算定は出さない）', () => {
    const facts = detectRiskFacts({
      ...EMPTY,
      targets: [
        { metric: '売上', source: 'STAGE2', fiscalYear: 2028, gapYen: 500_000 },
        { metric: '営業利益', source: 'STAGE2', fiscalYear: 2028, gapYen: -100_000 },
        { metric: '営業利益', source: 'STAGE2', fiscalYear: null, gapYen: null },
      ],
    });
    expect(facts.map((f) => f.category)).toEqual(['TARGET']);
    expect(facts[0].text).toBe('2028年度の売上：STAGE2の業績目標に対して 500,000円 不足（施策反映後の見通し）');
  });

  it('STAGE6の経営目標の不足は、出所をSTAGE6と明記する', () => {
    const facts = detectRiskFacts({
      ...EMPTY,
      targets: [{ metric: '営業利益', source: 'STAGE6', fiscalYear: 2027, gapYen: 18_000_000 }],
    });
    expect(facts[0].text).toBe('2027年度の営業利益：STAGE6の経営目標に対して 18,000,000円 不足（施策反映後の見通し）');
  });

  it('売上効果が計画の8割を下回り、かつ照合が完了した時だけ、計画との乖離を事実にする', () => {
    const base = { label: '新規販路', where: '営業部 / A社開拓', fiscalYear: 2027, planYen: 10_000_000 };
    const facts = detectRiskFacts({
      ...EMPTY,
      planGaps: [
        { ...base, actualYen: 5_000_000, complete: true },
        { ...base, actualYen: 9_000_000, complete: true },
        { ...base, actualYen: 1_000_000, complete: false },
        { ...base, actualYen: null, complete: true },
      ],
    });
    expect(PLAN_GAP_RATIO).toBe(0.2);
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toContain('計画比 50%');
    expect(facts[0].text).toContain('「新規販路」');
  });

  it('期限を過ぎたKRは、実績の未登録を事実にする（期限前は出さない）', () => {
    const facts = detectRiskFacts({
      ...EMPTY,
      krs: [
        { label: '受注件数', where: '営業部', kind: 'ACQ', unit: '件', due: '2026-10' },
        { label: '受注件数', where: '営業部', kind: 'ACQ', unit: '件', due: '2026-12' },
      ],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('KR_OVERDUE');
    expect(facts[0].text).toContain('実績が未登録');
  });

  it('期限を過ぎたKRは、目標に届かない時だけ事実にする（低い方が良い指標は逆向きに判定する）', () => {
    const facts = detectRiskFacts({
      ...EMPTY,
      krs: [
        { label: '売上成長', where: '営業部', kind: 'REVENUE', unit: '%', due: '2026-09-30', target: 0.1, actual: 0.05 },
        { label: '売上成長2', where: '営業部', kind: 'REVENUE', unit: '%', due: '2026-09-30', target: 0.1, actual: 0.12 },
        { label: '解約率', where: '営業部', kind: 'CHURN', unit: '%', due: '2026-09-30', target: 0.02, actual: 0.03 },
        { label: '解約率2', where: '営業部', kind: 'CHURN', unit: '%', due: '2026-09-30', target: 0.02, actual: 0.01 },
      ],
    });
    expect(facts).toHaveLength(2);
    expect(facts[0].text).toContain('実績 5% が目標 10%');
    expect(facts[1].text).toContain('実績 3% が目標 2%');
  });

  it('進行中のまま30日以上更新がない実施事項だけを、停滞として事実にする', () => {
    const facts = detectRiskFacts({
      ...EMPTY,
      actions: [
        { where: '営業部 / A', inProgress: true, updatedAt: OLD },
        { where: '営業部 / B', inProgress: true, updatedAt: RECENT },
        { where: '営業部 / C', inProgress: false, updatedAt: OLD },
        { where: '営業部 / D', inProgress: true, updatedAt: '' },
      ],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('ACTION_STALLED');
    expect(facts[0].text).toContain('1件');
    expect(facts[0].text).toContain('営業部 / A');
    expect(facts[0].text).not.toContain('営業部 / B');
  });

  it('事実は上限件数までに絞る（AIに渡す量を抑える）', () => {
    const krs = Array.from({ length: 12 }, (_, i) => ({ label: `KR${i}`, where: '営業部', kind: 'ACQ', unit: '件', due: '2026-01' }));
    expect(detectRiskFacts({ ...EMPTY, krs })).toHaveLength(MAX_FACTS);
  });
});

describe('経営点検：重大なリスクの判定', () => {
  it('資金不足と目標未達は重大、それ以外の事実は重大でない', () => {
    const cash = detectRiskFacts({ ...EMPTY, cash: [{ year: 2027, isForecast: true, shortfallYen: 1 }] });
    const target = detectRiskFacts({ ...EMPTY, targets: [{ metric: '売上', source: 'STAGE2', fiscalYear: 2027, gapYen: 1 }] });
    const stalled = detectRiskFacts({ ...EMPTY, actions: [{ where: 'A', inProgress: true, updatedAt: OLD }] });
    expect(isSeriousRisk(cash)).toBe(true);
    expect(isSeriousRisk(target)).toBe(true);
    expect(isSeriousRisk(stalled)).toBe(false);
    expect(isSeriousRisk([])).toBe(false);
  });
});

describe('経営点検：期限と指紋', () => {
  it('期限の月は、その月の末日の終わりまで有効とする', () => {
    expect(dueEndOf('2026-11')?.getDate()).toBe(30);
    expect(dueEndOf('2026-11-19')?.getHours()).toBe(23);
    expect(dueEndOf('来年')).toBeNull();
  });

  it('同じ事実なら同じ指紋、違えば別の指紋になる（内容が変わった時だけ再依頼する）', () => {
    const a = detectRiskFacts({ ...EMPTY, cash: [{ year: 2027, isForecast: true, shortfallYen: 1 }] });
    const b = detectRiskFacts({ ...EMPTY, cash: [{ year: 2027, isForecast: true, shortfallYen: 1 }] });
    const c = detectRiskFacts({ ...EMPTY, cash: [{ year: 2027, isForecast: true, shortfallYen: 2 }] });
    expect(riskFingerprint(a)).toBe(riskFingerprint(b));
    expect(riskFingerprint(a)).not.toBe(riskFingerprint(c));
  });
});

describe('経営点検：AIへの依頼（事実だけを渡し、仮説と候補に分けさせる）', () => {
  it('依頼文は事実を含み、規則は仮説と見直しの候補を区別させる', () => {
    const lines = renderRiskFacts([{ category: 'CASH', text: '2027年度：不足' }]);
    expect(lines).toEqual(['- 2027年度：不足']);
    const prompt = buildRiskPrompt(lines);
    expect(prompt).toContain('事実：');
    expect(prompt).toContain('- 2027年度：不足');
    expect(RISK_GUARD).toContain('「仮説」として考える');
    expect(RISK_GUARD).toContain('見直しの候補');
    expect(RISK_GUARD).toContain('画面の操作手順は書かない');
    expect(RISK_GUARD).toContain('「未登録」と決めつけない');
    expect(RISK_GUARD).not.toContain('未登録のため判断できない');
  });
});

describe('経営点検：判断材料の状態（未登録・未算定・取得失敗・判断材料不足を区別する）', () => {
  it('依頼の規則は、事実にない項目を未登録と断定させない', () => {
    expect(RISK_GUARD).toContain('この点検では判断していない');
  });
});
