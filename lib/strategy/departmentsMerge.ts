type AnyRecord = Record<string, any>;

export type DepartmentsConflict = {
  departmentName: string;
  projectId: string | null;
  title: string;
};

export type DepartmentsMergeOutcome =
  | { ok: true; departments: AnyRecord[] }
  | { ok: false; conflicts: DepartmentsConflict[] };

/* DB の jsonb はキーの並びを変えて返すため、並びに依存しない形で比べる。 */
const stableJson = (v: unknown): string => {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',') + '}';
  }
  return JSON.stringify(v);
};
export const sameJson = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const same = sameJson;
const deptKey = (d: AnyRecord) => String(d?.name ?? '');
const projKey = (p: AnyRecord) => String(p?.id ?? `title:${p?.title ?? ''}`);
const projectsOf = (d: AnyRecord): AnyRecord[] => (Array.isArray(d?.projects) ? d.projects : []);

function withoutProjects(d: AnyRecord): AnyRecord {
  const { projects: _projects, ...rest } = d;
  return rest;
}

/**
 * 基準（最後に同期した版）・ローカル（利用者の未保存の編集を含む）・サーバー（他の利用者の変更を含む最新）を3方向で合わせる。
 * 片方だけが変えた項目は、変えた側を採用する。両方が違う内容に変えた項目は自動で選ばず、競合として返す。
 * 他の利用者が追加したプロジェクト・OKR・部門は残す。古いローカルの値で他人の変更を消さない。
 */
export function mergeDepartmentsForConflict(input: {
  base: AnyRecord[];
  local: AnyRecord[];
  server: AnyRecord[];
}): DepartmentsMergeOutcome {
  const { base, local, server } = input;
  const baseMap = new Map(base.map((d) => [deptKey(d), d]));
  const localMap = new Map(local.map((d) => [deptKey(d), d]));
  const conflicts: DepartmentsConflict[] = [];
  const out: AnyRecord[] = [];
  const seen = new Set<string>();

  for (const sd of server) {
    const key = deptKey(sd);
    seen.add(key);
    const bd = baseMap.get(key);
    const ld = localMap.get(key);

    if (!bd && !ld) {
      out.push(sd);
      continue;
    }
    if (!bd && ld) {
      if (same(ld, sd)) out.push(sd);
      else conflicts.push({ departmentName: key, projectId: null, title: '部門' });
      continue;
    }
    if (bd && !ld) {
      if (same(bd, sd)) continue;
      conflicts.push({ departmentName: key, projectId: null, title: '部門（削除と更新が重なりました）' });
      continue;
    }

    const merged = mergeDepartment(key, bd as AnyRecord, ld as AnyRecord, sd, conflicts);
    out.push(merged);
  }

  for (const ld of local) {
    const key = deptKey(ld);
    if (seen.has(key)) continue;
    if (!baseMap.has(key)) {
      out.push(ld);
      continue;
    }
    const bd = baseMap.get(key) as AnyRecord;
    if (!same(bd, ld)) conflicts.push({ departmentName: key, projectId: null, title: '部門（他の利用者が削除しました）' });
  }

  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, departments: out };
}

function mergeDepartment(
  name: string,
  bd: AnyRecord,
  ld: AnyRecord,
  sd: AnyRecord,
  conflicts: DepartmentsConflict[],
): AnyRecord {
  const merged: AnyRecord = {};
  const fieldKeys = new Set([...Object.keys(bd), ...Object.keys(ld), ...Object.keys(sd)]);
  fieldKeys.delete('projects');
  for (const k of fieldKeys) {
    const b = bd[k];
    const l = ld[k];
    const s = sd[k];
    let chosen: unknown;
    if (same(l, b)) chosen = s;
    else if (same(s, b) || same(l, s)) chosen = l;
    else {
      conflicts.push({ departmentName: name, projectId: null, title: k });
      continue;
    }
    if (chosen !== undefined) merged[k] = chosen;
  }
  merged.projects = mergeProjects(name, projectsOf(bd), projectsOf(ld), projectsOf(sd), conflicts);
  return merged;
}

function mergeProjects(
  name: string,
  bp: AnyRecord[],
  lp: AnyRecord[],
  sp: AnyRecord[],
  conflicts: DepartmentsConflict[],
): AnyRecord[] {
  const bMap = new Map(bp.map((p) => [projKey(p), p]));
  const lMap = new Map(lp.map((p) => [projKey(p), p]));
  const sMap = new Map(sp.map((p) => [projKey(p), p]));
  const out: AnyRecord[] = [];

  for (const s of sp) {
    const k = projKey(s);
    const b = bMap.get(k);
    const l = lMap.get(k);
    if (!b) {
      if (l && !same(l, s)) conflicts.push({ departmentName: name, projectId: k, title: String(s.title ?? k) });
      else out.push(s);
      continue;
    }
    if (!l) {
      if (same(b, s)) continue;
      conflicts.push({ departmentName: name, projectId: k, title: String(s.title ?? k) });
      continue;
    }
    const localChanged = !same(l, b);
    const serverChanged = !same(s, b);
    if (!localChanged) out.push(s);
    else if (!serverChanged || same(l, s)) out.push(l);
    else conflicts.push({ departmentName: name, projectId: k, title: String(s.title ?? k) });
  }

  for (const l of lp) {
    const k = projKey(l);
    if (sMap.has(k)) continue;
    const b = bMap.get(k);
    if (!b) {
      out.push(l);
      continue;
    }
    if (!same(b, l)) conflicts.push({ departmentName: name, projectId: k, title: String(l.title ?? k) });
  }

  return out;
}

/**
 * 保存の結果の revision が進んだかを判定する。
 * 進まない場合は、revision による競合検知が効いていないおそれがある（トリガー未設定など）。
 */
export function assessRevisionAdvance(input: {
  before: number | undefined;
  after: number | undefined;
}): 'advanced' | 'not_advanced' | 'unknown' {
  if (typeof input.before !== 'number' || typeof input.after !== 'number') return 'unknown';
  return input.after > input.before ? 'advanced' : 'not_advanced';
}
