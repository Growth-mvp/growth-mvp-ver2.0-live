import { ConsultFocusSchema } from '@/lib/consult/consultFocus';
import { CONSULT_ITEMS_MAX, consultActionRows, consultExecItems, consultText } from '@/lib/stage5/consultFocusItems';
import type { FinanceActualItem } from '@/lib/stage5/financeActuals';
import type { KRStructured } from '@/types/strategy';

const kr = (over: Partial<KRStructured> & { id: string; label: string }) =>
  ({ kind: 'KPI', unit: '%', target: 10, ...over }) as unknown as KRStructured;

const finance = (over: Partial<FinanceActualItem> & { itemKey: string; label: string }) =>
  ({
    kind: 'REVENUE_UP',
    planText: '計画',
    periodText: '期間',
    statusText: '状態',
    recordable: true,
    unrecordableReason: null,
    actuals: [],
    ...over,
  }) as FinanceActualItem;

describe('consultActionRows：実施事項の保存状態', () => {
  const actions = [
    { no: 1, title: '価格を見直す', actionKey: 'k1' },
    { no: 2, title: '未登録の行動', actionKey: '' },
    { no: 3, title: '営業を強化する', actionKey: 'k3' },
  ];
  const progress = { k1: { status: 'IN_PROGRESS' as const, result: '提案済み' }, k3: { status: 'NOT_STARTED' as const, result: '' } };

  it('保存済みの値は saved=true。編集中で保存済みと違う行は saved=false。キーの無い行は除く', () => {
    const rows = consultActionRows({
      actions,
      progress,
      drafts: { k3: { status: 'DONE', memo: '完了した' } },
      busy: false,
    });
    expect(rows).toEqual([
      { no: 1, title: '価格を見直す', status: 'IN_PROGRESS', memo: '提案済み', saved: true },
      { no: 3, title: '営業を強化する', status: 'DONE', memo: '完了した', saved: false },
    ]);
  });

  it('下書きが保存済みと同じなら saved=true。書き込み中（busy）はすべて saved=false', () => {
    const same = consultActionRows({ actions, progress, drafts: { k1: { status: 'IN_PROGRESS', memo: '提案済み' } }, busy: false });
    expect(same[0].saved).toBe(true);
    const busy = consultActionRows({ actions, progress, drafts: {}, busy: true });
    expect(busy.every((r) => !r.saved)).toBe(true);
  });
});

describe('consultExecItems：項目と保存状態', () => {
  it('KRの入力欄が保存済みの実績と違えば未保存。同じなら保存済み', () => {
    const krs = [
      kr({ id: 'a', label: '継続率', actual: { value: 12, asOf: '2026-10', recordedAt: '2026-10-31T00:00:00Z' } }),
      kr({ id: 'b', label: '解約数' }),
    ];
    const items = consultExecItems({
      actionRows: [],
      krs,
      financeItems: [],
      registration: {
        ym: '2026-11',
        finance: {},
        kr: { a: { value: '15', asOf: '2026-11' }, b: { value: '3', asOf: '2026-11' } },
        busy: false,
      },
    });
    expect(items[0]).toMatchObject({ label: '継続率', saved: false });
    expect(items[0].value).toContain('入力中の実績 15%（基準日 2026-11・未保存）');
    expect(items[1]).toMatchObject({ label: '解約数', saved: false });
  });

  it('入力が無く、書き込み中でなければ KR の実績は保存済み。書き込み中は未保存', () => {
    const krs = [kr({ id: 'a', label: '継続率', actual: { value: 12, asOf: '2026-10', recordedAt: '2026-10-31T00:00:00Z' } })];
    const idle = consultExecItems({ actionRows: [], krs, financeItems: [], registration: null });
    expect(idle).toEqual([{ label: '継続率', value: '目標 10 %／実績 12 %（基準日 2026-10）', saved: true }]);
    const busy = consultExecItems({
      actionRows: [],
      krs,
      financeItems: [],
      registration: { ym: '', finance: {}, kr: {}, busy: true },
    });
    expect(busy[0].saved).toBe(false);
  });

  it('財務実績は対象年月が選ばれたときだけ出す。入力と同じ登録済みの金額は保存済み', () => {
    const items = [
      finance({ itemKey: 'EFFECT:REVENUE_UP', label: '売上増加', actuals: [{ ym: '2026-11', amountYen: 1000 } as never] }),
      finance({ itemKey: 'EFFECT:COST_REDUCTION', label: '費用削減' }),
    ];
    expect(consultExecItems({ actionRows: [], krs: [], financeItems: items, registration: null })).toEqual([]);
    const out = consultExecItems({
      actionRows: [],
      krs: [],
      financeItems: items,
      registration: { ym: '2026-11', finance: { 'EFFECT:REVENUE_UP': '1,000', 'EFFECT:COST_REDUCTION': '' }, kr: {}, busy: false },
    });
    expect(out).toEqual([
      { label: '売上増加（財務実績）', value: '2026-11：1,000円', saved: true },
      { label: '費用削減（財務実績）', value: '2026-11：未登録', saved: true },
    ]);
  });

  it('未保存の項目を先頭にし、全体は最大12件。サーバーの検査（ConsultFocusSchema）を通る', () => {
    const krs = Array.from({ length: 15 }, (_, i) => kr({ id: `k${i}`, label: `KR${i}` }));
    const actionRows = [{ no: 1, title: '行動', status: 'DONE' as const, memo: 'x'.repeat(600), saved: false }];
    const items = consultExecItems({ actionRows, krs, financeItems: [], registration: null });
    expect(items).toHaveLength(CONSULT_ITEMS_MAX);
    expect(items[0]).toMatchObject({ label: '1. 行動', saved: false });
    const parsed = ConsultFocusSchema.safeParse({
      pathname: '/execution',
      stage: 5,
      section: '実行支援（進捗・実績）',
      projectId: 'p1',
      items,
      draft: { text: 'あ'.repeat(4000), saved: false },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('consultText', () => {
  it('上限を超える文字列は切る', () => {
    expect(consultText('abcdef', 4)).toBe('abcd');
    expect(consultText('ab', 4)).toBe('ab');
  });
});
