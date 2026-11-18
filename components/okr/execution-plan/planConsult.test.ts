import { ConsultFocusSchema } from '@/lib/consult/consultFocus';
import { SAMPLE_PLANS } from '@/lib/stage4/planView/fixtures';
import type { PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';
import type { InvestmentRowDraft } from '@/lib/stage4/planView/investmentRows';
import { formatYenScaled } from '@/utils/yenScale';
import type { Department, ExecutionHumanInvestment, Stage4Plan } from '@/types/strategy';
import { entryFromDraft, entryFromRecord, type PlanDocEntry } from './planDocEntry';
import { keySavedOf, legacyDeptPlanConsultFocus, planDocumentConsultFocus, type PlanDocumentScreen } from './planConsult';

const BUNDLE = SAMPLE_PLANS[0].bundle as Record<string, unknown>;
const REASON_KEY = buildDocModel(BUNDLE, {}).purpose.reason.key;

const record = (userEdits: Record<string, unknown>): PlanDocRecord => ({
  key: { companyId: 'c', strategyId: 's', projectId: 'p' },
  version: 1,
  aiDraft: BUNDLE,
  userEdits,
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: 'bob',
});

/* 保存済みの版の上で、利用者が項目を書き換えた状態（保存していない） */
const unsavedEdit = (key: string, value: string): PlanDocEntry => {
  const saved = entryFromRecord(record({}));
  return { ...saved, plan: { ...saved.plan, committed: { ...saved.plan.committed, [key]: value } } };
};

function screenOf(entry: PlanDocEntry | null, extra: Partial<PlanDocumentScreen> = {}): PlanDocumentScreen {
  const doc = entry ? buildDocModel(entry.aiDraft, entry.plan.committed) : null;
  return {
    section: '実行計画書',
    departmentName: doc?.department ?? '',
    projectTitle: doc?.projectTitle ?? '',
    doc,
    keySaved: keySavedOf(entry),
    adoption: entry ? { adopted: entry.plan.adopted, started: entry.plan.started, saved: !!entry.stored && entry.stored.adopted === entry.plan.adopted } : null,
    finance: [],
    investments: { saved: [], pending: [], pendingRemovals: 0 },
    draft: null,
    ...extra,
  };
}

const schemaOk = (focus: object) => ConsultFocusSchema.safeParse({ ...focus, pathname: '/okr' }).success;

describe('項目ごとの保存状態', () => {
  it('保存済みの版が無ければ、すべて未保存', () => {
    expect(keySavedOf(entryFromDraft(BUNDLE))('responsible')).toBe(false);
  });

  it('保存済みと同じ項目は保存済み、書き換えた項目だけ未保存', () => {
    const saved = keySavedOf(entryFromRecord(record({ a: 'x' })));
    expect(saved('a')).toBe(true);
    expect(saved('b')).toBe(true);

    const edited = keySavedOf(unsavedEdit('a', 'y'));
    expect(edited('a')).toBe(false);
    expect(edited('b')).toBe(true);
  });
});

describe('実行計画書の相談文脈', () => {
  it('上限内に収め、スキーマに通る（長い文章は切り詰め、未保存として出す）', () => {
    const focus = planDocumentConsultFocus(
      screenOf(unsavedEdit(REASON_KEY, 'あ'.repeat(2000)), { departmentName: '営業部', projectId: 'p-1', projectTitle: '新規顧客開拓' }),
    );
    expect(schemaOk(focus)).toBe(true);
    expect(focus.stage).toBe(4);
    expect(focus.items!.length).toBeLessThanOrEqual(12);
    const reason = focus.items!.find((i) => i.label === '取り組む理由')!;
    expect(reason.value.length).toBeLessThanOrEqual(600);
    expect(reason.saved).toBe(false);
  });

  it('編集中の文章欄は、欄の名前つきの section と draft になる', () => {
    const focus = planDocumentConsultFocus(
      screenOf(entryFromRecord(record({})), { draft: { label: '取り組む理由', text: '途中の文章', saved: false } }),
    );
    expect(focus.section).toBe('実行計画書（「取り組む理由」を修正中）');
    expect(focus.draft).toEqual({ text: '途中の文章', saved: false });
    expect(schemaOk(focus)).toBe(true);
  });

  it('投資は、保存済みと未保存の入力を分けて出す（金額は表示の文字列のまま）', () => {
    const saved = { id: 'i1', name: 'ツール導入', amount: 1200000, spend: { category: 'CAPEX' } } as unknown as ExecutionHumanInvestment;
    const pending: InvestmentRowDraft = {
      key: 'k',
      recordId: 'r',
      name: '研修',
      category: 'OPEX',
      amount: '300000',
      recurrence: '',
      paymentYm: '',
      startYm: '',
      endYm: '',
      amountBasis: '',
      opexRelation: '',
    };
    const focus = planDocumentConsultFocus(screenOf(entryFromRecord(record({})), { investments: { saved: [saved], pending: [pending], pendingRemovals: 1 } }));
    const savedItem = focus.items!.find((i) => i.label === '投資・追加費用（保存済み）')!;
    expect(savedItem.saved).toBe(true);
    expect(savedItem.value).toContain(`ツール導入（設備投資等）${formatYenScaled(1200000)}`);
    const pendingItem = focus.items!.find((i) => i.label === '投資・追加費用（未保存の入力）')!;
    expect(pendingItem.saved).toBe(false);
    expect(pendingItem.value).toBe('研修：300000円／削除予定 1件');
    expect(schemaOk(focus)).toBe(true);
  });
});

describe('旧画面（app/stage4）の相談文脈', () => {
  const plan = {
    departmentId: 'd1',
    status: 'Draft',
    baseline: { projects: [{ title: 'P1', kpiTargets: { 'KPI A': 100 } }] },
    current: { projects: [{ title: 'P1', kpiTargets: { 'KPI A': 120 } }] },
    deptHashAtCreation: 'h',
    updatedAt: '2026-11-10T00:00:00.000Z',
  } as unknown as Stage4Plan;
  const department = { name: '営業部' } as unknown as Department;

  it('未保存の変更があれば、すべての項目を未保存にし、STAGE3からの変更を示す', () => {
    const focus = legacyDeptPlanConsultFocus({ department, plan, unsaved: true });
    expect(focus.departmentName).toBe('営業部');
    expect(focus.items!.every((i) => i.saved === false)).toBe(true);
    expect(focus.items![1].value).toBe('KPI A：120（STAGE3から変更）');
    expect(schemaOk(focus)).toBe(true);
  });

  it('未保存の変更が無ければ、保存済みとして出す', () => {
    const focus = legacyDeptPlanConsultFocus({ department, plan, unsaved: false });
    expect(focus.items!.every((i) => i.saved === true)).toBe(true);
  });
});
