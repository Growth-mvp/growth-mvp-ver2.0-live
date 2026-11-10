/* eslint-disable @typescript-eslint/no-explicit-any -- 保存済みの記録の形を直接たどる検証のため */
import growth from './fixtures/growth.json';
import { buildDocModel } from './documentModel';

const clone = (v: unknown) => JSON.parse(JSON.stringify(v)) as any;

describe('実施事項の成果物・判断条件・段階の表示', () => {
  it('旧い草案（項目が無い）は、新しい項目が無いまま閲覧でき、勝手に補完しない', () => {
    const doc = buildDocModel(clone(growth), {});
    expect(doc.actions.length).toBeGreaterThan(0);
    for (const a of doc.actions) {
      expect(a.deliverable).toBeNull();
      expect(a.exitCondition).toBeNull();
      expect(a.stage).toBeNull();
    }
  });

  it('新しい項目がある草案は、成果物・判断条件・収益化の段階の名前を表示用に渡す', () => {
    const bundle = clone(growth);
    bundle.plan.section2.actions[0] = {
      ...bundle.plan.section2.actions[0],
      deliverable: '案件別の顧客要件表',
      exitCondition: '要件が3案件そろった',
      valueStage: 'ORDER_INTENT',
    };
    const first = buildDocModel(bundle, {}).actions[0];
    expect(first.deliverable).toBe('案件別の顧客要件表');
    expect(first.exitCondition).toBe('要件が3案件そろった');
    expect(first.stage).toBe('発注意思の確認');
  });

  it('表示用のデータに、段階の内部コードを出さない', () => {
    const bundle = clone(growth);
    bundle.plan.section2.actions[0].valueStage = 'MASS_PRODUCTION_DECISION';
    const body = JSON.stringify(buildDocModel(bundle, {}).actions);
    expect(body).not.toContain('MASS_PRODUCTION_DECISION');
    expect(body).toContain('量産移行判断');
  });
});

describe('財務効果の分類（NOT_FINANCIAL）の表示と集計', () => {
  const withNotFinancial = () => {
    const bundle = clone(growth);
    const f = bundle.plan.section4.financeItems[0];
    f.label = '案件別の限界利益';
    f.kind = 'NOT_FINANCIAL';
    f.method = 'FREE';
    f.freeNote = '算定式：限界利益 = 売上 − 直接原価。直接原価が不足';
    return { bundle, key: f.key as string };
  };

  it('財務効果なし、と読める表示をせず、算定・分類は要確認と示す', () => {
    const { bundle } = withNotFinancial();
    const doc = buildDocModel(bundle, {});
    const lines = doc.impact.financeLines.map((l) => l.text).join('\n');
    expect(lines).toContain('要確認');
    expect(lines).not.toContain('財務効果なし');
  });

  it('利用者が金額を入力して確認しても、NOT_FINANCIAL は確定として集計されない', () => {
    const { bundle, key } = withNotFinancial();
    const edits = { [`finance:${key}:amountYen`]: 1000000, [`finance:${key}:confirmed`]: true };
    const doc = buildDocModel(bundle, edits as any);
    const row = doc.impact.financeLines.find((l) => l.label === '案件別の限界利益');
    expect(row?.status).not.toBe('CONFIRMED');
    expect(doc.impact.financeLines.some((l) => l.status === 'CONFIRMED')).toBe(false);
  });
});
