import { buildPlanPdfDefinition } from '@/lib/plans/export/toPdf';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';
import { projectPlanExportDocument } from './projectPlanPdf';

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

const allText = (doc: ReturnType<typeof projectPlanExportDocument>) =>
  JSON.stringify(doc.blocks) + doc.subtitle.join(' ') + doc.title;

describe('プロジェクト別の実行計画書（PDF の内容）', () => {
  const input = () => ({
    aiDraft: draft,
    userEdits: {},
    startInfo: { at: '2026-11-11T09:00:00.000Z', version: 4 },
    companyName: '架空株式会社',
    generatedAt: NOW,
  });

  it('タイトル・会社・部門・開始の版を表紙に出し、7つの節を順に並べる', () => {
    const doc = projectPlanExportDocument(input());
    expect(doc.title).toContain('実行計画書');
    expect(doc.subtitle.join(' ')).toContain('架空株式会社');
    expect(doc.subtitle.join(' ')).toContain('版 4');
    const headings = doc.blocks.filter((b) => b.type === 'heading').map((b) => (b.type === 'heading' ? b.runs[0].text : ''));
    expect(headings).toEqual([
      '1. 目的・背景・顧客成果・会社貢献',
      '2. KPI（目標・期限・担当）',
      '3. 実施事項',
      '4. 推進体制・開始前の確認',
      '5. 財務効果・リスク',
      '6. 規制・安全の確認',
      '7. 補足',
    ]);
  });

  it('STAGE4で修正したKPIの目標・期限・担当を、AIの元の値ではなく修正後の値で出す', () => {
    const base = buildDocModel(draft, {});
    const kpi = base.goals.kpis.find((k) => k.targetKey && k.dueKey && k.ownerKey);
    if (!kpi || !kpi.targetKey || !kpi.dueKey || !kpi.ownerKey) throw new Error('fixture needs an editable KPI');
    const edited = projectPlanExportDocument({
      ...input(),
      userEdits: { [kpi.targetKey]: '3社（修正後）', [kpi.dueKey]: '2028-03', [kpi.ownerKey]: '修正後の担当' },
    });
    const table = edited.blocks.find((b) => b.type === 'table' && b.header[0]?.[0]?.text === 'KPI');
    if (!table || table.type !== 'table') throw new Error('KPI table is missing');
    const row = table.rows.find((r) => r[0]?.[0]?.text === kpi.label);
    expect(row?.[1]?.[0]?.text).toBe('3社（修正後）');
    expect(row?.[2]?.[0]?.text).toContain('2028年3月');
    expect(row?.[3]?.[0]?.text).toBe('修正後の担当');
    expect(allText(edited)).not.toContain(kpi.targetKey);
  });

  it('実施事項の表に、開始した計画の実施事項をすべて出す', () => {
    const doc = projectPlanExportDocument(input());
    const table = doc.blocks.find((b) => b.type === 'table' && b.header[1]?.[0]?.text === '実施事項');
    if (!table || table.type !== 'table') throw new Error('action table is missing');
    const base = buildDocModel(draft, {});
    expect(table.rows).toHaveLength(base.actions.length);
    expect(table.rows[0][1][0].text).toBe(base.actions[0].title);
  });

  it('計画データ（草案と修正）を書き換えない', () => {
    const before = JSON.stringify({ draft, edits: { x: 'a' } });
    projectPlanExportDocument({ ...input(), userEdits: { x: 'a' } });
    expect(JSON.stringify({ draft, edits: { x: 'a' } })).toBe(before);
  });

  it('未開始の草案は「未開始（草案）」と表示する', () => {
    const doc = projectPlanExportDocument({ ...input(), startInfo: null });
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
});
