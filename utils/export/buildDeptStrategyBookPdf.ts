/**
 * 事業・部門戦略書のPDF用データ。
 * - 確定版：確定済みの正式データ（strategy_data.departments）だけから作る。
 * - 作業版：画面に出している作業内容から作る（正式データは読まず、変更もしない）。
 * どちらもAIは呼ばない。内部ID・JSONは含めない。
 */

import { currentItemValues } from '@/lib/cascade/stage3Candidates';
import type { StrategyDocumentProps } from '@/components/stage3/StrategyBookDocument';

type AnyRecord = Record<string, unknown>;

export type DeptBookPdfProject = {
  title: string;
  purpose: string[];
  hypothesis: string[];
  goals: string[];
};

export type DeptBookPdfData = {
  status: 'confirmed' | 'working';
  companyName: string;
  departmentName: string;
  confirmedDate: string;
  mission: string[];
  missionDescription: string[];
  currentPosition: string[];
  strategicRole: string[];
  keyIssues: string[];
  intraCollab: string[];
  interCollab: string[];
  alignmentRiskPoints: string[];
  reviewSummary: string[];
  stopList: string[];
  riskNotes: string[];
  projects: DeptBookPdfProject[];
};

const textLines = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v !== '');
  if (typeof value === 'string') return value.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  return [];
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 確定日（日本時間の年月日）。確定日が無ければ空。 */
export function formatConfirmedDate(confirmedAt: string | undefined): string {
  if (!confirmedAt) return '';
  const date = new Date(confirmedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
}

export function buildDeptStrategyBookPdfData(
  state: { companyName?: unknown; departments?: unknown },
  departmentName: string,
  confirmedAt: string | undefined,
): DeptBookPdfData | null {
  const departments = Array.isArray(state.departments) ? (state.departments as AnyRecord[]) : [];
  const dept = departments.find((d) => d && typeof d === 'object' && d.name === departmentName);
  if (!dept) return null;

  const mission = currentItemValues(dept, 'mission');
  const description = currentItemValues(dept, 'missionDescription');
  const position = currentItemValues(dept, 'currentPosition');
  const role = currentItemValues(dept, 'strategicRole');
  const issues = currentItemValues(dept, 'keyIssues');
  const collab = currentItemValues(dept, 'collab');
  const alignment = currentItemValues(dept, 'alignmentRiskPoints');
  const review = currentItemValues(dept, 'reviewSummary');
  const stop = currentItemValues(dept, 'stopList');
  const risk = currentItemValues(dept, 'riskNotes');

  const projects: DeptBookPdfProject[] = (Array.isArray(dept.projects) ? (dept.projects as AnyRecord[]) : [])
    .filter((p) => p && typeof p === 'object' && text(p.title) !== '')
    .map((p) => {
      const okrs = Array.isArray(p.okrs) ? (p.okrs as AnyRecord[]) : [];
      const keyResults = okrs.flatMap((o) => textLines(o?.keyResults));
      const objective = okrs.map((o) => text(o?.objective)).find((o) => o !== '');
      return {
        title: text(p.title),
        purpose: [...(objective ? [objective] : []), ...textLines(p.reason)],
        hypothesis: textLines(p.hypothesis),
        goals: [...new Set([...keyResults, ...textLines(p.kpis)])],
      };
    });

  return {
    status: 'confirmed',
    companyName: text(state.companyName) || '（会社名未入力）',
    departmentName,
    confirmedDate: formatConfirmedDate(confirmedAt),
    mission: textLines(mission.mission),
    missionDescription: textLines(description.missionDescription),
    currentPosition: textLines(position.currentPosition),
    strategicRole: textLines(role.strategicRole),
    keyIssues: textLines(issues.keyIssues),
    intraCollab: textLines(collab.intraDeptCollab),
    interCollab: textLines(collab.interDeptCollab),
    alignmentRiskPoints: textLines(alignment.alignmentRiskPoints),
    reviewSummary: textLines(review.reviewSummary),
    stopList: textLines(stop.stopList),
    riskNotes: textLines(risk.riskNotes),
    projects,
  };
}

/** 作業版：画面の文書の内容をそのまま使う。未確定の新規候補には、未確定と分かる印を付ける。 */
export function buildDeptWorkingPdfData(doc: StrategyDocumentProps, state: { companyName?: unknown }): DeptBookPdfData {
  const lines = (key: keyof StrategyDocumentProps['texts']) => doc.texts[key] ?? [];
  return {
    status: 'working',
    companyName: text(state.companyName) || '（会社名未入力）',
    departmentName: doc.departmentName,
    confirmedDate: '',
    mission: lines('mission'),
    missionDescription: lines('missionDescription'),
    currentPosition: lines('currentPosition'),
    strategicRole: lines('strategicRole'),
    keyIssues: lines('keyIssues'),
    intraCollab: lines('intraCollab'),
    interCollab: lines('interCollab'),
    alignmentRiskPoints: lines('alignmentRiskPoints'),
    reviewSummary: lines('reviewSummary'),
    stopList: lines('stopList'),
    riskNotes: lines('riskNotes'),
    projects: doc.projects.map((p) => ({
      title: p.removed
        ? `${p.title}（計画から外す予定・確定すると外れます）`
        : p.origin === 'candidate'
          ? `${p.title}（新規候補・未確定）`
          : p.title,
      purpose: [p.objective, p.purpose].filter((v): v is string => !!v),
      hypothesis: p.hypothesis ? [p.hypothesis] : [],
      goals: p.goals,
    })),
  };
}
