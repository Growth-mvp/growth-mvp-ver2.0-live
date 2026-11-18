/* STAGE4の画面の内容を、CEOチャットの相談文脈（useConsultFocus）の値にする（純粋関数）。
 * 保存状態（saved）は、保存済みの版（stored.base）と画面の値を項目ごとに比べて判定する。
 * 判定できない時は未保存（false）にする。上限は ConsultFocusSchema に合わせて、ここで切り詰める。 */
import { createContext } from 'react';
import type { ConsultFocus } from '@/lib/consult/consultFocus';
import type { DocModel } from '@/lib/stage4/planView/documentModel';
import type { FinanceLine } from '@/lib/stage4/planView/financeBridge';
import type { InvestmentRowDraft } from '@/lib/stage4/planView/investmentRows';
import type { Department, ExecutionHumanInvestment, Stage4Plan } from '@/types/strategy';
import { formatYenScaled } from '@/utils/yenScale';
import type { PlanDocEntry } from './planDocEntry';

export type ConsultFocusValue = Omit<ConsultFocus, 'pathname'>;
type ConsultItem = NonNullable<ConsultFocusValue['items']>[number];

/** 編集中の文章欄の登録内容。fieldKey があれば、その項目の保存状態を計画書の保存と比べて判定する */
export type EditingFieldInfo = { label: string; text: string; fieldKey?: string; saved?: boolean };
export type EditingReporter = (id: string, info: EditingFieldInfo | null) => void;

/** 文章欄の側から、開いている編集中の欄を画面へ知らせる。画面の外（既定）では何もしない */
export const ConsultEditingContext = createContext<EditingReporter>(() => {});

const LIMIT = { section: 80, label: 80, value: 600, draft: 1200, department: 200, title: 300 } as const;
const MAX_ITEMS = 12;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 項目（キー）ごとの保存状態。保存済みの版が無ければ、すべて未保存 */
export function keySavedOf(entry: PlanDocEntry | null): (key: string) => boolean {
  if (!entry?.stored) return () => false;
  const base = entry.stored.base;
  const committed = entry.plan.committed;
  return (key) => (committed[key] ?? null) === (base[key] ?? null);
}

export type FinanceItemView = { label: string; status: FinanceLine['status']; text: string; saved: boolean };

/** 計画書の画面（実行計画書・実行開始の確認・新しいAI案）の、表示中の内容 */
export type PlanDocumentScreen = {
  section: string;
  departmentName: string;
  /** 戦略内の計画ID（保存済みの計画のときだけ）。無ければ省く */
  projectId?: string;
  projectTitle: string;
  /** 画面に出している計画書（表示中の値）。計画書が無ければ null */
  doc: DocModel | null;
  keySaved: (key: string) => boolean;
  adoption: { adopted: boolean; started: boolean; saved: boolean } | null;
  /** 画面に出している財務効果の算定 */
  finance: FinanceItemView[];
  investments: { saved: ExecutionHumanInvestment[]; pending: InvestmentRowDraft[]; pendingRemovals: number };
  /** 編集中の文章欄（開いている欄）。無ければ null */
  draft: { label: string; text: string; saved: boolean } | null;
};

const FINANCE_STATUS_TEXT: Record<FinanceLine['status'], string> = {
  CONFIRMED: 'STAGE6に反映済み',
  AI_ESTIMATE: '参考試算（STAGE6には未反映）',
  NOT_CALCULATED: '未算定',
};

const item = (label: string, value: string, saved: boolean): ConsultItem => ({
  label: clip(label.trim() || '項目', LIMIT.label),
  value: clip(value.trim(), LIMIT.value),
  saved,
});

export function planDocumentConsultFocus(screen: PlanDocumentScreen): ConsultFocusValue {
  const saved = screen.keySaved;
  const doc = screen.doc;
  const items: ConsultItem[] = [];

  if (doc) {
    const responsible = doc.responsible.candidate ? `${doc.responsible.text}（候補。実行開始前に確定します）` : doc.responsible.text;
    items.push(item('実行責任者', responsible, saved(doc.responsible.key)));
  }
  if (screen.adoption) {
    const a = screen.adoption;
    items.push(item('採用・実行の状態', `${a.adopted ? '採用済み' : '未採用'}／${a.started ? '実行開始済み' : '未開始'}`, a.saved));
  }
  if (doc) {
    items.push(item('取り組む理由', doc.purpose.reason.text, saved(doc.purpose.reason.key)));
    for (const kpi of doc.goals.kpis.slice(0, 3)) {
      const keys = [kpi.targetKey, kpi.dueKey, kpi.ownerKey].filter((key): key is string => key !== null);
      const notes = [
        `目標 ${kpi.target}`,
        `期限 ${kpi.due}`,
        `担当 ${kpi.owner}`,
        kpi.statusLabel,
        kpi.stage3Changed ? `STAGE3から変更（${kpi.stage3Reference ?? ''}）` : '',
      ];
      items.push(item(`KPI：${kpi.label}`, notes.filter(Boolean).join('／'), keys.length > 0 && keys.every((key) => saved(key))));
    }
  }
  for (const f of screen.finance.slice(0, 3)) {
    items.push(item(f.label, `${FINANCE_STATUS_TEXT[f.status]}／${f.text}`, f.saved));
  }
  const inv = screen.investments;
  if (inv.saved.length > 0) {
    const text = inv.saved
      .map((r) => {
        const category = r.spend?.category === 'OPEX' ? '人件費・外注費等' : '設備投資等';
        const amount = r.amount === undefined ? '金額未設定' : formatYenScaled(r.amount);
        return `${r.name?.trim() || '（項目名なし）'}（${category}）${amount}`;
      })
      .join('／');
    items.push(item('投資・追加費用（保存済み）', text, true));
  }
  if (inv.pending.length > 0 || inv.pendingRemovals > 0) {
    const rows = inv.pending.map((r) => `${r.name.trim() || '（項目名未入力）'}：${r.amount.trim() ? `${r.amount.trim()}円` : '金額未入力'}`);
    if (inv.pendingRemovals > 0) rows.push(`削除予定 ${inv.pendingRemovals}件`);
    items.push(item('投資・追加費用（未保存の入力）', rows.join('／'), false));
  }
  if (doc) {
    for (const a of doc.actions.slice(0, 2)) {
      const keys = [a.titleKey, a.contentKey, a.ownerKey, a.dueKey];
      items.push(item(`実施事項${a.no}：${a.title}`, `主な内容：${a.content}／担当：${a.owner}／期限：${a.due}`, keys.every((key) => saved(key))));
    }
  }

  const section = screen.draft ? `${screen.section}（「${screen.draft.label}」を修正中）` : screen.section;
  const focus: ConsultFocusValue = { stage: 4, section: clip(section, LIMIT.section) };
  if (screen.departmentName.trim()) focus.departmentName = clip(screen.departmentName.trim(), LIMIT.department);
  if (screen.projectId) focus.projectId = screen.projectId;
  if (screen.projectTitle.trim()) focus.projectTitle = clip(screen.projectTitle.trim(), LIMIT.title);
  if (screen.draft) focus.draft = { text: clip(screen.draft.text, LIMIT.draft), saved: screen.draft.saved };
  if (items.length > 0) focus.items = items.slice(0, MAX_ITEMS);
  return focus;
}

const LEGACY_STATUS_TEXT: Record<Stage4Plan['status'], string> = { Draft: '下書き', Review: 'レビュー中', Approved: '承認済み' };

/** 旧画面（app/stage4）の部門別の計画。保存状態は、ストアに未保存の変更があるかで判定する（あれば全項目を未保存） */
export function legacyDeptPlanConsultFocus(args: { department: Department; plan: Stage4Plan; unsaved: boolean }): ConsultFocusValue {
  const saved = !args.unsaved;
  const before = args.plan.baseline.projects;
  const items: ConsultItem[] = [item('ステータス', LEGACY_STATUS_TEXT[args.plan.status] ?? args.plan.status, saved)];
  for (const p of args.plan.current.projects.slice(0, MAX_ITEMS - 1)) {
    const targets = p.kpiTargets ?? {};
    const changed = JSON.stringify(before.find((b) => b.title === p.title)?.kpiTargets ?? {}) !== JSON.stringify(targets);
    const text = Object.entries(targets)
      .map(([name, v]) => `${name}：${v}`)
      .join('、');
    items.push(item(p.title || '（名称なし）', `${text || 'KPI目標なし'}${changed ? '（STAGE3から変更）' : ''}`, saved));
  }
  const focus: ConsultFocusValue = { stage: 4, section: '部門別の実行計画（旧画面）', items };
  if (args.department.name.trim()) focus.departmentName = clip(args.department.name.trim(), LIMIT.department);
  return focus;
}
