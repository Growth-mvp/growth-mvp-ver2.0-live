import { FINANCE_EFFECT_BASIS_LABEL, FINANCE_EFFECT_KIND_LABEL, FINANCE_EFFECT_METHOD_LABEL, type FinanceEffectResult } from '@/lib/financeEffect';
import { downloadPlanPdf } from '@/lib/plans/export/downloadPlanPdf';
import { displayColumnWeights, normalizeDisplayName, type PlanBlock, type PlanExportDocument, type PlanInline } from '@/lib/plans/export/planExportDocument';
import { buildDocModel, ymJa, type DocModel, type Edits } from '@/lib/stage4/planView/documentModel';
import type { ProjectPlanEffect, ProjectPlanFinance, ProjectPlanInvestment } from '@/lib/stage4/plan/projectPlanFinance';
import { formatYenScaled } from '@/utils/yenScale';
import type { FinanceEffectProjectStatus } from '@/utils/stage6/financeEffectPlan';
import type { FinanceEffect, ExecutionHumanInvestment } from '@/types/strategy';

/* プロジェクト別の実行計画書（PDF）。STAGE4 の保存済み計画と、その時点の利用者の修正を正本として、表示と同じ内容を作る。
 * 財務効果・投資額は、施策の保存済みデータを STAGE6 と同じ計算で出す。計画データは変えない（読み取りのみ）。
 * STAGE4とSTAGE5のモーダルで同じ関数を使う。 */

export type ProjectPlanPdfInput = {
  aiDraft: Record<string, unknown>;
  userEdits: Edits;
  startInfo?: { at: string; version: number } | null;
  finance: ProjectPlanFinance;
  companyName: string;
  generatedAt: string;
};

/* 句読点の重なりを一つにする（「。。」「、。」など） */
const tidy = (t: string) => t.replace(/、+。/g, '。').replace(/。{2,}/g, '。');
const dash = (t: string | null | undefined) => (t && t.trim() ? tidy(t) : '（記載なし）');
const runs = (t: string): PlanInline[] => [{ text: tidy(t) }];
const labeled = (label: string, value: string): PlanInline[] => [{ text: `${label}：`, bold: true }, { text: tidy(value) }];
const cell = (t: string): PlanInline[] => runs(t);
const subhead = (t: string): PlanBlock => ({ type: 'paragraph', runs: [{ text: t, bold: true }] });

const heading = (title: string): PlanBlock => ({ type: 'heading', level: 2, runs: runs(title) });
const paragraph = (r: PlanInline[]): PlanBlock => ({ type: 'paragraph', runs: r });
const note = (t: string): PlanBlock => ({ type: 'note', runs: runs(t) });
const bullets = (lines: string[]): PlanBlock => ({
  type: 'list',
  items: lines.map((t) => ({ level: 0, ordered: false, runs: runs(t) })),
});
/* 「未設定」「2026年12月」などの短い語が途中で割れない最小幅 */
const MIN_COLUMN_WEIGHT = 60;
const table = (header: string[], rows: string[][]): PlanBlock => {
  const headerRuns = header.map(cell);
  const rowRuns = rows.map((r) => r.map(cell));
  return {
    type: 'table',
    align: header.map(() => 'left' as const),
    header: headerRuns,
    rows: rowRuns,
    weights: displayColumnWeights({ header: headerRuns, rows: rowRuns }).map((w) => Math.max(w, MIN_COLUMN_WEIGHT)),
  };
};

const checkLine = (c: { title: string; done: boolean }) => `${tidy(c.title).replace(/。$/, '')}：${c.done ? '確認済み' : '未確認'}`;

const dateJa = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ja-JP') : '';
};

function purposeBlocks(doc: DocModel): PlanBlock[] {
  return [
    heading('1. 目的・背景'),
    paragraph(labeled('取り組む理由', dash(doc.purpose.reason.text))),
    paragraph(labeled('現状（解決する顧客の課題）', dash(doc.purpose.problem.text))),
    paragraph(labeled('目指す状態', dash(doc.purpose.state.text))),
    paragraph(labeled('戦略上の位置づけ', dash(doc.purpose.strategy.text))),
  ];
}

function goalBlocks(doc: DocModel): PlanBlock[] {
  return [
    heading('2. 目標・KPI'),
    paragraph(labeled('顧客が得る効果', dash(doc.goals.customerOutcome.text))),
    paragraph(labeled('会社への貢献', dash(doc.impact.companyResult.text))),
    table(
      ['KPI', '目標', '期限', '担当', '区分'],
      doc.goals.kpis.map((k) => [k.label, dash(k.target), dash(k.due), dash(k.owner), k.statusLabel]),
    ),
  ];
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
  const blocks: PlanBlock[] = [heading('4. 推進体制'), paragraph(labeled('実行責任者', dash(doc.responsible.text)))];
  if (doc.organization.roles.length > 0) {
    blocks.push(table(['担当部門', '役割'], doc.organization.roles.map((r) => [r.unit, r.role])));
  }
  if (doc.organization.beforeStart.length > 0) {
    blocks.push(subhead('開始前の確認'));
    blocks.push(bullets(doc.organization.beforeStart.map(checkLine)));
  }
  return blocks;
}

const STAGE6_TEXT: Record<FinanceEffectProjectStatus, (reason: string | null) => string> = {
  REFLECTED: () => 'STAGE6の試算に反映済み',
  DRAFT: () => '未確認のため、STAGE6の正式な試算には未反映',
  HELD: (r) => `保留のため未反映${r ? `：${r}` : ''}`,
  INCOMPLETE: (r) => `未算定のため未反映${r ? `：${r}` : ''}`,
  NOT_FINANCIAL: () => '財務換算しないため、STAGE6の試算には含めない',
  NOT_SET: () => '財務効果は未登録',
};

function amountText({ effect, result }: { effect: FinanceEffect; result: FinanceEffectResult }): string {
  if (result.status === 'INCOMPLETE') return `未算定（${result.missing.join('、')}が未入力）`;
  const value = effect.amountBasis === 'TOTAL' ? result.totalYen : result.annualYen;
  if (value === undefined) return '未算定';
  const unit = effect.amountBasis === 'TOTAL' ? '一回限り（総額）' : '年額';
  const draft = result.status === 'DRAFT' ? '（未確認の入力）' : '';
  return `${formatYenScaled(value)}（${unit}）${draft}`;
}

function operatingText({ effect, result }: { effect: FinanceEffect; result: FinanceEffectResult }): string {
  const value = effect.amountBasis === 'TOTAL' ? result.oneTimeOperatingEffectYen : result.annualOperatingEffectYen;
  if (result.status === 'INCOMPLETE' || value === undefined) {
    return effect.kind === 'REVENUE_UP'
      ? '未算定（営業利益の増分、または原価率・追加販売管理費等が未入力）'
      : '未算定';
  }
  return `${formatYenScaled(value)}（${effect.amountBasis === 'TOTAL' ? '一回限り' : '年額'}）`;
}

function effectBlocks({ effect, result, stage6 }: ProjectPlanEffect): PlanBlock[] {
  const kind = FINANCE_EFFECT_KIND_LABEL[effect.kind];
  const method = effect.method ? FINANCE_EFFECT_METHOD_LABEL[effect.method] : '算定方法未設定';
  const blocks: PlanBlock[] = [subhead(`${kind}（${method}）`)];
  const stage6Text = STAGE6_TEXT[stage6.status](stage6.reason);
  if (effect.kind === 'NOT_FINANCIAL') {
    blocks.push(
      table(
        ['項目', '内容'],
        [
          ['区分', kind],
          ['算定根拠・出所', dash(effect.sourceNote)],
          ['STAGE6への反映', stage6Text],
        ],
      ),
    );
    return blocks;
  }
  const amountLabel = effect.kind === 'REVENUE_UP' ? '売上増加額' : effect.kind === 'COST_REDUCTION' ? '費用削減額' : '追加費用';
  const period = effect.startYm ? `${ymJa(effect.startYm)}〜${effect.endYm ? ymJa(effect.endYm) : '終了未設定'}` : '未設定';
  const rows: string[][] = [
    [amountLabel, amountText({ effect, result })],
    ['営業利益への効果', operatingText({ effect, result })],
  ];
  if (effect.kind === 'REVENUE_UP' && result.annualGrossProfitYen !== undefined) {
    rows.push(['粗利益（参考・営業利益には含めない）', `${formatYenScaled(result.annualGrossProfitYen)}（年額）`]);
  }
  rows.push(
    ['金額の単位', effect.amountBasis ? FINANCE_EFFECT_BASIS_LABEL[effect.amountBasis] : '未設定'],
    ['計上期間', period],
    ['算定根拠', `${dash(effect.sourceNote)}${result.formula ? `（計算式：${result.formula}）` : ''}`],
    ['STAGE6への反映', stage6Text],
  );
  blocks.push(table(['項目', '内容'], rows));
  return blocks;
}

const RELATION_TEXT: Record<NonNullable<NonNullable<ExecutionHumanInvestment['spend']>['opexRelation']>, string> = {
  IN_PLAN: '営業利益に含まれる',
  NOT_IN_PLAN: '営業利益に含まれない',
  SAME_AS_ADD_COST: '追加費用と同一',
  DIFFERENT_FROM_ADD_COST: '追加費用とは別',
};

function investmentStageText({ record, opex }: ProjectPlanInvestment): string {
  if (record.spend?.category !== 'OPEX') return '投資CFに計上（支出年度）';
  switch (opex?.status) {
    case 'DEDUCTED':
      return '営業利益から差し引く（STAGE6）';
    case 'HELD':
      return `保留のため未反映${opex.reason ? `：${opex.reason}` : ''}`;
    case 'NOT_DEDUCTED':
      return '営業利益に含まれるため差し引かない';
    case 'NOT_READY':
      return `未確定のため計画に含めない${opex.reason ? `：${opex.reason}` : ''}`;
    default:
      return '未判定';
  }
}

function investmentRow(item: ProjectPlanInvestment): string[] {
  const { record } = item;
  const spend = record.spend;
  const isOpex = spend?.category === 'OPEX';
  const category = isOpex
    ? `人件費・外注費等（OPEX）・${spend?.opexRelation ? RELATION_TEXT[spend.opexRelation] : '営業利益との関係未回答'}`
    : '設備投資（CAPEX）';
  const basis = spend?.recurrence === 'ONE_TIME' ? '一回限り（総額）' : spend?.amountBasis ? FINANCE_EFFECT_BASIS_LABEL[spend.amountBasis] : '金額の単位未設定';
  const amount = record.amount !== undefined ? `${formatYenScaled(record.amount)}（${basis}）` : '未入力';
  const timing =
    spend?.recurrence === 'ONE_TIME' ? `${ymJa(spend.paymentYm)}に一時支出` : `${ymJa(spend?.startYm)}〜${ymJa(spend?.endYm)}`;
  return [dash(record.name), category, amount, timing, investmentStageText(item)];
}

function financeBlocks(finance: ProjectPlanFinance): PlanBlock[] {
  const blocks: PlanBlock[] = [heading('5. 財務効果・必要投資額')];
  blocks.push(subhead('財務効果'));
  if (finance.effects.length === 0) blocks.push(note('財務効果は登録されていません。'));
  for (const item of finance.effects) blocks.push(...effectBlocks(item));
  blocks.push(subhead('投資・追加費用'));
  blocks.push(
    finance.investments.length > 0
      ? table(['項目', '区分', '金額', '支出時期', 'STAGE6への反映'], finance.investments.map(investmentRow))
      : note('投資・追加費用は登録されていません。'),
  );
  return blocks;
}

function riskBlocks(doc: DocModel): PlanBlock[] {
  const items = doc.impact.regulatory;
  const blocks: PlanBlock[] = [heading('6. リスク・規制・安全')];
  if (doc.impact.risks.length > 0) {
    blocks.push(table(['リスク', '対策', '確認期限'], doc.impact.risks.map((r) => [dash(r.risk), dash(r.countermeasure), r.by])));
  }
  blocks.push(subhead('規制・安全の確認'));
  blocks.push(
    items.length > 0
      ? bullets(items.map(checkLine))
      : note('該当する確認事項はありません。'),
  );
  return blocks;
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
      ...goalBlocks(doc),
      ...actionBlocks(doc),
      ...organizationBlocks(doc),
      ...financeBlocks(input.finance),
      ...riskBlocks(doc),
    ],
  };
}

export async function downloadProjectPlanPdf(input: ProjectPlanPdfInput): Promise<void> {
  const doc = projectPlanExportDocument(input);
  const fileName = `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  await downloadPlanPdf(doc, fileName);
}
