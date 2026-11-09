/* eslint-disable @typescript-eslint/no-explicit-any -- 保存済みの表示データの形を直接たどる検証のため */
import growth from './fixtures/growth.json';
import profit from './fixtures/profit.json';
import crossdept from './fixtures/crossdept.json';
import { MAX_PRIORITY, auditMapping, toDisplayPlan } from './adapter.js';

const samples: Record<string, any> = { growth, profit, crossdept };
const clone = (v: unknown) => JSON.parse(JSON.stringify(v));

describe.each(['growth', 'profit', 'crossdept'])('%s：表示データへの変換', (id) => {
  it('元データの項目はすべて、表示・詳細・内部・開発メモのいずれかに対応づく', () => {
    const audit = auditMapping(samples[id]);
    expect(audit.unmatched).toEqual([]);
  });

  it('変換は元データを変更しない', () => {
    const bundle = clone(samples[id]);
    const before = JSON.stringify(bundle);
    toDisplayPlan(bundle, { responsible: '試作の編集', 'action:1:due': '2027-03' });
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it('優先表示は最大件数まで', () => {
    expect(toDisplayPlan(samples[id], {}).priority.length).toBeLessThanOrEqual(MAX_PRIORITY);
  });

  it('通常の表示に、内部のコードや参照IDを出さない', () => {
    const body = JSON.stringify(toDisplayPlan(samples[id], {}).sections, (k, v) => (['key', 'original', 'id'].includes(k) ? undefined : v));
    expect(body).not.toMatch(/BEFORE_START|UNCLASSIFIED|AI_PROVISIONAL|STAGE_DATA|UNCONFIRMED|CUSTOMER_OUTCOME|LEADING|REVENUE_UP|COST_REDUCTION|COST_INCREASE/);
    expect(body).not.toMatch(/\bS[123]-[A-Z]|\b[qcp][gp]?-kpi|\bS[1-9]\b/);
  });

  it('金額の無い財務効果は、0 円ではなく未算定として扱う', () => {
    const f = toDisplayPlan(samples[id], {}).sections[3].blocks[0];
    for (const e of f.effects) {
      expect(e.status).not.toBe('CONFIRMED');
      if (e.status === 'NOT_CALCULATED') expect(e.amountDisplay).toBeNull();
    }
    expect(f.confirmedTotalYen).toBe(0);
  });
});

describe('成長戦略型（検証済みの実出力）', () => {
  const d = toDisplayPlan(samples.growth, {});

  it('障害は重要な3件を優先表示し、残りは詳細に格納する（全件を保持する）', () => {
    const obs = d.sections[0].blocks[6];
    expect(obs.total).toBe(4);
    expect(obs.primary.length).toBe(3);
    expect(obs.more.length).toBe(1);
    expect(obs.primary.some((o: any) => o.regulatory)).toBe(true);
  });

  it('障害の参照は、行動と対応したまま残る', () => {
    const actions = d.sections[1].blocks[0].items;
    expect(actions[1].linkedObstacles.length).toBeGreaterThan(0);
  });

  it('規制の確認は、開始前の条件として残る', () => {
    const reg = d.tasks.filter((t) => t.gate === 'START' && /規制|法令/.test(t.title));
    expect(reg.length).toBeGreaterThan(0);
  });

  it('採用は、未確認事項があっても可能', () => {
    expect(d.adoption.adoptable).toBe(true);
  });

  it('責任者の候補は、確定とは別に示す', () => {
    const r = d.sections[4].blocks[0].responsible;
    expect(r.value).toBe('中村 美咲（仮）');
    expect(r.edited).toBe(false);
  });

  it('確定KPIは入力の内容のまま（判定時期の候補は確定KPIを変えない）', () => {
    const kpis = d.sections[2].blocks[0].protected;
    expect(kpis.map((k: any) => k.label)).toEqual(
      expect.arrayContaining(['試験導入に合意した医療機関数', '試験導入後に継続利用の意向を確認した医療機関数'])
    );
  });
});

describe('画面の編集', () => {
  it('編集した値は、表示にすぐ反映され、元の値は残る', () => {
    const d = toDisplayPlan(samples.growth, { 'action:1:due': '2027-01' });
    const action = d.sections[1].blocks[0].items[0];
    expect(action.due.value).toBe('2027-01');
    expect(action.due.original).toBe('2027-02');
    expect(action.due.edited).toBe(true);
  });
});
