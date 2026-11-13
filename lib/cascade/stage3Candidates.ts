type AnyRecord = Record<string, unknown>;

export const ADOPTABLE_ROLES = ['admin', 'manager'] as const;

export function canAdoptCandidate(role: string | null | undefined): boolean {
  return ADOPTABLE_ROLES.includes(String(role ?? '').toLowerCase() as (typeof ADOPTABLE_ROLES)[number]);
}

/** 名称の表記ゆれだけを正規化する。一致しても同一とは判定せず、重複の注意表示にだけ使う。 */
export function isSimilarTitle(a: string, b: string): boolean {
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const left = key(a);
  return left.length > 0 && left === key(b);
}

const IDENTITY_KEYS = new Set(['id', 'dbOkrId', 'okrId', 'krId', 'dbKrId']);

/** 候補の OKR・KR は新規扱いにする。入れ子も含め、旧 ID を持ち込まない。 */
function stripIdentityDeep(v: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (Array.isArray(v)) return v.map((x) => stripIdentityDeep(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: AnyRecord = {};
    for (const [k, x] of Object.entries(v as AnyRecord)) {
      if (IDENTITY_KEYS.has(k)) continue;
      out[k] = stripIdentityDeep(x, depth + 1);
    }
    return out;
  }
  return v;
}

export function stripOkrIdentity(okrs: unknown): unknown[] {
  if (!Array.isArray(okrs)) return [];
  return okrs.map((raw) => stripIdentityDeep(raw) as unknown);
}

/** 新規プロジェクトとして採用できる項目（許可リスト）。承認・人的投資・スキル計画などは含めない。 */
export const ADOPTABLE_PROJECT_FIELDS = [
  'id',
  'title',
  'hypothesis',
  'reason',
  'description',
  'mainLever',
  'horizon',
  'kind',
  'sourceType',
  'collaborationType',
  'partnerDepartment',
  'generatedBy',
  'generatedSlot',
  'generatedGroup',
  'generatedAt',
  'strategyBasis',
  'strategyBasisIds',
  'citations',
  'valueDriverLinks',
  'okrs',
  'kpis',
] as const;

/** 既存の承認・実績・担当・STAGE4 の情報。本文から持ち込ませない。 */
export const FORBIDDEN_PROJECT_FIELDS = [
  'planStatus',
  'approvedAt',
  'approvedBy',
  'executionHumanInvestments',
  'skillPlans',
  'humanInvestments',
  'skillRequirements',
  'okrsV2',
  'ownerUserId',
  'ownerName',
] as const;

export function validateAdoptableProject(project: AnyRecord): { ok: true } | { ok: false; error: string } {
  for (const key of Object.keys(project)) {
    if ((FORBIDDEN_PROJECT_FIELDS as readonly string[]).includes(key)) return { ok: false, error: 'forbidden_project_field' };
    if (!(ADOPTABLE_PROJECT_FIELDS as readonly string[]).includes(key)) return { ok: false, error: 'unknown_project_field' };
  }
  return { ok: true };
}

export function pickAdoptableProject(project: AnyRecord): AnyRecord {
  const out: AnyRecord = {};
  for (const key of ADOPTABLE_PROJECT_FIELDS) {
    if (project[key] !== undefined) out[key] = project[key];
  }
  return out;
}

export function collectProjectIds(departments: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const dept of departments) {
    const projects = dept && typeof dept === 'object' ? (dept as AnyRecord).projects : undefined;
    if (!Array.isArray(projects)) continue;
    for (const p of projects) {
      const id = p && typeof p === 'object' ? (p as AnyRecord).id : undefined;
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  return ids;
}

/**
 * 採用する候補を、既存のどのIDとも衝突しない新しいプロジェクトにする。
 * IDは採用時に1回だけ発行し、以後は変えない。OKRの旧IDは持ち込まない。
 */
export function prepareAdoptedProject(
  candidate: AnyRecord,
  mintId: () => string,
  takenIds: Set<string>,
): { ok: true; project: AnyRecord } | { ok: false; reason: 'no_unique_id' } {
  let id = '';
  for (let i = 0; i < 5; i++) {
    const next = mintId();
    if (next && !takenIds.has(next)) {
      id = next;
      break;
    }
  }
  if (!id) return { ok: false, reason: 'no_unique_id' };
  const picked = pickAdoptableProject(candidate);
  return {
    ok: true,
    project: { ...picked, id, okrs: stripOkrIdentity(candidate.okrs) },
  };
}

export type CandidateScope = { companyId: string; strategyId: string | null; userId: string };

export function isSameCandidateScope(a: CandidateScope, b: CandidateScope): boolean {
  return a.companyId === b.companyId && a.strategyId === b.strategyId && a.userId === b.userId;
}

export function withoutCandidate(projects: AnyRecord[], candidateId: string, idOf: (p: AnyRecord) => string): AnyRecord[] {
  return projects.filter((p) => idOf(p) !== candidateId);
}

/* ===== 部門戦略の変更案 =====
 * 再生成で従来更新されていた部門の項目。既存の値を自動で上書きせず、利用者が選んだ項目だけ反映する。 */

export const DEPT_PROPOSAL_ITEMS = {
  mission: { label: 'ミッション', keys: ['mission'] },
  missionDescription: { label: '概要・仮説', keys: ['missionDescription'] },
  strategicRole: { label: '中計上の役割', keys: ['strategicRole'] },
  currentPosition: { label: '現在の位置づけ', keys: ['currentPosition'] },
  keyIssues: { label: '主要課題', keys: ['keyIssues'] },
  alignmentRiskPoints: { label: '認識のズレが起きやすいポイント', keys: ['alignmentRiskPoints'] },
  collab: { label: '部門内・部門横断の連携案', keys: ['intraDeptCollab', 'interDeptCollab', 'needsCollab'] },
  reviewSummary: { label: '再考ポイント・部門横断論点', keys: ['reviewSummary'] },
  stopList: { label: '停止事項', keys: ['stopList'] },
  riskNotes: { label: 'リスク注記', keys: ['riskNotes'] },
} as const;

export type DeptProposalItem = keyof typeof DEPT_PROPOSAL_ITEMS;

export const DEPT_PROPOSAL_ITEM_NAMES = Object.keys(DEPT_PROPOSAL_ITEMS) as DeptProposalItem[];

export type DeptProposal = {
  item: DeptProposalItem;
  proposed: AnyRecord;
  base: AnyRecord;
};

const MAX_PROPOSAL_STRING = 5000;
const MAX_PROPOSAL_ITEMS = 50;
const MAX_PROPOSAL_KEYS = 30;
const MAX_PROPOSAL_DEPTH = 4;
const MAX_PROPOSAL_JSON = 60_000;

/** 保存してよい形（文字列・数値・真偽・null・配列・浅いオブジェクト）だけを許す。 */
export function isSafeProposalValue(v: unknown, depth = 0): boolean {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= MAX_PROPOSAL_STRING;
  if (depth >= MAX_PROPOSAL_DEPTH) return false;
  if (Array.isArray(v)) {
    return v.length <= MAX_PROPOSAL_ITEMS && v.every((x) => isSafeProposalValue(x, depth + 1));
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as AnyRecord);
    return (
      entries.length <= MAX_PROPOSAL_KEYS &&
      entries.every(([k, x]) => k.length <= 60 && isSafeProposalValue(x, depth + 1))
    );
  }
  return false;
}

export function isEmptyProposalValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.every(isEmptyProposalValue);
  if (typeof v === 'object') return Object.values(v as AnyRecord).every(isEmptyProposalValue);
  return false;
}

/** 項目に含まれる既存の値（キーごと）。未設定は null に揃える。 */
export function currentItemValues(dept: AnyRecord, item: DeptProposalItem): AnyRecord {
  const out: AnyRecord = {};
  for (const key of DEPT_PROPOSAL_ITEMS[item].keys) out[key] = dept[key] ?? null;
  return out;
}

const comparable = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? null : (v ?? null));

/** 既存値の比較。未設定（undefined・null）と空の文字列は同じとして扱う。 */
export function sameItemValues(a: AnyRecord, b: AnyRecord): boolean {
  return Object.keys(a).every((k) => JSON.stringify(comparable(a[k])) === JSON.stringify(comparable(b[k])));
}

/** 生成結果のうち、空でなく既存と異なる項目だけを変更案にする。既存の値は変えない。 */
export function buildDeptProposals(dept: AnyRecord, generated: AnyRecord): DeptProposal[] {
  const out: DeptProposal[] = [];
  for (const item of DEPT_PROPOSAL_ITEM_NAMES) {
    const proposed: AnyRecord = {};
    for (const key of DEPT_PROPOSAL_ITEMS[item].keys) {
      if (generated[key] !== undefined) proposed[key] = generated[key];
    }
    if (Object.values(proposed).every(isEmptyProposalValue)) continue;
    const base = currentItemValues(dept, item);
    if (sameItemValues(proposed, base)) continue;
    out.push({ item, proposed, base });
  }
  return out;
}

/** 要求の形（項目・キー・値）を検証する。サーバーとクライアントで同じ判定を使う。 */
export function validateProposalRequest(
  item: unknown,
  value: unknown,
  base: unknown,
): { ok: true; item: DeptProposalItem } | { ok: false; error: string } {
  if (typeof item !== 'string' || !(item in DEPT_PROPOSAL_ITEMS)) return { ok: false, error: 'invalid_item' };
  const keys = DEPT_PROPOSAL_ITEMS[item as DeptProposalItem].keys as readonly string[];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid_value' };
  if (!base || typeof base !== 'object' || Array.isArray(base)) return { ok: false, error: 'invalid_base' };
  const valueKeys = Object.keys(value as AnyRecord).sort();
  const baseKeys = Object.keys(base as AnyRecord).sort();
  const expected = [...keys].sort();
  if (valueKeys.join('|') !== expected.join('|')) return { ok: false, error: 'invalid_value' };
  if (baseKeys.join('|') !== expected.join('|')) return { ok: false, error: 'invalid_base' };
  for (const k of keys) {
    if (!isSafeProposalValue((value as AnyRecord)[k])) return { ok: false, error: 'unsafe_value' };
    if (!isSafeProposalValue((base as AnyRecord)[k])) return { ok: false, error: 'unsafe_base' };
  }
  if (JSON.stringify(value).length > MAX_PROPOSAL_JSON) return { ok: false, error: 'value_too_large' };
  if (Object.values(value as AnyRecord).every(isEmptyProposalValue)) return { ok: false, error: 'empty_value' };
  return { ok: true, item: item as DeptProposalItem };
}

function formatProposalPart(v: unknown, depth = 0): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((x) => formatProposalPart(x, depth + 1))
      .filter((s) => s.length > 0)
      .map((s) => `・${s}`)
      .join('\n');
  }
  if (typeof v === 'object' && depth < MAX_PROPOSAL_DEPTH) {
    return Object.entries(v as AnyRecord)
      .map(([k, x]) => {
        const s = formatProposalPart(x, depth + 1);
        return s ? `${k}: ${s}` : '';
      })
      .filter((s) => s.length > 0)
      .join('\n');
  }
  return '';
}

/** 画面に表示する文字列。未設定は空文字。 */
export function displayProposalValue(item: DeptProposalItem, values: AnyRecord): string {
  if (item === 'collab') {
    const intra = formatProposalPart(values.intraDeptCollab);
    const inter = formatProposalPart(values.interDeptCollab);
    return [intra && `部門内:\n${intra}`, inter && `部門横断:\n${inter}`].filter(Boolean).join('\n\n');
  }
  return formatProposalPart(values[DEPT_PROPOSAL_ITEMS[item].keys[0]]);
}
