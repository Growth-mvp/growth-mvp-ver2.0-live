// 実行計画書の画面が読む表示データの形（adapter.js の toDisplayPlan が返す sections の形）。

import type { Basis } from './adapter';

export type EvidenceItem = { label: string; text: string };

export type FieldView = {
  key: string;
  label: string;
  value: string | null;
  original: string | null;
  edited: boolean;
  basis: Basis;
  evidence: EvidenceItem[];
  type: string;
  multiline: boolean;
};

export type ObstacleView = FieldView & {
  number: number;
  regulatory: boolean;
  linkedActions: number;
  verifyBy: string;
};

export type ActionView = {
  order: number;
  title: FieldView;
  due: { key: string; value: string | null; original: string | null; edited: boolean; outOfPeriod: boolean };
  ownerRole: string;
  after: string[];
  stateChange: string;
  whyItMatters: string;
  linkedObstacles: string[];
  linkedKpis: string[];
  evidence: EvidenceItem[];
  basis: Basis;
};

export type ProtectedKpiView = {
  key: string;
  label: string;
  /** 利用者が確定した目標か。false は入力済みの値（確定の印なし）で、確定とは表示しない */
  confirmed: boolean;
  kindLabel: string;
  target: string;
  due: string | null;
  judge: { key: string; value: string | null; edited: boolean; candidate: boolean } | null;
  owner: string;
  measurement: string;
};

export type ProposedKpiView = {
  key: string;
  label: string;
  kindLabel: string;
  target: { key: string; value: number | null; unit: string; original: number | null; edited: boolean };
  untargeted: { key: string; value: boolean };
  due: { key: string; value: string | null; original: string | null; edited: boolean };
  owner: { key: string; value: string | null; original: string | null; edited: boolean };
  measurement: string;
  basis: Basis;
};

export type FinanceEffectView = {
  key: string;
  label: string;
  /** 財務効果として扱わない（算定・分類は要確認）項目か */
  notFinancial?: boolean;
  direction: string;
  method: string;
  status: 'CONFIRMED' | 'AI_ESTIMATE' | 'NOT_CALCULATED';
  amountYen: number | null;
  amountDisplay: string | null;
  reasons: string[];
  formula: string | null;
  freeNote: string | null;
  sourceNote: string | null;
  period: string;
  amountBasis: string;
  basedOn: string[];
  inputEdit: { key: string; value: number | null; checkKey: string; checked: boolean; edited: boolean };
  evidence: EvidenceItem[];
  inputs: Array<{ label: string; value: string; basis: Basis }>;
};

export type ResponsibleView = {
  key: string;
  value: string | null;
  original: string | null;
  edited: boolean;
  basis: Basis;
  note: string | null;
  suggestion: string | null;
  candidates: string[];
};

export type RiskView = { risk: string; countermeasure: FieldView; confirmBy: string };

export type SectionViews = [
  { title: string; blocks: [FieldView, FieldView, FieldView, FieldView, FieldView, FieldView, { kind: 'obstacles'; primary: ObstacleView[]; more: ObstacleView[]; total: number }] },
  { title: string; blocks: [{ kind: 'actions'; items: ActionView[] }] },
  { title: string; blocks: [{ kind: 'kpis'; protected: ProtectedKpiView[]; proposed: ProposedKpiView[]; stage3Notes: Array<{ kpiLabel: string; concern: string; evidence: EvidenceItem[] }> }] },
  { title: string; blocks: [{ kind: 'finance'; companyResult: FieldView; effects: FinanceEffectView[]; confirmedTotalYen: number; confirmedCount: number }] },
  { title: string; blocks: [{ kind: 'people'; responsible: ResponsibleView; roles: Array<{ unit: string; role: string; actions: string[] }>; risks: RiskView[]; preconditions: string[]; budget: string }] },
];
