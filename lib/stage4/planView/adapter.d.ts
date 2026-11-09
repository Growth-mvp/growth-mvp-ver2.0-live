/* eslint-disable @typescript-eslint/no-explicit-any -- JS 実装の境界。表示データの形は types.ts の SectionViews で読む */
// lib/stage4/planView/adapter.js の型。表示データの形は adapter.js の toDisplayPlan を正とする。

export type Tone = 'src' | 'hyp' | 'ai' | 'miss' | 'gray' | 'ok' | 'edit' | 'lock';

export type Basis = { label: string; tone: Tone };

export type TaskGate = 'START' | 'LATER';

export type TaskItem = {
  id: string;
  gate: TaskGate;
  required: boolean;
  type: 'DECIDE' | 'CONFIRM' | 'INPUT';
  section: number;
  title: string;
  detail: string;
  done: boolean;
  hold?: boolean;
  aiFixable: 'A' | 'B' | null;
  aiNote: string;
};

export type HandoverCheck = { label: string; ok: boolean };

export type DisplayPlan = {
  caseId: string;
  title: string;
  departmentName: string;
  companyName: string;
  period: { label: string; basisLabel: string; provisional: boolean };
  goalSummary: string;
  firstAction: any;
  // sections の中身は画面ごとに形が違うため、閲覧側で必要な形に絞って読む
  sections: any[];
  tasks: TaskItem[];
  priority: TaskItem[];
  moreRequired: TaskItem[];
  optionalOpen: TaskItem[];
  progress: { startTotal: number; startDone: number };
  adoption: { adoptable: boolean; blockers: string[] };
  start: { startable: boolean; openCount: number; handover: HandoverCheck[] };
  financeTotals: { confirmedCount: number; confirmedTotalYen: number };
  devMemo: Array<{ severity: string; code: string; path: string; message: string; category: string; note: string }>;
  idLabel: Record<string, string>;
};

export const BASIS: Record<string, Basis>;
export const RULES: Array<{ re: RegExp; dest: string; how: string; note: string }>;
export const SECTION_TITLES: string[];
export const MAX_PRIORITY: number;

export function toDisplayPlan(bundle: any, edits?: Record<string, unknown>): DisplayPlan;
export function auditMapping(bundle: any): { entries: Array<{ source: string; path: string; dest: string | null; how: string | null; note: string }>; unmatched: string[] };
export function humanize(text: unknown, idLabel: Record<string, string>): unknown;
export function buildTasks(bundle: any, ev: (key: string, def: unknown) => unknown, edited: (key: string) => boolean): TaskItem[];
export function formatTarget(target: number | null | undefined, unit?: string): string | null;
