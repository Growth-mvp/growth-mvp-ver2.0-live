/* eslint-disable @typescript-eslint/no-explicit-any -- AI出力（JSON）の草案の形を直接たどる境界（regen.ts と同じ扱い） */
// 実行計画書（日本の業務文書の形式）の表示モデル。
// 既存の表示データ（toDisplayPlan の結果）を、読むための文書の構成に組み替える。
// 内部のコード（S1・A1・LEADING など）や状態ラベルは、ここで文章に直すか、外す。

import { toDisplayPlan, buildTasks } from '@/lib/stage4/planView/adapter';
import { isRegulatoryTask } from '@/lib/stage4/planView/model';
import type { FieldView, FinanceEffectView, ProposedKpiView, ProtectedKpiView, RiskView, SectionViews } from '@/lib/stage4/planView/types';
import { listEditableItems, hashValue, type EditRecord } from '@/lib/stage4/planView/regen';
import { KPI_STATE_LABEL } from '@/lib/stage4/planView/kpiLabels';

export type EditValue = string | number | boolean | null;
export type Edits = Record<string, EditValue>;

export type DocKpi = {
  label: string;
  target: string;
  due: string;
  owner: string;
  confirmed: boolean;
  /** 表の印。確定・入力済み（確定の印なし）・提案のいずれか */
  statusLabel: string;
  /** 編集可能なキー（確定KPIは空。STAGE3で変更する） */
  targetKey: string | null;
  dueKey: string | null;
  ownerKey: string | null;
};

export type DocAction = {
  no: number;
  title: string;
  titleKey: string;
  content: string;
  contentKey: string;
  due: string;
  dueKey: string;
  owner: string;
  ownerKey: string;
  /** 成果物。旧い草案には無いので null（その場合は「記載なし」と表示する） */
  deliverable: string | null;
  deliverableKey: string;
  /** 次の工程へ進む判断条件。無ければ null */
  exitCondition: string | null;
  exitKey: string;
  /** 収益化の段階の表示名。無ければ null */
  stage: string | null;
  stageKey: string;
};


/** 開始前の確認の1件。確認結果（done）は利用者が記録する編集で、判定条件そのものは編集しない */
export type CheckItem = { id: string; key: string; title: string; done: boolean };

export type DocModel = {
  projectTitle: string;
  department: string;
  period: string;
  company: string;
  responsible: { text: string; raw: string; key: string; candidate: boolean };
  purpose: {
    reason: { text: string; key: string };
    problem: { text: string; key: string };
    state: { text: string; key: string };
    strategy: { text: string; key: string };
  };
  goals: {
    customerOutcome: { text: string; key: string };
    kpis: DocKpi[];
  };
  actions: DocAction[];
  organization: {
    roles: Array<{ unit: string; unitKey: string; role: string; roleKey: string }>;
    beforeStart: CheckItem[];
    schedule: Array<{ when: string; what: string; who: string }>;
  };
  impact: {
    companyResult: { text: string; key: string };
    financeLines: Array<{ label: string; status: 'CONFIRMED' | 'AI_ESTIMATE' | 'NOT_CALCULATED'; text: string }>;
    risks: Array<{ risk: string; riskKey: string; countermeasure: string; countermeasureKey: string; by: string; byKey: string }>;
    regulatory: CheckItem[];
  };
  supplement: {
    evidence: Array<{ label: string; text: string }>;
    stage3Notes: string[];
  };
  editableCount: number;
};

/** 2027-02 → 2027年2月。未設定は「未定」 */
export function ymJa(ym: string | null | undefined): string {
  if (!ym) return '未定';
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  return `${m[1]}年${Number(m[2])}月`;
}

function periodJa(label: string): string {
  const parts = label.split(' 〜 ');
  return parts.length === 2 ? `${ymJa(parts[0])}〜${ymJa(parts[1])}` : label;
}

const textOf = (f: FieldView): string => (f.value && f.value.trim() ? f.value : '（記載なし）');

/** 財務効果を、一文の説明にする。金額が無いときは「現時点では未算定」と理由を書く（0円にはしない） */
function financeSentence(e: FinanceEffectView): string {
  if (e.notFinancial) {
    const note = e.freeNote ? `${e.freeNote}` : '';
    return `${e.label}：財務効果の算定・分類は要確認です。財務効果として自動計上していません。${note}`;
  }
  if (e.status === 'CONFIRMED' && e.amountDisplay) {
    return `${e.label}：${e.amountDisplay}（${e.amountBasis}）。`;
  }
  if (e.status === 'AI_ESTIMATE' && e.amountDisplay) {
    return `${e.label}：AIによる参考試算では${e.amountDisplay}（${e.amountBasis}・未確認）。`;
  }
  const why = e.reasons.length ? `${e.reasons.join('、')}が確認できていないため、` : '';
  const note = e.freeNote ? `${e.freeNote}` : '';
  return `${e.label}は、${why}現時点では未算定です。${note}`.replace('。。', '。');
}

export function buildDocModel(bundle: any, edits: Edits): DocModel {
  const d = toDisplayPlan(bundle, edits);
  const s = d.sections as unknown as SectionViews;
  const tasks = buildTasks(bundle, (key: string, def: unknown) => (Object.prototype.hasOwnProperty.call(edits, key) ? edits[key] : def), (key: string) => Object.prototype.hasOwnProperty.call(edits, key));

  const s1 = s[0].blocks;
  const resp = s[4].blocks[0].responsible;
  const actions = s[1].blocks[0].items;
  const kpiBlock = s[2].blocks[0];
  const finance = s[3].blocks[0];
  const people = s[4].blocks[0];

  const kpis: DocKpi[] = [
    ...kpiBlock.protected.map((k: ProtectedKpiView) => ({
      label: k.label,
      target: k.target,
      due: k.judge && k.judge.value ? `${ymJa(k.due)}（判定時期：${ymJa(k.judge.value)}）` : k.due ? ymJa(k.due) : '未定（STAGE3で未設定）',
      owner: k.owner && k.owner !== '未設定' ? k.owner : '未定',
      confirmed: k.confirmed,
      statusLabel: k.confirmed ? KPI_STATE_LABEL.confirmed : KPI_STATE_LABEL.unconfirmed,
      targetKey: null,
      dueKey: null,
      ownerKey: null,
    })),
    ...kpiBlock.proposed.map((k: ProposedKpiView) => ({
      label: k.label,
      target: k.target.value === null || k.target.value === undefined ? '未定' : `${k.target.value}${k.target.unit === '%' ? '%' : k.target.unit ? ` ${k.target.unit}` : ''}`,
      due: ymJa(k.due.value),
      owner: k.owner.value ?? '未定',
      confirmed: false,
      statusLabel: KPI_STATE_LABEL.proposed,
      targetKey: k.target.key,
      dueKey: k.due.key,
      ownerKey: k.owner.key,
    })),
  ];

  const actionRows: DocAction[] = actions.map((a: any) => ({
    no: a.order,
    title: a.title.value ?? '（記載なし）',
    titleKey: a.title.key,
    content: a.stateChange ?? '',
    contentKey: `action:${a.order}:content`,
    due: ymJa(a.due.value),
    dueKey: a.due.key,
    owner: a.ownerRole ?? '',
    ownerKey: `action:${a.order}:owner`,
    deliverable: a.deliverable ?? null,
    deliverableKey: `action:${a.order}:deliverable`,
    exitCondition: a.exitCondition ?? null,
    exitKey: `action:${a.order}:exit`,
    stage: a.stage ?? null,
    stageKey: `action:${a.order}:stage`,
  }));

  const toCheck = (t: { id: string; title: string; done?: unknown }): CheckItem => ({
    id: t.id,
    key: `task:${t.id}`,
    title: t.title,
    done: t.done === true,
  });
  const regulatoryChecks = tasks.filter((t) => isRegulatoryTask(t)).map(toCheck);
  const beforeStartChecks = tasks
    .filter((t) => t.gate === 'START' && t.id !== 'owner' && !isRegulatoryTask(t))
    .map(toCheck);

  const risks: DocModel['impact']['risks'] = (people.risks as any[]).map((r: any) => ({
    risk: r.risk,
    riskKey: r.riskKey,
    countermeasure: r.countermeasure.value ?? '',
    countermeasureKey: r.countermeasure.key,
    by: ymJa(r.confirmBy),
    byKey: r.confirmByKey,
  }));

  const evidence = [
    ...s1.flatMap((b: any) => (Array.isArray(b.evidence) ? b.evidence : [])),
    ...actions.flatMap((a: any) => a.evidence ?? []),
  ].map((e: { label: string; text: string }) => ({ label: e.label, text: e.text }));
  const seen = new Set<string>();
  const uniqueEvidence = evidence.filter((e) => {
    const k = `${e.label}|${e.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const editableCount = Object.keys(edits).length;

  return {
    projectTitle: d.title,
    department: d.departmentName,
    period: periodJa(d.period.label),
    company: d.companyName,
    responsible: {
      text: resp.value ?? '未定（開始前に決める）',
      raw: resp.value ?? '',
      key: resp.key,
      candidate: !!resp.value && !resp.edited && resp.basis.label.includes('候補'),
    },
    purpose: {
      reason: { text: textOf(s1[5] as FieldView), key: (s1[5] as FieldView).key },
      problem: { text: textOf(s1[1] as FieldView), key: (s1[1] as FieldView).key },
      state: { text: textOf(s1[0] as FieldView), key: (s1[0] as FieldView).key },
      strategy: { text: textOf(s1[3] as FieldView), key: (s1[3] as FieldView).key },
    },
    goals: {
      customerOutcome: { text: textOf(s1[2] as FieldView), key: (s1[2] as FieldView).key },
      kpis,
    },
    actions: actionRows,
    organization: {
      roles: (people.roles as any[]).map((r: any) => ({ unit: r.unit, unitKey: r.unitKey, role: r.role, roleKey: r.roleKey })),
      beforeStart: beforeStartChecks,
      schedule: actionRows.map((a) => ({ when: a.due, what: a.title, who: a.owner })),
    },
    impact: {
      companyResult: { text: textOf(finance.companyResult), key: finance.companyResult.key },
      financeLines: finance.effects.map((e) => ({ label: e.label, status: e.status, text: financeSentence(e) })),
      risks,
      regulatory: regulatoryChecks,
    },
    supplement: {
      evidence: uniqueEvidence,
      stage3Notes: kpiBlock.stage3Notes.map((n) => n.concern),
    },
    editableCount,
  };
}

/** 修正の記録（再生成時の保護で使う形）。編集の時点の AI 値の指紋を添える */
export function editRecordsFrom(bundle: any, edits: Edits): EditRecord[] {
  const draft = typeof bundle.rawOutput === 'string' ? JSON.parse(bundle.rawOutput) : bundle.plan;
  const items = listEditableItems(draft);
  return Object.entries(edits).map(([itemId, value]) => {
    const item = items.find((i) => i.itemId === itemId);
    return {
      itemId,
      value: value as EditRecord['value'],
      baseHash: hashValue(item ? item.value : null),
    };
  });
}
