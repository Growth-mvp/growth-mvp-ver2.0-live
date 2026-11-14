import { downloadPlanPdf } from '@/lib/plans/export/downloadPlanPdf';
import { normalizeDisplayName, type PlanBlock, type PlanExportDocument, type PlanInline } from '@/lib/plans/export/planExportDocument';
import { buildDocModel, type DocModel, type Edits } from '@/lib/stage4/planView/documentModel';

/* プロジェクト別の実行計画書（PDF）。STAGE4 の保存済み計画と、その時点の利用者の修正を正本として、表示と同じ内容を作る。
 * 計画データは変えない（読み取りのみ）。STAGE4 とSTAGE5のモーダルで同じ関数を使う。 */

export type ProjectPlanPdfInput = {
  aiDraft: Record<string, unknown>;
  userEdits: Edits;
  startInfo?: { at: string; version: number } | null;
  companyName: string;
  generatedAt: string;
};

const dash = (t: string | null | undefined) => (t && t.trim() ? t : '（記載なし）');
const runs = (t: string): PlanInline[] => [{ text: t }];
const labeled = (label: string, value: string): PlanInline[] => [{ text: `${label}：`, bold: true }, { text: value }];
const cell = (t: string): PlanInline[] => runs(t);

const heading = (title: string): PlanBlock => ({ type: 'heading', level: 2, runs: runs(title) });
const paragraph = (r: PlanInline[]): PlanBlock => ({ type: 'paragraph', runs: r });
const note = (t: string): PlanBlock => ({ type: 'note', runs: runs(t) });
const bullets = (lines: string[]): PlanBlock => ({
  type: 'list',
  items: lines.map((t) => ({ level: 0, ordered: false, runs: runs(t) })),
});
const table = (header: string[], rows: string[][]): PlanBlock => ({
  type: 'table',
  align: header.map(() => 'left' as const),
  header: header.map(cell),
  rows: rows.map((r) => r.map(cell)),
});

const dateJa = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ja-JP') : '';
};

function purposeBlocks(doc: DocModel): PlanBlock[] {
  return [
    heading('1. 目的・背景・顧客成果・会社貢献'),
    paragraph(labeled('取り組む理由', dash(doc.purpose.reason.text))),
    paragraph(labeled('解決したい課題（背景）', dash(doc.purpose.problem.text))),
    paragraph(labeled('現状', dash(doc.purpose.state.text))),
    paragraph(labeled('戦略上の位置づけ', dash(doc.purpose.strategy.text))),
    paragraph(labeled('顧客成果', dash(doc.goals.customerOutcome.text))),
    paragraph(labeled('会社への貢献', dash(doc.impact.companyResult.text))),
  ];
}

function kpiBlocks(doc: DocModel): PlanBlock[] {
  const blocks: PlanBlock[] = [
    heading('2. KPI（目標・期限・担当）'),
    paragraph(labeled('実行責任者', dash(doc.responsible.text))),
    table(
      ['KPI', '目標', '期限', '担当', '区分'],
      doc.goals.kpis.map((k) => [k.label, dash(k.target), dash(k.due), dash(k.owner), `${k.statusLabel}${k.stage3Changed ? '（STAGE3から変更）' : ''}`]),
    ),
  ];
  for (const k of doc.goals.kpis) {
    if (k.stage3Reference) blocks.push(note(`${k.label}：${k.stage3Reference}`));
  }
  return blocks;
}

function actionBlocks(doc: DocModel): PlanBlock[] {
  return [
    heading('3. 実施事項'),
    table(
      ['No', '実施事項', '内容', '期限', '担当', '成果物・完了の条件'],
      doc.actions.map((a) => [
        String(a.no),
        dash(a.title),
        dash(a.content),
        dash(a.due),
        dash(a.owner),
        `${dash(a.deliverable)}${a.exitCondition ? `／完了の条件：${a.exitCondition}` : ''}`,
      ]),
    ),
  ];
}

function organizationBlocks(doc: DocModel): PlanBlock[] {
  const blocks: PlanBlock[] = [heading('4. 推進体制・開始前の確認')];
  if (doc.organization.roles.length > 0) {
    blocks.push(table(['担当部門', '役割'], doc.organization.roles.map((r) => [r.unit, r.role])));
  }
  if (doc.organization.beforeStart.length > 0) {
    blocks.push(bullets(doc.organization.beforeStart.map((c) => `${c.title}：${c.done ? '確認済み' : '未確認'}`)));
  }
  if (doc.organization.schedule.length > 0) {
    blocks.push(table(['時期', '内容', '担当'], doc.organization.schedule.map((s) => [s.when, s.what, s.who])));
  }
  return blocks;
}

function impactBlocks(doc: DocModel): PlanBlock[] {
  const blocks: PlanBlock[] = [heading('5. 財務効果・リスク')];
  for (const f of doc.impact.financeLines) blocks.push(paragraph(labeled(f.label, dash(f.text))));
  if (doc.impact.risks.length > 0) {
    blocks.push(table(['リスク', '対策', '担当'], doc.impact.risks.map((r) => [r.risk, r.countermeasure, r.by])));
  }
  return blocks;
}

function regulatoryBlocks(doc: DocModel): PlanBlock[] {
  const items = doc.impact.regulatory;
  return [
    heading('6. 規制・安全の確認'),
    items.length > 0
      ? bullets(items.map((c) => `${c.title}：${c.done ? '確認済み' : '未確認'}`))
      : note('該当する確認事項はありません。'),
  ];
}

function supplementBlocks(doc: DocModel): PlanBlock[] {
  const lines = [
    ...doc.supplement.evidence.map((e) => `${e.label}：${e.text}`),
    ...doc.supplement.stage3Notes,
  ];
  return [heading('7. 補足'), lines.length > 0 ? bullets(lines) : note('補足はありません。')];
}

export function projectPlanExportDocument(input: ProjectPlanPdfInput): PlanExportDocument {
  const doc = buildDocModel(input.aiDraft, input.userEdits);
  const company = normalizeDisplayName(input.companyName) || '企業名未設定';
  const title = `${doc.projectTitle || '実行計画'}：実行計画書`;
  const started = input.startInfo ? `開始：${dateJa(input.startInfo.at)}（版 ${input.startInfo.version}）` : '未開始（草案）';
  return {
    title,
    subtitle: [company, `部門：${dash(doc.department)}`, `期間：${dash(doc.period)}`, started, `作成日：${dateJa(input.generatedAt)}`],
    blocks: [
      ...purposeBlocks(doc),
      ...kpiBlocks(doc),
      ...actionBlocks(doc),
      ...organizationBlocks(doc),
      ...impactBlocks(doc),
      ...regulatoryBlocks(doc),
      ...supplementBlocks(doc),
    ],
  };
}

export async function downloadProjectPlanPdf(input: ProjectPlanPdfInput): Promise<void> {
  const doc = projectPlanExportDocument(input);
  const fileName = `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  await downloadPlanPdf(doc, fileName);
}
