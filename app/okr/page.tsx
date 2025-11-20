// /app/okr/page.tsx
'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { KRStructured, KRKind } from '@/types/strategy';

/* ============================================================
 * 軽量ツールチップ（依存を増やさず同ファイルで実装）
 * ============================================================ */
function Tooltip({
  text,
  children,
  side = 'top',
}: {
  text: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const pos =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : side === 'bottom'
      ? 'top-full left-1/2 -translate-x-1/2 mt-2'
      : side === 'left'
      ? 'right-full top-1/2 -translate-y-1/2 mr-2'
      : 'left-full top-1/2 -translate-y-1/2 ml-2';

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute z-[60] max-w=[280px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] leading-5 text-zinc-800 shadow ${pos}`}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * ローカル型（store 依存を緩く）
 * ============================================================ */
type KR = string;
type OKR = {
  objective: string;
  keyResults: KR[];
  owner?: string;
  due?: string;
  status?: string;
};

type Project = {
  title?: string;
  name?: string;
  okrs?: OKR[];
  okrsV2?: KRStructured[];
  role?: 'revenue' | 'cost' | 'future' | 'global'; // プロジェクトのロール
};

type Department = {
  name?: string;
  projects?: Project[];
  strategy?: string;
  mission?: string;
};

/* ============================================================
 * KRStructured 拡張型（10/19合意の追加フィールド）
 * ============================================================ */
type KRStructuredX = KRStructured & {
  weight?: number;
  elasticity?: number;
  lagMonths?: number;
  startYm?: string;
  notes?: string;
  overrideMode?: 'APPORTION' | 'OVERRIDE';
  baseOverride?: number;
};

/* ============================================================
 * ID生成 & KRStructured生成
 * ============================================================ */
const genId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `kr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

function mkKRStructured(
  p: Omit<KRStructuredX, 'id'> &
    Partial<
      Pick<
        KRStructuredX,
        | 'id'
        | 'owner'
        | 'due'
        | 'weight'
        | 'elasticity'
        | 'lagMonths'
        | 'startYm'
        | 'notes'
        | 'overrideMode'
        | 'baseOverride'
      >
    >,
): KRStructuredX {
  return {
    id: p.id ?? genId(),
    kind: p.kind,
    label: p.label,
    target: p.target,
    unit: p.unit,
    scope: p.scope,
    baseKey: p.baseKey,
    owner: p.owner,
    due: p.due,
    // 拡張（optional）
    weight: p.weight ?? 1,
    elasticity: p.elasticity,
    lagMonths: p.lagMonths ?? 0,
    startYm: p.startYm,
    notes: p.notes,
    overrideMode: p.overrideMode ?? 'APPORTION',
    baseOverride: p.baseOverride,
  };
}

/* 既存データの後追い補修：okrsV2 の id 不足を補完 */
function ensureKrIds(departments: Department[]): Department[] {
  let touched = false;
  const patched = departments.map((d) => {
    const projs = Array.isArray(d.projects)
      ? d.projects.map((p) => {
          const list = Array.isArray(p.okrsV2)
            ? p.okrsV2.map((k) => {
                const kk = k as KRStructuredX;
                if (!kk?.id) {
                  touched = true;
                  return mkKRStructured({ ...kk });
                }
                return kk;
              })
            : p.okrsV2;
          return { ...p, okrsV2: list };
        })
      : d.projects;
    return { ...d, projects: projs };
  });
  return touched ? patched : departments;
}

/* ============================================================
 * ユーティリティ
 * ============================================================ */
function makeSaveSnapshot(s: any) {
  const snap: any = {
    strategyId: s?.strategyId ?? undefined,
    story: Array.isArray(s?.story) ? s.story : [],
    finalStory: Array.isArray(s?.finalStory) ? s.finalStory : [],
    answers2: Array.isArray(s?.answers2) ? s.answers2 : [],
    departments: Array.isArray(s?.departments) ? s.departments : [],
    companyName: s?.companyName,
    mission: s?.mission,
    vision: s?.vision,
    value: s?.value,
    thought: s?.thought,
  };
  if (Array.isArray(s?.csvFinanceData)) snap.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s?.financeSummary)) snap.financeSummary = s.financeSummary;
  if (typeof s?.businessPortfolio !== 'undefined')
    snap.businessPortfolio = s.businessPortfolio;
  if (typeof s?.simulationResult !== 'undefined')
    snap.simulationResult = s.simulationResult;
  return snap;
}

function hashSnapshot(obj: any) {
  const s = JSON.stringify(obj ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

const ensureArray = <T,>(v: T[] | undefined): T[] =>
  Array.isArray(v) ? v : [];

/* ---------- カスケードOKR → 構造化KR たたき台 用ヘルパー ---------- */

// 単位の推定
function guessUnit(text: string): '%' | '¥' | '件' | '人' | '比率' {
  if (/[％%]/.test(text)) return '%';
  if (/円|¥/.test(text)) return '¥';
  if (/人/.test(text)) return '人';
  if (/件|社|口座|契約/.test(text)) return '件';
  if (/率|比率/.test(text)) return '比率';
  return '件';
}

// Draft 型は後ろで定義（TS 的には参照OK）
type DraftBaseKey =
  | 'acq'
  | 'arpu'
  | 'churn'
  | 'fixed_cost'
  | 'variable_cost'
  | 'personnel_cost'
  | 'invest'
  | 'success_rate'
  | 'synergy'
  | 'revenue';

// 種類(kind)と baseKey の簡易推定
function guessKindAndBase(
  text: string,
): { kind: KRKind; baseKey: DraftBaseKey } {
  const t = text.toLowerCase();

  if (/新規|獲得|リード|来店|登録/.test(text))
    return { kind: 'ACQ', baseKey: 'acq' };
  if (/単価|客単価|arpu/.test(text))
    return { kind: 'ARPU', baseKey: 'arpu' };
  if (/解約|離脱|チャーン/.test(text))
    return { kind: 'CHURN', baseKey: 'churn' };
  if (/固定費|家賃|減価/.test(text))
    return { kind: 'COST_FIXED', baseKey: 'fixed_cost' };
  if (/変動費|原価/.test(text))
    return { kind: 'COST_VARIABLE', baseKey: 'variable_cost' };
  if (/人件費|採用|給与|賞与|人員/.test(text))
    return { kind: 'PERSONNEL', baseKey: 'personnel_cost' };
  if (/投資|開発|新規事業|r&d|研究開発/i.test(t))
    return { kind: 'INVEST', baseKey: 'invest' };
  if (/成功率|成約率|勝率|転換率/.test(text))
    return { kind: 'SUCCESS_RATE', baseKey: 'success_rate' };
  if (/シナジー|連携|横串|コラボ/.test(text))
    return { kind: 'SYNERGY', baseKey: 'synergy' };
  if (/売上|収益|利益|arr|mrr/i.test(t))
    return { kind: 'REVENUE', baseKey: 'revenue' };

  // デフォルトは「新規獲得」
  return { kind: 'ACQ', baseKey: 'acq' };
}

// テキスト1本から構造化KRを組み立てる
function buildKRFromText(text: string, ownerHint?: string): KRStructuredX {
  // 目標値（最初に出てくる数値）を取得
  const numMatch = text.match(/-?\d+(\.\d+)?/);
  const target = numMatch ? Number(numMatch[0]) : 0;

  const unit = guessUnit(text);
  const { kind, baseKey } = guessKindAndBase(text);

  return mkKRStructured({
    kind,
    label: text.trim(),
    target,
    unit,
    scope: 'project',
    baseKey,
    owner: ownerHint,
    weight: 1,
    elasticity: undefined,
    lagMonths: 0,
    startYm: undefined,
    notes: undefined,
    overrideMode: 'APPORTION',
    baseOverride: undefined,
  });
}

/* ============================================================
 * 保存ステータス・ドック（日本語UI）
 * ============================================================ */
function SaveDock() {
  const { user } = useUserStore();
  const state = useStrategyStore() as any;
  const departments = state?.departments ?? [];

  const [hydratedUI, setHydratedUI] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [formattedSavedAt, setFormattedSavedAt] = useState('');
  const [error, setError] = useState('');
  const savedHashRef = useRef<string>('');

  useEffect(() => setHydratedUI(true), []);
  const currentHash = useMemo(() => JSON.stringify(departments), [departments]);

  useEffect(() => {
    if (!savedHashRef.current) savedHashRef.current = currentHash;
    setDirty(savedHashRef.current !== currentHash);
  }, [currentHash]);

  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : null);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!lastSavedAt) return setFormattedSavedAt('');
    const fmt = new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Tokyo',
    }).format(lastSavedAt);
    setFormattedSavedAt(fmt);
  }, [lastSavedAt]);

  const saveNow = useCallback(async () => {
    if (!user?.id) return;
    setSaving(true);
    setError('');
    try {
      // ★ 念のため dirty を強制的に true にしてから保存
      useStrategyStore.setState((st: any) => ({
        ...st,
        dirty: true,
      }));

      await useStrategyStore.getState().saveStrategyData();
      savedHashRef.current = JSON.stringify(
        (useStrategyStore.getState() as any).departments ?? [],
      );
      setLastSavedAt(Date.now());
      setDirty(false);
    } catch (e: any) {
      setError('保存に失敗しました。少し時間をおいて再度お試しください。');
      console.warn('SaveDock error:', e);
    } finally {
      setSaving(false);
    }
  }, [user?.id]);

  if (!hydratedUI)
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <div className="rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow">
          <span className="text-xs text-zinc-600">状態を確認しています…</span>
        </div>
      </div>
    );

  const canSave = !saving && online && dirty && !!user?.id;

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow">
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            online
              ? 'bg-emerald-500'
              : online === false
              ? 'bg-amber-500'
              : 'bg-zinc-300'
          }`}
        />
        <span className="text-xs text-zinc-800">
          {saving
            ? '保存中…'
            : dirty
            ? '未保存の変更があります'
            : `保存済み ${formattedSavedAt || ''}`}
        </span>
        <button
          onClick={saveNow}
          disabled={!canSave}
          className={`ml-2 h-7 rounded-full px-3 text-xs font-semibold ${
            canSave
              ? 'bg-black text-white'
              : 'cursor-not-allowed bg-zinc-200 text-zinc-500'
          }`}
        >
          今すぐ保存
        </button>
      </div>
      {error && (
        <div className="mt-1 text-[11px] text-rose-600">{error}</div>
      )}
    </div>
  );
}

/* ============================================================
 * メインコンポーネント
 * ============================================================ */
const ROLE_OPTIONS: Array<{ value: Project['role']; label: string }> = [
  { value: 'revenue', label: 'ロール：収益（売上を伸ばす）' },
  { value: 'cost', label: 'ロール：コスト（費用を抑える）' },
  { value: 'future', label: 'ロール：未来（投資・成功確率）' },
  { value: 'global', label: 'ロール：全社連携（シナジー）' },
];

type Draft = {
  kind: KRKind;
  label: string;
  target: string; // 入力は文字列、保存時に数値化
  unit: '%' | '¥' | '件' | '人' | '比率';
  scope: 'company' | 'department' | 'project';
  baseKey: DraftBaseKey;
  owner?: string;
  due?: string;

  // 拡張（活動→指標の変換・配分・時間軸）
  weight?: string; // number文字列
  elasticity?: string; // number文字列
  lagMonths?: string; // number文字列
  startYm?: string; // YYYY-MM
  notes?: string;
  overrideMode?: 'APPORTION' | 'OVERRIDE';
  baseOverride?: string; // number文字列
};

export default function OKRPage() {
  const s = useStrategyStore() as any;
  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
    setHydrated,
    refetchFromServer,
    boot,
    lastServerSnapshot,
  } = useStrategyStore();

  const departments = useStrategyStore(
    (st) =>
      ((st.departments as Department[] | undefined) ?? []) as Department[],
  );

  const access = useAccess();
  const accessCompanyId: string | undefined = useMemo(
    () =>
      ((access as any)?.companyId ??
        (s?.companyId as string | undefined)) as string | undefined,
    [(access as any)?.companyId, s?.companyId],
  );

  /* -------- 会社スコープ確立（cascade と同じパターン） -------- */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (
      lastAppliedCompanyRef.current === accessCompanyId &&
      scopeCompanyId === accessCompanyId
    )
      return;

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
    } else if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  /* -------- 初期ロード（Dirty 回避付き） -------- */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (
      loadGuardRef.current === accessCompanyId &&
      hydrated &&
      scopeCompanyId === accessCompanyId
    )
      return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      const currentSnap = makeSaveSnapshot(useStrategyStore.getState());
      const currentHash = hashSnapshot(currentSnap);
      const isDirty = !!(
        lastServerSnapshot && lastServerSnapshot !== currentHash
      );

      const timer = setTimeout(() => {
        if (!cancelled) setHydrated?.(true);
      }, 7000);

      try {
        if (!isDirty) {
          await loadAndHydrate(accessCompanyId);
          try {
            await refetchFromServer?.();
          } catch {
            // ignore
          }
          setHydrated?.(true);
        } else {
          // ローカル変更優先：hydrate フラグだけ立てる
          setHydrated?.(true);
        }
        loadGuardRef.current = accessCompanyId;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    accessCompanyId,
    hydrated,
    scopeCompanyId,
    refetchFromServer,
    setHydrated,
    lastServerSnapshot,
    setCompanyScope,
  ]);

  /* -------- 自動保存：cascade と同じ条件でガード -------- */
  const mismatch = !!(
    accessCompanyId &&
    scopeCompanyId &&
    scopeCompanyId !== accessCompanyId
  );
  const isHydrating =
    ((Boolean(boot?.isHydrating) && !hydrated) || mismatch || !hydrated) ??
    false;

  useAutoSave(!isHydrating ? [accessCompanyId, departments] : []);

  /* -------- 表示/編集ユーティリティ -------- */
  const cascade: Department[] = useMemo(
    () => (Array.isArray(departments) ? departments : []),
    [departments],
  );

  /* -------- 🔧 “安全更新” ヘルパー：常に setState 経由 + dirty=true -------- */
  const patchDepartments = useCallback(
    (mutator: (draft: Department[]) => Department[]) => {
      useStrategyStore.setState((st: any) => {
        const current: Department[] = Array.isArray(st.departments)
          ? (st.departments as Department[])
          : [];
        const next = mutator(current);
        if (next === current) return st;
        // ★ 部門配下を更新したら常に dirty=true にする
        return {
          ...st,
          departments: next,
          dirty: true,
        };
      });
    },
    [],
  );

  /* -------- 初期補修：okrsV2 の id を一括補完 -------- */
  useEffect(() => {
    if (!Array.isArray(departments) || departments.length === 0) return;
    const patched = ensureKrIds(departments as Department[]);
    if (patched !== departments) {
      patchDepartments(() => patched);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments?.length]);

  /* -------- ★ 初回自動：カスケードOKR → 構造化KR へ一括変換 --------
   * - okrs がある
   * - まだ okrsV2 が未設定 or 足りない
   * プロジェクトだけ、自動で buildKRFromText して埋める
   * （同じ label は二重登録しない）
   * ------------------------------------------------------- */
  useEffect(() => {
    if (!Array.isArray(cascade) || cascade.length === 0) return;

    patchDepartments((prev) => {
      const next = [...prev];
      let anyChanged = false;

      next.forEach((d, di) => {
        const projList = ensureArray(d.projects);
        let deptChanged = false;

        const newProjs = projList.map((p) => {
          const okrs = ensureArray(p.okrs as OKR[] | undefined);
          if (!okrs.length) return p;

          const existing: KRStructuredX[] = Array.isArray(p.okrsV2)
            ? [...(p.okrsV2 as KRStructuredX[])]
            : [];

          let projChanged = false;

          okrs.forEach((o) => {
            const ownerHint = o.owner;
            const krs = ensureArray(o.keyResults as string[] | undefined);

            krs.forEach((krText) => {
              const label = (krText ?? '').trim();
              if (!label) return;

              const already = existing.some(
                (x) => x.label?.trim() === label,
              );
              if (already) return;

              const kr = buildKRFromText(label, ownerHint);
              existing.push(kr);
              projChanged = true;
            });
          });

          if (projChanged) {
            deptChanged = true;
            return { ...p, okrsV2: existing };
          }
          return p;
        });

        if (deptChanged) {
          anyChanged = true;
          next[di] = { ...d, projects: newProjs };
        }
      });

      return anyChanged ? next : prev;
    });
  }, [cascade, patchDepartments]);

  /* ============================================================
   * 🔧 ロールの“影”を保持してリフェッチ上書きを回避
   * ============================================================ */
  const [roleShadow, setRoleShadow] = useState<
    Record<string, Project['role'] | undefined>
  >({});

  // 初回：サーバーデータに role がある場合は roleShadow に取り込む
  useEffect(() => {
    const next: Record<string, Project['role'] | undefined> = {};
    cascade.forEach((d, di) =>
      ensureArray(d.projects).forEach((p, pi) => {
        const k = `${di}:${pi}`;
        if (p.role != null) next[k] = p.role;
      }),
    );
    setRoleShadow((prev) => ({ ...next, ...prev })); // 既存影を優先
  }, [cascade.length, cascade]);

  // サーバーからのリフェッチ後に role が欠落していたら、影から復元して patch
  useEffect(() => {
    if (!Array.isArray(cascade) || cascade.length === 0) return;

    let needsPatch = false;
    const next: Department[] = cascade.map((d, di) => {
      const projs = ensureArray(d.projects).map((p, pi) => {
        const k = `${di}:${pi}`;
        if (p.role == null && roleShadow[k] != null) {
          needsPatch = true;
          return { ...p, role: roleShadow[k] };
        }
        return p;
      });
      return { ...d, projects: projs };
    });

    if (needsPatch) {
      patchDepartments(() => next);
    }
  }, [cascade, roleShadow, patchDepartments]);

  /* -------- 構造化KR：インライン編集制御 -------- */
  const [editIdx, setEditIdx] = useState<string | null>(null);

  function updateStructuredKR(
    dIdx: number,
    pIdx: number,
    idx: number,
    patch: Partial<KRStructuredX>,
  ) {
    patchDepartments((prev) => {
      const next = [...prev];
      const deptPrev = next[dIdx];
      if (!deptPrev) return prev;

      const dept = { ...deptPrev };
      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
      const projPrev = projs[pIdx];
      if (!projPrev) return prev;
      const proj = { ...projPrev };
      const list = Array.isArray(proj.okrsV2)
        ? [...(proj.okrsV2 as KRStructuredX[])]
        : [];

      if (list[idx])
        list[idx] = { ...(list[idx] as KRStructuredX), ...(patch as KRStructuredX) };
      (proj as any).okrsV2 = list;
      projs[pIdx] = proj;
      dept.projects = projs;
      next[dIdx] = dept;

      return next;
    });
  }

  const deleteStructuredKR = (dIdx: number, pIdx: number, idx: number) => {
    patchDepartments((prev) => {
      const next = [...prev];
      const deptPrev = next[dIdx];
      if (!deptPrev) return prev;
      const dept = { ...deptPrev };
      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
      const projPrev = projs[pIdx];
      if (!projPrev) return prev;
      const proj = { ...projPrev };
      const list = Array.isArray(proj.okrsV2)
        ? (proj.okrsV2 as KRStructuredX[]).filter((_: any, i) => i !== idx)
        : [];
      (proj as any).okrsV2 = list;
      projs[pIdx] = proj;
      dept.projects = projs;
      next[dIdx] = dept;
      return next;
    });
  };

  /* -------- プロジェクトのロール更新（影にも保存） -------- */
  const updateProjectRole = (
    dIdx: number,
    pIdx: number,
    role: Project['role'] | '',
  ) => {
    const k = `${dIdx}:${pIdx}`;
    const newRole: Project['role'] | undefined = role === '' ? undefined : role;

    // 影を先に更新（UI 即時反映）
    setRoleShadow((prev) => ({ ...prev, [k]: newRole }));

    // 本体も不変更新（＋dirty=true）
    patchDepartments((prev) => {
      const next = [...prev];
      const deptPrev = next[dIdx];
      if (!deptPrev) return prev;

      const dept = { ...deptPrev };
      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
      const projPrev = projs[pIdx];
      if (!projPrev) return prev;

      const proj = { ...projPrev, role: newRole };
      projs[pIdx] = proj;
      dept.projects = projs;
      next[dIdx] = dept;

      return next;
    });
  };

  /* -------- ★ ボタン用：カスケードOKR → 構造化KRたたき台生成（単一プロジェクト） -------- */
  const generateKRFromCascade = useCallback(
    (dIdx: number, pIdx: number) => {
      const st = useStrategyStore.getState() as any;
      const current: Department[] = Array.isArray(st.departments)
        ? (st.departments as Department[])
        : [];

      const dept = current[dIdx];
      const proj =
        dept && Array.isArray(dept.projects) ? dept.projects[pIdx] : undefined;

      if (!proj) return;

      const okrs = Array.isArray(proj.okrs) ? (proj.okrs as OKR[]) : [];

      if (!okrs.length) {
        alert('このプロジェクトには、カスケードで生成されたOKRがありません。');
        return;
      }

      patchDepartments((prev) => {
        const next = [...prev];
        const d = next[dIdx];
        if (!d) return prev;

        const projs = Array.isArray(d.projects) ? [...d.projects] : [];
        const p = projs[pIdx];
        if (!p) return prev;

        const existing: KRStructuredX[] = Array.isArray(p.okrsV2)
          ? [...(p.okrsV2 as KRStructuredX[])]
          : [];

        let changed = false;

        okrs.forEach((o) => {
          const ownerHint = o.owner;
          const krs = ensureArray(o.keyResults as string[] | undefined);

          krs.forEach((krText) => {
            const label = (krText ?? '').trim();
            if (!label) return;

            const already = existing.some(
              (x) => x.label?.trim() === label,
            );
            if (already) return;

            const kr = buildKRFromText(label, ownerHint);
            existing.push(kr);
            changed = true;
          });
        });

        if (!changed) {
          // 何も追加されなければそのまま
          return prev;
        }

        (p as any).okrsV2 = existing;
        projs[pIdx] = p;
        d.projects = projs;
        next[dIdx] = d;
        return next;
      });

      alert('カスケードOKRから、構造化KRのたたき台を追加しました。');
    },
    [patchDepartments],
  );

  /* -------- 構造化KR：追加フォーム（プロジェクト単位） -------- */
  const emptyDraft: Draft = {
    kind: 'ACQ',
    label: '',
    target: '',
    unit: '件',
    scope: 'project',
    baseKey: 'acq',
    owner: '',
    due: '',
    weight: '1',
    elasticity: '',
    lagMonths: '0',
    startYm: '',
    notes: '',
    overrideMode: 'APPORTION',
    baseOverride: '',
  };

  // プロジェクト毎の draft をキー管理（"d:p"）
  const [draftMap, setDraftMap] = useState<Record<string, Draft>>({});
  const [openAdd, setOpenAdd] = useState<Record<string, boolean>>({});
  const [helpMode, setHelpMode] = useState<boolean>(false);

  const keyFor = (dIdx: number, pIdx: number) => `${dIdx}:${pIdx}`;

  const setDraft = (k: string, patch: Partial<Draft>) =>
    setDraftMap((m) => ({
      ...m,
      [k]: { ...(m[k] ?? emptyDraft), ...patch },
    }));

  const resetDraft = (k: string) =>
    setDraftMap((m) => ({ ...m, [k]: { ...emptyDraft } }));

  const toggleAdd = (k: string, open?: boolean) =>
    setOpenAdd((m) => ({
      ...m,
      [k]: typeof open === 'boolean' ? open : !m[k],
    }));

  const addStructuredKR = (dIdx: number, pIdx: number) => {
    const k = keyFor(dIdx, pIdx);
    const draft = draftMap[k] ?? emptyDraft;

    // バリデーション
    const t = Number(draft.target);
    if (!Number.isFinite(t)) {
      alert('目標値は数値で入力してください。');
      return;
    }
    if (!draft.label.trim()) {
      alert('名称（ラベル）を入力してください。');
      return;
    }
    const weightNum = draft.weight ? Number(draft.weight) : 1;
    const elasticityNum = draft.elasticity
      ? Number(draft.elasticity)
      : undefined;
    const lagNum = draft.lagMonths ? Number(draft.lagMonths) : 0;
    const baseOverrideNum =
      draft.overrideMode === 'OVERRIDE' && draft.baseOverride
        ? Number(draft.baseOverride)
        : undefined;

    const kr: KRStructuredX = mkKRStructured({
      kind: draft.kind,
      label: draft.label.trim(),
      target: t,
      unit: draft.unit,
      scope: draft.scope,
      baseKey: draft.baseKey,
      owner: draft.owner?.trim() || undefined,
      due: draft.due?.trim() || undefined,
      weight: weightNum,
      elasticity: elasticityNum,
      lagMonths: lagNum,
      startYm: draft.startYm?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      overrideMode: draft.overrideMode,
      baseOverride: baseOverrideNum,
    });

    patchDepartments((prev) => {
      const next = [...prev];
      const deptPrev = next[dIdx];
      if (!deptPrev) return prev;
      const dept = { ...deptPrev };
      const projs = Array.isArray(dept.projects) ? [...dept.projects] : [];
      const projPrev = projs[pIdx];
      if (!projPrev) return prev;
      const proj = { ...projPrev };
      const list = Array.isArray(proj.okrsV2)
        ? [...(proj.okrsV2 as KRStructuredX[])]
        : [];
      list.push(kr);
      (proj as any).okrsV2 = list;
      projs[pIdx] = proj;
      dept.projects = projs;
      next[dIdx] = dept;
      return next;
    });

    // 追加後にドラフトを初期化して閉じる
    resetDraft(k);
    toggleAdd(k, false);
  };

  /* ============================================================
   * Render
   * ============================================================ */
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900">
          STAGE4 実行計画（OKR設定）
        </h1>
        <p className="text-[14px] text-zinc-600">
          各プロジェクトで
          <strong className="font-semibold">
            構造化した成果指標（KR）
          </strong>
          を追加・編集・削除します。
          ここで設定した内容は、後続の財務シミュレーションに連動します。
        </p>

        {/* ヘルプトグル */}
        <div className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/90 px-3 py-2">
          <label className="inline-flex items-center gap-2 text-[13px] text-zinc-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300"
              checked={helpMode}
              onChange={(e) => setHelpMode(e.target.checked)}
            />
            入力のガイドを表示
          </label>
          <span className="text-[12px] text-zinc-500">
            （オンにすると各項目の補足が常時見えます）
          </span>
        </div>

        {isHydrating && (
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-600">
            サーバーのデータを読み込み中です…
          </div>
        )}
        <div className="mt-6 h-px w-full bg-zinc-200" />
      </header>

      {/* 部門 × プロジェクト */}
      <div className="grid gap-6 md:[grid-template-columns:repeat(auto-fill,minmax(420px,1fr))]">
        {cascade.map((dept, deptIdx) => {
          const projects = ensureArray(dept.projects);
          return (
            <section
              key={deptIdx}
              className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-zinc-900">
                  {dept?.name ?? '部門'}
                </h2>
              </div>

              {projects.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
                  プロジェクトがありません。
                </div>
              )}

              {projects.map((proj, projIdx) => {
                const okrsV2 = ensureArray(proj.okrsV2) as KRStructuredX[];

                // カスケードで生成された OKR（Objective / KR / owner）
                const okrs = ensureArray(proj.okrs as OKR[] | undefined);

                const addKey = `${deptIdx}:${projIdx}`;
                const d = (draftMap[addKey] ?? emptyDraft) as Draft;
                const isOpen = !!openAdd[addKey];

                return (
                  <div
                    key={projIdx}
                    className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    {/* プロジェクトヘッダー */}
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-full border border-zinc-200 bg-white p-1.5 text-zinc-700 hover:bg-white/90"
                          title="表示切替"
                          type="button"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <div className="text-[15px] font-semibold text-zinc-900">
                          {proj.title || proj.name || 'プロジェクト'}
                        </div>
                      </div>

                      {/* プロジェクトのロール＋ボタン群 */}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[12px] text-zinc-600">
                            プロジェクトの役割
                          </span>
                          <Tooltip text="このプロジェクトの方向性です。収益＝売上を伸ばす、コスト＝費用を抑える、未来＝投資や成功確率、全社連携＝他プロジェクトとの相乗。">
                            <HelpCircle className="h-4 w-4 text-zinc-500" />
                          </Tooltip>
                        </div>
                        <select
                          className="h-9 rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                          value={roleShadow[addKey] ?? proj.role ?? ''}
                          onChange={(e) =>
                            updateProjectRole(
                              deptIdx,
                              projIdx,
                              e.target.value as Project['role'] | '',
                            )
                          }
                          disabled={isHydrating}
                        >
                          <option value="">未選択</option>
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>

                        {/* ★ 1クリックで構造化KRたたき台生成 */}
                        <button
                          onClick={() => generateKRFromCascade(deptIdx, projIdx)}
                          disabled={isHydrating}
                          className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                            isHydrating
                              ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                              : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                          }`}
                        >
                          OKRからKRたたき台
                        </button>

                        <button
                          onClick={() =>
                            setOpenAdd((m) => ({
                              ...m,
                              [addKey]: !isOpen,
                            }))
                          }
                          disabled={isHydrating}
                          className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                            isHydrating
                              ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                              : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                          }`}
                        >
                          ＋ 指標（KR）を追加
                        </button>
                      </div>
                    </div>

                    {/* ★ カスケードで生成されたOKR（参考表示） */}
                    {okrs.length > 0 && (
                      <div className="mb-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-3 py-2 text-[13px] text-zinc-700">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-semibold text-zinc-900">
                            カスケードで生成されたOKR（参考）
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            ※「OKRからKRたたき台」ボタンで、下の構造化KRに自動変換します
                          </span>
                        </div>
                        {okrs.map((o, oi) => (
                          <div
                            key={oi}
                            className="mt-1 rounded-xl bg-zinc-50 px-3 py-2"
                          >
                            <div className="text-[12px] font-semibold text-zinc-800">
                              Objective：
                              <span className="font-normal text-zinc-900">
                                {o.objective || '（未設定）'}
                              </span>
                            </div>
                            {o.owner && (
                              <div className="mt-0.5 text-[11px] text-zinc-600">
                                オーナー：{o.owner}
                              </div>
                            )}
                            {Array.isArray(o.keyResults) &&
                              o.keyResults.length > 0 && (
                                <ul className="mt-1 list-disc pl-4 text-[12px] text-zinc-800">
                                  {o.keyResults.map((kr, ki) => (
                                    <li key={ki}>{kr}</li>
                                  ))}
                                </ul>
                              )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 構造化KR 追加フォーム */}
                    {isOpen && (
                      <div className="mb-3 rounded-2xl border border-zinc-200 bg-white p-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          {/* 種類 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                種類
                              </div>
                              <Tooltip text="このKRが何に効くかを選びます。新規獲得（ACQ）/単価（ARPU）/解約（CHURN）/各種コスト/投資/成功確率/シナジー/直接の売上増減。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.kind}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  kind: e.target.value as KRKind,
                                })
                              }
                              disabled={isHydrating}
                            >
                              <option value="ACQ">新規獲得（ACQ）</option>
                              <option value="ARPU">単価（ARPU）</option>
                              <option value="CHURN">解約（CHURN）</option>
                              <option value="COST_FIXED">固定費</option>
                              <option value="COST_VARIABLE">変動費</option>
                              <option value="PERSONNEL">人件費</option>
                              <option value="INVEST">投資</option>
                              <option value="SUCCESS_RATE">成功確率</option>
                              <option value="SYNERGY">シナジー</option>
                              <option value="REVENUE">売上の増減（Δ）</option>
                            </select>
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                迷ったら「新規獲得」「単価」「解約」のいずれかを選べば十分です。
                              </p>
                            )}
                          </div>

                          {/* 単位 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                単位
                              </div>
                              <Tooltip text="％は割合（5と入力で5%）。件/人は数量。¥は金額です。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.unit}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  unit: e.target.value as Draft['unit'],
                                })
                              }
                              disabled={isHydrating}
                            >
                              <option value="%">%</option>
                              <option value="¥">¥</option>
                              <option value="件">件</option>
                              <option value="人">人</option>
                              <option value="比率">比率</option>
                            </select>
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                ％は自動で小数（0.05）に換算して扱います。
                              </p>
                            )}
                          </div>

                          {/* 対象範囲 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                対象範囲
                              </div>
                              <Tooltip text="値をどこに効かせるか。会社全体／部門／このプロジェクトのいずれか。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.scope}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  scope: e.target.value as Draft['scope'],
                                })
                              }
                              disabled={isHydrating}
                            >
                              <option value="company">会社全体</option>
                              <option value="department">部門</option>
                              <option value="project">このプロジェクト</option>
                            </select>
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                通常は「このプロジェクト」でOKです。
                              </p>
                            )}
                          </div>

                          {/* 基準となる指標 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                基準となる指標
                              </div>
                              <Tooltip text="このKRがどの財務指標に紐づくか。acq=新規、arpu=単価、churn=解約、fixed/variable/personnel=費用、invest=投資、synergy=相乗、revenue=売上。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.baseKey}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  baseKey: e.target.value as Draft['baseKey'],
                                })
                              }
                              disabled={isHydrating}
                            >
                              <option value="acq">新規獲得（acq）</option>
                              <option value="arpu">単価（arpu）</option>
                              <option value="churn">解約（churn）</option>
                              <option value="fixed_cost">固定費（fixed_cost）</option>
                              <option value="variable_cost">
                                変動費（variable_cost）
                              </option>
                              <option value="personnel_cost">
                                人件費（personnel_cost）
                              </option>
                              <option value="invest">投資（invest）</option>
                              <option value="success_rate">
                                成功確率（success_rate）
                              </option>
                              <option value="synergy">シナジー（synergy）</option>
                              <option value="revenue">売上（revenue）</option>
                            </select>
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                迷ったら ACQ / ARPU / CHURN でOK。
                              </p>
                            )}
                          </div>

                          {/* 名称 */}
                          <div className="space-y-1 md:col-span-2">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                名称（わかりやすく）
                              </div>
                              <Tooltip text="施策をひとことで。例：オンライン広告で新規200件増やす">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="例：オンライン広告で新規200件増やす"
                              value={d.label}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  label: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                後で見ても意図が伝わる短い文が◎
                              </p>
                            )}
                          </div>

                          {/* 目標値 */}
                          <div className="space-y-1">
                            <div className="flex items<center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                目標値（数値）
                              </div>
                              <Tooltip text="実現したい増減の量。％は5→5%（自動で0.05に換算）。解約の改善はマイナスで入力（例：-0.5）。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="例：200 / 5 / -0.5 など"
                              value={d.target}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  target: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                件/人/¥はそのままの数値でOK。
                              </p>
                            )}
                          </div>

                          {/* 担当者 */}
                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">
                              担当者（任意）
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="氏名やメールなど"
                              value={d.owner}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  owner: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                          </div>

                          {/* 期限 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                期限（任意 / YYYY-MM）
                              </div>
                              <Tooltip text="このKRの完了目安。例：2026-03">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="2026-03"
                              value={d.due}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  due: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                          </div>

                          {/* ▼ 拡張パラメータ */}
                          {/* 重み */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                重み（複数KRの配分）
                              </div>
                              <Tooltip text="同じ指標に効くKRが複数ある場合の配分比率。通常は1のままでOK。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="1（標準）"
                              value={d.weight}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  weight: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                効き目の強さの相対比です。
                              </p>
                            )}
                          </div>

                          {/* 弾性 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                弾性（効果の強さ）
                              </div>
                              <Tooltip text="活動→指標（ACQ/ARPU/CHURN）への変換係数。0.2なら、入力の20%が実際の増分になります。未入力は1。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="例：0.2"
                              value={d.elasticity}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  elasticity: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                          </div>

                          {/* ラグ（月） */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                ラグ（月）
                              </div>
                              <Tooltip text="効果が出るまでの遅れ。2なら2ヶ月後から効き始めます。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="numeric"
                              placeholder="0"
                              value={d.lagMonths}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  lagMonths: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                0〜3ヶ月程度が目安です。
                              </p>
                            )}
                          </div>

                          {/* 開始月 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                開始月（YYYY-MM）
                              </div>
                              <Tooltip text="このKRの効果をいつから数えるか。空欄なら期間の開始月。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="2025-11"
                              value={d.startYm}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  startYm: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                          </div>

                          {/* 反映方法 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                反映方法
                              </div>
                              <Tooltip text="按分：基準値に対して分け合って反映。上書き：指定値を基準として固定します。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.overrideMode}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  overrideMode: e.target.value as Draft['overrideMode'],
                                })
                              }
                              disabled={isHydrating}
                            >
                              <option value="APPORTION">
                                按分（基準を分けて反映）
                              </option>
                              <option value="OVERRIDE">
                                上書き（値を直接指定）
                              </option>
                            </select>
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">
                                通常は「按分」。計画で基準を固定したい時のみ「上書き」。
                              </p>
                            )}
                          </div>

                          {/* 上書き値 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                上書き値（上書きを選んだ場合）
                              </div>
                              <Tooltip text="反映方法で「上書き」を選んだ場合に、基準値として使う数値です。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="例：1000000"
                              value={d.baseOverride}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  baseOverride: e.target.value,
                                })
                              }
                              disabled={isHydrating || d.overrideMode !== 'OVERRIDE'}
                            />
                          </div>

                          {/* メモ */}
                          <div className="space-y-1 md:col-span-3">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">
                                メモ（任意）
                              </div>
                              <Tooltip text="補足や前提条件、計算根拠などを自由に残せます。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <textarea
                              className="min-h-[72px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px]"
                              placeholder="補足や前提条件など"
                              value={d.notes}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  notes: e.target.value,
                                })
                              }
                              disabled={isHydrating}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-800 hover:bg-zinc-50"
                            onClick={() => {
                              resetDraft(addKey);
                              setOpenAdd((m) => ({
                                ...m,
                                [addKey]: false,
                              }));
                            }}
                            disabled={isHydrating}
                          >
                            やめる
                          </button>
                          <button
                            className="rounded-xl bg-black px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 active:opacity-85 disabled:opacity-40"
                            onClick={() => addStructuredKR(deptIdx, projIdx)}
                            disabled={isHydrating}
                          >
                            追加する
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 構造化KRリスト */}
                    {okrsV2.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">
                        指標（KR）はまだありません。「OKRからKRたたき台」または「＋ 指標（KR）を追加」から登録してください。
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {okrsV2.map((k, i) => {
                          const editing = editIdx === `${deptIdx}:${projIdx}:${i}`;
                          const kk = k as KRStructuredX;
                          return (
                            <li
                              key={kk.id ?? i}
                              className="rounded-2xl border border-zinc-200 bg-white p-3"
                            >
                              {!editing ? (
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                                        {kk.kind}
                                      </span>
                                      <span className="text-[14px] text-zinc-900">
                                        {kk.label}
                                      </span>
                                    </div>
                                    <div className="text-[13px] text-zinc-700">
                                      目標：
                                      <strong>{kk.target}</strong>
                                      {kk.unit} ／ 対象：
                                      {kk.scope} ／ 基準：
                                      {kk.baseKey}
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[12px] text-zinc-600">
                                      {kk.owner && (
                                        <span>担当：{kk.owner}</span>
                                      )}
                                      {kk.due && (
                                        <span>期限：{kk.due}</span>
                                      )}
                                      {kk.weight != null && (
                                        <span>重み：{kk.weight}</span>
                                      )}
                                      {kk.elasticity != null && (
                                        <span>
                                          弾性：
                                          {kk.elasticity}
                                        </span>
                                      )}
                                      {kk.lagMonths != null && (
                                        <span>
                                          ラグ（月）：
                                          {kk.lagMonths}
                                        </span>
                                      )}
                                      {kk.startYm && (
                                        <span>開始：{kk.startYm}</span>
                                      )}
                                      {kk.overrideMode && (
                                        <span>
                                          反映：
                                          {kk.overrideMode === 'OVERRIDE'
                                            ? '上書き'
                                            : '按分'}
                                        </span>
                                      )}
                                      {kk.baseOverride != null &&
                                        kk.overrideMode === 'OVERRIDE' && (
                                          <span>
                                            上書き値：
                                            {kk.baseOverride}
                                          </span>
                                        )}
                                    </div>
                                    {kk.notes && (
                                      <div className="mt-1 whitespace-pre-wrap text-[12px] text-zinc-500">
                                        メモ：{kk.notes}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() =>
                                        setEditIdx(`${deptIdx}:${projIdx}:${i}`)
                                      }
                                      className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-800 hover:bg-zinc-50"
                                      disabled={isHydrating}
                                    >
                                      編集
                                    </button>
                                    <button
                                      onClick={() =>
                                        deleteStructuredKR(deptIdx, projIdx, i)
                                      }
                                      className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[12px] text-rose-600 hover:bg-rose-50"
                                      disabled={isHydrating}
                                    >
                                      削除
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                                  <select
                                    value={kk.kind}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        kind: e.target.value as KRKind,
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={isHydrating}
                                  >
                                    <option value="ACQ">新規獲得（ACQ）</option>
                                    <option value="ARPU">単価（ARPU）</option>
                                    <option value="CHURN">解約（CHURN）</option>
                                    <option value="COST_FIXED">固定費</option>
                                    <option value="COST_VARIABLE">変動費</option>
                                    <option value="PERSONNEL">人件費</option>
                                    <option value="INVEST">投資</option>
                                    <option value="SUCCESS_RATE">
                                      成功確率
                                    </option>
                                    <option value="SYNERGY">シナジー</option>
                                    <option value="REVENUE">売上の増減（Δ）</option>
                                  </select>

                                  <input
                                    value={kk.label ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        label: e.target.value,
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    placeholder="名称（わかりやすく）"
                                    disabled={isHydrating}
                                  />

                                  <input
                                    value={String(kk.target ?? '')}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        target: Number(e.target.value || 0),
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="目標値（数値）"
                                    disabled={isHydrating}
                                  />

                                  <select
                                    value={kk.unit ?? '件'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        unit: e.target.value as Draft['unit'],
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={isHydrating}
                                  >
                                    <option value="%">%</option>
                                    <option value="¥">¥</option>
                                    <option value="件">件</option>
                                    <option value="人">人</option>
                                    <option value="比率">比率</option>
                                  </select>

                                  <select
                                    value={kk.scope ?? 'project'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        scope: e.target.value as Draft['scope'],
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={isHydrating}
                                  >
                                    <option value="company">会社全体</option>
                                    <option value="department">部門</option>
                                    <option value="project">このプロジェクト</option>
                                  </select>

                                  <select
                                    value={kk.baseKey ?? 'acq'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        baseKey: e.target.value as Draft['baseKey'],
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={isHydrating}
                                  >
                                    <option value="acq">新規獲得（acq）</option>
                                    <option value="arpu">単価（arpu）</option>
                                    <option value="churn">解約（churn）</option>
                                    <option value="fixed_cost">
                                      固定費（fixed_cost）
                                    </option>
                                    <option value="variable_cost">
                                      変動費（variable_cost）
                                    </option>
                                    <option value="personnel_cost">
                                      人件費（personnel_cost）
                                    </option>
                                    <option value="invest">投資（invest）</option>
                                    <option value="success_rate">
                                      成功確率（success_rate）
                                    </option>
                                    <option value="synergy">シナジー（synergy）</option>
                                    <option value="revenue">売上（revenue）</option>
                                  </select>

                                  <input
                                    value={kk.owner ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        owner: e.target.value,
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] md:col-span-3"
                                    placeholder="担当者（任意）"
                                    disabled={isHydrating}
                                  />

                                  <input
                                    value={kk.due ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        due: e.target.value,
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] md:col-span-2"
                                    placeholder="期限（YYYY-MM）"
                                    disabled={isHydrating}
                                  />

                                  {/* 重み・弾性・ラグ・開始月・反映方法・上書き値・メモ */}
                                  <input
                                    value={kk.weight ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        weight: Number(e.target.value || 0),
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="重み"
                                    disabled={isHydrating}
                                  />

                                  <input
                                    value={kk.elasticity ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        elasticity: Number(e.target.value || 0),
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="弾性（係数）"
                                    disabled={isHydrating}
                                  />

                                  <input
                                    value={kk.lagMonths ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        lagMonths: Number(e.target.value || 0),
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="numeric"
                                    placeholder="ラグ（月）"
                                    disabled={isHydrating}
                                  />

                                  <input
                                    value={kk.startYm ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        startYm: e.target.value,
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    placeholder="開始月（YYYY-MM）"
                                    disabled={isHydrating}
                                  />

                                  <select
                                    value={kk.overrideMode ?? 'APPORTION'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        overrideMode: e.target
                                          .value as 'APPORTION' | 'OVERRIDE',
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={isHydrating}
                                  >
                                    <option value="APPORTION">按分</option>
                                    <option value="OVERRIDE">上書き</option>
                                  </select>

                                  <input
                                    value={kk.baseOverride ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        baseOverride: Number(e.target.value || 0),
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="上書き値（上書き選択時）"
                                    disabled={
                                      isHydrating ||
                                      kk.overrideMode !== 'OVERRIDE'
                                    }
                                  />

                                  <textarea
                                    value={kk.notes ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        notes: e.target.value,
                                      })
                                    }
                                    className="min-h-[60px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] md:col-span-3"
                                    placeholder="メモ（任意）"
                                    disabled={isHydrating}
                                  />

                                  <div className="flex items-center justify-end gap-2 md:col-span-3">
                                    <button
                                      onClick={() => setEditIdx(null)}
                                      className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-800 hover:bg-zinc-50"
                                      disabled={isHydrating}
                                    >
                                      完了
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {/* フローティング保存ドック */}
      <SaveDock />
    </main>
  );
}
