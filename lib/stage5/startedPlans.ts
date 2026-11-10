/* STAGE5 から、実行開始済みの実行計画書を読み取り専用で表示するための変換。
 * 書き込みはしない。STAGE3の確定KPIと、計画書の提案KPI（未確定）は区別して表す。
 * 未確認の財務効果は、STAGE5には出さない（確定値として扱わない）。 */
import { buildDocModel, type Edits } from '@/lib/stage4/planView/documentModel';
import type { LoadOutcome, PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';

export type StartedPlanKpi = { label: string; target: string; due: string; owner: string; confirmed: boolean; statusLabel: string };
export type StartedPlanAction = {
  no: number;
  title: string;
  content: string;
  due: string;
  owner: string;
  deliverable: string | null;
  exitCondition: string | null;
};

export type StartedPlanView = {
  key: PlanDocKey;
  departmentName: string;
  projectTitle: string;
  startedAt: string;
  startedVersion: number;
  purpose: Array<{ label: string; text: string }>;
  responsible: string;
  kpis: StartedPlanKpi[];
  actions: StartedPlanAction[];
};

const sameKey = (a: PlanDocKey, b: PlanDocKey) => a.companyId === b.companyId && a.strategyId === b.strategyId && a.projectId === b.projectId;

/** 実行開始済み（現在の内容に対して開始されている）計画書だけを、画面の形に変える。該当しなければ null */
export function startedPlanView(args: {
  expected: PlanDocKey;
  departmentName: string;
  projectTitle: string;
  record: PlanDocRecord;
}): StartedPlanView | null {
  const { record } = args;
  if (!record.startInfo || record.status !== 'DRAFT') return null;
  if (!sameKey(record.key, args.expected)) return null;

  const doc = buildDocModel(record.aiDraft, record.userEdits as Edits);
  return {
    key: args.expected,
    departmentName: args.departmentName,
    projectTitle: args.projectTitle,
    startedAt: record.startInfo.at,
    startedVersion: record.startInfo.version,
    purpose: [
      { label: '取り組む理由', text: doc.purpose.reason.text },
      { label: '解決したい課題', text: doc.purpose.problem.text },
      { label: '現状', text: doc.purpose.state.text },
      { label: '戦略上の位置づけ', text: doc.purpose.strategy.text },
    ],
    responsible: doc.responsible.text,
    kpis: doc.goals.kpis.map((k) => ({
      label: k.label,
      target: k.target,
      due: k.due,
      owner: k.owner,
      confirmed: k.confirmed,
      statusLabel: k.statusLabel,
    })),
    actions: doc.actions.map((a) => ({
      no: a.no,
      title: a.title,
      content: a.content,
      due: a.due,
      owner: a.owner,
      deliverable: a.deliverable ?? null,
      exitCondition: a.exitCondition ?? null,
    })),
  };
}

export type StartedPlanItem = { key: PlanDocKey; departmentName: string; projectTitle: string };
export type StartedPlansLoad = { views: StartedPlanView[]; failed: number; disabled: boolean; unavailable?: string };

/* 1件ずつ読み、公開前（API無効）と分かったら残りを読まない（無効な間は要求を1回で止める） */
export async function loadStartedPlans(args: {
  items: StartedPlanItem[];
  load: (key: PlanDocKey) => Promise<LoadOutcome>;
}): Promise<StartedPlansLoad> {
  const views: StartedPlanView[] = [];
  let failed = 0;
  for (const item of args.items) {
    let out: LoadOutcome;
    try {
      out = await args.load(item.key);
    } catch {
      failed += 1;
      continue;
    }
    if (out.status === 'DISABLED') return { views: [], failed: 0, disabled: true };
    if (out.status === 'UNAVAILABLE') return { views: [], failed: 0, disabled: false, unavailable: out.message };
    if (out.status === 'FAILED') {
      failed += 1;
      continue;
    }
    if (out.status !== 'FOUND') continue;
    const view = startedPlanView({ expected: item.key, departmentName: item.departmentName, projectTitle: item.projectTitle, record: out.record });
    if (view) views.push(view);
  }
  return { views, failed, disabled: false };
}
