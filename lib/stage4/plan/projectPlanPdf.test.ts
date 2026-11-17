import { buildPlanPdfDefinition } from '@/lib/plans/export/toPdf';
import { computeFinanceEffect } from '@/lib/financeEffect';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';
import type { FinanceEffect } from '@/types/strategy';
import { projectPlanExportDocument, type ProjectPlanPdfInput } from './projectPlanPdf';
import { projectPlanFinanceOf, type ProjectPlanFinance } from './projectPlanFinance';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const RENEWAL = 'fict-proj-renewal';
const NOW = '2026-11-10T00:00:00.000Z';

let draft: Record<string, unknown>;
beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy,
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: RENEWAL,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: NOW,
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  draft = r.bundle;
});

const NO_FINANCE: ProjectPlanFinance = { effects: [], investments: [] };

const allText = (doc: ReturnType<typeof projectPlanExportDocument>) =>
  JSON.stringify(doc.blocks) + doc.subtitle.join(' ') + doc.title;

const tableWithHeader = (doc: ReturnType<typeof projectPlanExportDocument>, first: string) => {
  const table = doc.blocks.find((b) => b.type === 'table' && b.header[0]?.[0]?.text === first);
  if (!table || table.type !== 'table') throw new Error(`table with header ${first} is missing`);
  return table;
};

describe('プロジェクト別の実行計画書（PDF の内容）', () => {
  const input = (over: Partial<ProjectPlanPdfInput> = {}): ProjectPlanPdfInput => ({
    aiDraft: draft,
    userEdits: {},
    startInfo: { at: '2026-11-11T09:00:00.000Z', version: 4 },
    finance: NO_FINANCE,
    companyName: '架空株式会社',
    generatedAt: NOW,
    ...over,
  });

  it('タイトル・会社・部門・開始の版を表紙に出し、6つの章を順に並べる', () => {
    const doc = projectPlanExportDocument(input());
    expect(doc.title).toContain('実行計画書');
    expect(doc.subtitle.join(' ')).toContain('架空株式会社');
    expect(doc.subtitle.join(' ')).toContain('版 4');
    const headings = doc.blocks.filter((b) => b.type === 'heading').map((b) => (b.type === 'heading' ? b.runs[0].text : ''));
    expect(headings).toEqual([
      '1. 目的・背景',
      '2. 目標・KPI',
      '3. 実施事項',
      '4. 推進体制',
      '5. 財務効果・必要投資額',
      '6. リスク・規制・安全',
    ]);
    expect(allText(doc)).not.toContain('補足');
  });

  it('STAGE4で修正したKPIの目標・期限・担当を、AIの元の値ではなく修正後の値で出す', () => {
    const base = buildDocModel(draft, {});
    const kpi = base.goals.kpis.find((k) => k.targetKey && k.dueKey && k.ownerKey);
    if (!kpi || !kpi.targetKey || !kpi.dueKey || !kpi.ownerKey) throw new Error('fixture needs an editable KPI');
    const edited = projectPlanExportDocument(
      input({ userEdits: { [kpi.targetKey]: '3社（修正後）', [kpi.dueKey]: '2028-03', [kpi.ownerKey]: '修正後の担当' } }),
    );
    const table = tableWithHeader(edited, 'KPI');
    const row = table.rows.find((r) => r[0]?.[0]?.text === kpi.label);
    expect(row?.[1]?.[0]?.text).toBe('3社（修正後）');
    expect(row?.[2]?.[0]?.text).toContain('2028年3月');
    expect(row?.[3]?.[0]?.text).toBe('修正後の担当');
    expect(allText(edited)).not.toContain(kpi.targetKey);
  });

  it('KPIのSTAGE3の変更履歴・元データの注記を出さない', () => {
    const text = allText(projectPlanExportDocument(input()));
    expect(text).not.toContain('STAGE3から変更');
    expect(text).not.toContain('STAGE3の値');
  });

  it('実施事項の表に、開始した計画の実施事項をすべて出す', () => {
    const doc = projectPlanExportDocument(input());
    const table = tableWithHeader(doc, 'No');
    const base = buildDocModel(draft, {});
    expect(table.rows).toHaveLength(base.actions.length);
    expect(table.rows[0][1][0].text).toBe(base.actions[0].title);
  });

  it('実施事項と重複するスケジュール表を出さない', () => {
    const doc = projectPlanExportDocument(input());
    const scheduleTable = doc.blocks.find((b) => b.type === 'table' && b.header[0]?.[0]?.text === '時期');
    expect(scheduleTable).toBeUndefined();
  });

  it('リスク表は担当ではなく確認期限を出す', () => {
    const risks = [{ risk: '主要顧客の離脱', countermeasure: '契約更新の前倒し面談', confirmBy: '2027-02', basis: 'PROPOSAL', sourceRefs: [] }];
    const bundle = JSON.parse(JSON.stringify(draft)) as { rawOutput: string; plan: { section5: { risks: unknown[] } } };
    bundle.plan.section5.risks = risks;
    const raw = JSON.parse(bundle.rawOutput) as { section5: { risks: unknown[] } };
    raw.section5.risks = risks;
    bundle.rawOutput = JSON.stringify(raw);
    const doc = projectPlanExportDocument(input({ aiDraft: bundle }));
    const table = tableWithHeader(doc, 'リスク');
    expect(table.header.map((h) => h[0]?.text)).toEqual(['リスク', '対策', '確認期限']);
  });

  it('文末の句点を重ねない', () => {
    expect(allText(projectPlanExportDocument(input()))).not.toMatch(/。。|、。/);
  });

  it('計画データ（草案と修正）を書き換えない', () => {
    const before = JSON.stringify({ draft, edits: { x: 'a' } });
    projectPlanExportDocument(input({ userEdits: { x: 'a' } }));
    expect(JSON.stringify({ draft, edits: { x: 'a' } })).toBe(before);
  });

  it('未開始の草案は「未開始（草案）」と表示する', () => {
    const doc = projectPlanExportDocument(input({ startInfo: null }));
    expect(doc.subtitle.join(' ')).toContain('未開始（草案）');
  });

  it('内部のキーや識別子を文書に出さない', () => {
    const text = allText(projectPlanExportDocument(input()));
    expect(text).not.toMatch(/action:\d+:/);
    expect(text).not.toMatch(/\bkpi:\d+/);
  });

  it('既存の共通のPDF定義に変換できる', () => {
    const def = buildPlanPdfDefinition(projectPlanExportDocument(input()));
    expect(def).toBeTruthy();
  });

  describe('財務効果・投資額', () => {
    const costReduction: FinanceEffect = {
      kind: 'COST_REDUCTION',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 500000,
      amountBasis: 'ANNUAL',
      startYm: '2027-04',
      endYm: '2028-03',
      sourceNote: '保守費の見直し',
      source: 'USER_INPUT',
      confirmed: false,
    };
    const incomplete: FinanceEffect = { kind: 'REVENUE_UP', method: 'FUNNEL', source: 'USER_INPUT', confirmed: false };

    it('保存済みの財務効果は、算定した金額と未確認の印をそのまま出す', () => {
      const finance: ProjectPlanFinance = {
        effects: [{ effect: costReduction, result: computeFinanceEffect(costReduction), stage6: { status: 'DRAFT', reason: null } }],
        investments: [],
      };
      const doc = projectPlanExportDocument(input({ finance }));
      const table = tableWithHeader(doc, '項目');
      const amountRow = table.rows.find((r) => r[0][0].text === '費用削減額');
      expect(amountRow?.[1][0].text).toContain('（年額）');
      expect(amountRow?.[1][0].text).toContain('未確認の入力');
      expect(allText(doc)).toContain('STAGE6の正式な試算には未反映');
    });

    it('未入力の効果は0円ではなく未算定と理由を出す', () => {
      const finance: ProjectPlanFinance = {
        effects: [{ effect: incomplete, result: computeFinanceEffect(incomplete), stage6: { status: 'INCOMPLETE', reason: '入力不足のため未算定' } }],
        investments: [],
      };
      const doc = projectPlanExportDocument(input({ finance }));
      const table = tableWithHeader(doc, '項目');
      const amountRow = table.rows.find((r) => r[0][0].text === '売上増加額');
      expect(amountRow?.[1][0].text).toMatch(/^未算定/);
      expect(allText(doc)).toContain('未算定のため未反映');
    });

    it('投資・追加費用は、CAPEXの計上と、OPEXの営業利益との関係・反映状態を出す', () => {
      const finance: ProjectPlanFinance = {
        effects: [],
        investments: [
          {
            record: {
              id: 'capex-1',
              type: 'OTHER',
              name: '検査装置',
              amount: 3000000,
              spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-09' },
            },
            opex: null,
          },
          {
            record: {
              id: 'opex-1',
              type: 'OTHER',
              name: '外注費',
              amount: 1200000,
              spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-05', opexRelation: 'NOT_IN_PLAN' },
            },
            opex: { status: 'DEDUCTED', reason: null },
          },
        ],
      };
      const doc = projectPlanExportDocument(input({ finance }));
      const table = tableWithHeader(doc, '項目');
      const capexRow = table.rows.find((r) => r[0][0].text === '検査装置');
      expect(capexRow?.[1][0].text).toBe('設備投資（CAPEX）');
      expect(capexRow?.[4][0].text).toBe('投資CFに計上（支出年度）');
      const opexRow = table.rows.find((r) => r[0][0].text === '外注費');
      expect(opexRow?.[1][0].text).toContain('営業利益に含まれない');
      expect(opexRow?.[4][0].text).toBe('営業利益から差し引く（STAGE6）');
    });
  });
});

describe('projectPlanFinanceOf', () => {
  it('会計年度末が未設定なら、財務効果を出さない（未算定を0円にしない）', () => {
    expect(projectPlanFinanceOf({ departments: [], fiscalYearEnd: undefined, projectId: 'p1' })).toBeNull();
  });

  it('施策が見つからない・同じIDが複数あるときは出さない', () => {
    const departments = [
      { id: 'd1', name: 'A', projects: [{ id: 'p1', title: 'x' }] },
      { id: 'd2', name: 'B', projects: [{ id: 'p1', title: 'y' }] },
    ];
    expect(projectPlanFinanceOf({ departments, fiscalYearEnd: '3', projectId: 'p1' })).toBeNull();
    expect(projectPlanFinanceOf({ departments, fiscalYearEnd: '3', projectId: 'none' })).toBeNull();
  });
});
