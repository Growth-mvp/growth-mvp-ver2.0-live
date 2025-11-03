// /app/okr/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  children: React.ReactNode;
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
          className={`pointer-events-none absolute z-[60] max-w-[280px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] leading-5 text-zinc-800 shadow ${pos}`}
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
    >
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
      await useStrategyStore.getState().saveStrategyData();
      savedHashRef.current = JSON.stringify((useStrategyStore.getState() as any).departments ?? []);
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
      <div className="rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow flex items-center gap-2">
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            online ? 'bg-emerald-500' : online === false ? 'bg-amber-500' : 'bg-zinc-300'
          }`}
        />
        <span className="text-xs text-zinc-800">
          {saving ? '保存中…' : dirty ? '未保存の変更があります' : `保存済み ${formattedSavedAt || ''}`}
        </span>
        <button
          onClick={saveNow}
          disabled={!canSave}
          className={`ml-2 h-7 rounded-full px-3 text-xs font-semibold ${
            canSave ? 'bg-black text-white' : 'bg-zinc-200 text-zinc-500 cursor-not-allowed'
          }`}
        >
          今すぐ保存
        </button>
      </div>
      {error && <div className="text-[11px] text-rose-600 mt-1">{error}</div>}
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
  baseKey:
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
  const { departments, setDepartments } = useStrategyStore() as any;
  const { companyId: scopeCompanyId, hydrated, setCompanyScope, setHydrated, refetchFromServer } =
    useStrategyStore();
  const access = useAccess();
  const accessCompanyId: string | undefined = useMemo(
    () =>
      (access as any)?.companyId ??
      (useStrategyStore.getState().companyId as string | undefined),
    [(access as any)?.companyId]
  );

  /* -------- 会社スコープ & 初期ロード -------- */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (lastAppliedCompanyRef.current === accessCompanyId) return;
    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      hardResetForCompanySwitch(accessCompanyId);
    } else {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope]);

  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId) return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }
      const timer = setTimeout(() => {
        if (!cancelled) setHydrated?.(true);
      }, 7000);
      try {
        await loadAndHydrate(accessCompanyId);
        await refetchFromServer?.();
        setHydrated?.(true);
        loadGuardRef.current = accessCompanyId;
      } finally {
        clearTimeout(timer);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [accessCompanyId, hydrated, scopeCompanyId, refetchFromServer, setHydrated]);

  /* -------- 自動保存：会社スコープに紐付け -------- */
  useAutoSave([accessCompanyId, departments]);

  /* -------- 表示/編集ユーティリティ -------- */
  const cascade: Department[] = useMemo(
    () => (Array.isArray(departments) ? (departments as Department[]) : []),
    [departments]
  );
  const isHydrating = !hydrated || scopeCompanyId !== accessCompanyId;

  const ensureArray = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  const { setDepartments: setDepartmentsInStore } = useStrategyStore() as any;

  const commit = (next: Department[]) => {
    const cloned = next.map((d) => ({
      ...d,
      projects: Array.isArray(d.projects)
        ? d.projects.map((p) => ({
            ...p,
            okrs: Array.isArray(p.okrs)
              ? p.okrs.map((o) => ({ ...o, keyResults: [...(o.keyResults ?? [])] }))
              : [],
          }))
        : [],
    }));
    setDepartments(cloned);
    setDepartmentsInStore(cloned);
  };

  /* -------- 初期補修：okrsV2 の id を一括補完 -------- */
  useEffect(() => {
    if (!Array.isArray(departments) || departments.length === 0) return;
    const patched = ensureKrIds(departments as Department[]);
    if (patched !== departments) {
      setDepartments(patched);
      setDepartmentsInStore(patched);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments?.length]);

  /* -------- 構造化KR：インライン編集制御 -------- */
  const [editIdx, setEditIdx] = useState<string | null>(null);

  function updateStructuredKR(
    dIdx: number,
    pIdx: number,
    idx: number,
    patch: Partial<KRStructuredX>
  ) {
    setDepartments((prev: Department[]) => {
      const next = [...prev];
      const dept = next[dIdx];
      if (!dept) return prev;
      const proj = ensureArray(dept.projects)[pIdx];
      if (!proj) return prev;
      const list = Array.isArray(proj.okrsV2) ? [...(proj.okrsV2 as KRStructuredX[])] : [];
      if (list[idx]) list[idx] = { ...(list[idx] as KRStructuredX), ...(patch as KRStructuredX) };
      (proj as any).okrsV2 = list as KRStructuredX[];
      dept.projects![pIdx] = proj;
      next[dIdx] = dept;
      commit(next);
      return next;
    });
  }

  const deleteStructuredKR = (dIdx: number, pIdx: number, idx: number) => {
    setDepartments((prev: Department[]) => {
      const next = [...prev];
      const dept = next[dIdx];
      if (!dept) return prev;
      const proj = ensureArray(dept.projects)[pIdx];
      if (!proj) return prev;
      const list = Array.isArray(proj.okrsV2)
        ? (proj.okrsV2 as KRStructuredX[]).filter((_, i) => i !== idx)
        : [];
      (proj as any).okrsV2 = list;
      dept.projects![pIdx] = proj;
      next[dIdx] = dept;
      commit(next);
      return next;
    });
  };

  /* -------- プロジェクトのロール更新 -------- */
  const updateProjectRole = (dIdx: number, pIdx: number, role: Project['role']) => {
    setDepartments((prev: Department[]) => {
      const next = [...prev];
      const dept = next[dIdx];
      if (!dept) return prev;
      const proj = ensureArray(dept.projects)[pIdx];
      if (!proj) return prev;
      (proj as any).role = role;
      dept.projects![pIdx] = proj;
      next[dIdx] = dept;
      commit(next);
      return next;
    });
  };

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
    setDraftMap((m) => ({ ...m, [k]: { ...(m[k] ?? emptyDraft), ...patch } }));

  const resetDraft = (k: string) => setDraftMap((m) => ({ ...m, [k]: { ...emptyDraft } }));

  const toggleAdd = (k: string, open?: boolean) =>
    setOpenAdd((m) => ({ ...m, [k]: typeof open === 'boolean' ? open : !m[k] }));

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
    const elasticityNum = draft.elasticity ? Number(draft.elasticity) : undefined;
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

    setDepartments((prev: Department[]) => {
      const next = [...prev];
      const dept = next[dIdx];
      if (!dept) return prev;
      const proj = ensureArray(dept.projects)[pIdx];
      if (!proj) return prev;
      const list = Array.isArray(proj.okrsV2) ? [...(proj.okrsV2 as KRStructuredX[])] : [];
      list.push(kr);
      (proj as any).okrsV2 = list;
      dept.projects![pIdx] = proj;
      next[dIdx] = dept;
      commit(next);
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
        <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900">STAGE4 実行計画（OKR設定）</h1>
        <p className="text-[14px] text-zinc-600">
          各プロジェクトで<strong className="font-semibold">構造化した成果指標（KR）</strong>を追加・編集・削除します。
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
          <span className="text-[12px] text-zinc-500">（オンにすると各項目の補足が常時見えます）</span>
        </div>

        {isHydrating && (
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-600">
            サーバーのデータを読み込み中です…
          </div>
        )}
        <div className="mt-6 h-px w-full bg-zinc-200" />
      </header>

      {/* ▼ ここだけ変更：MD以上で“めいっぱい横長”に（最小幅420pxを確保しつつ自動段組） */}
      <div className="grid gap-6 md:[grid-template-columns:repeat(auto-fill,minmax(420px,1fr))]">
        {cascade.map((dept, deptIdx) => {
          const projects = ensureArray(dept.projects);
          return (
            <section
              key={deptIdx}
              className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-zinc-900">{dept?.name ?? '部門'}</h2>
              </div>

              {projects.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
                  プロジェクトがありません。
                </div>
              )}

              {projects.map((proj, projIdx) => {
                const okrsV2 = ensureArray(proj.okrsV2) as KRStructuredX[];
                const addKey = keyFor(deptIdx, projIdx);
                const d = (draftMap[addKey] ?? emptyDraft) as Draft;
                const isOpen = !!openAdd[addKey];

                return (
                  <div
                    key={projIdx}
                    className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    {/* プロジェクトヘッダー */}
                    <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
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

                      {/* プロジェクトのロール */}
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[12px] text-zinc-600">プロジェクトの役割</span>
                          <Tooltip text="このプロジェクトの方向性です。収益＝売上を伸ばす、コスト＝費用を抑える、未来＝投資や成功確率、全社連携＝他プロジェクトとの相乗。">
                            <HelpCircle className="h-4 w-4 text-zinc-500" />
                          </Tooltip>
                        </div>
                        <select
                          className="h-9 rounded-xl border border-zinc-200 bg-white px-2 text-[13px]"
                          value={proj.role ?? ''}
                          onChange={(e) =>
                            updateProjectRole(deptIdx, projIdx, (e.target.value as Project['role']) || undefined)
                          }
                          disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                        >
                          <option value="">未選択</option>
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value ?? ''}>
                              {opt.label}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => setOpenAdd((m) => ({ ...m, [addKey]: !isOpen }))}
                          disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                          className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                            !hydrated || scopeCompanyId !== accessCompanyId
                              ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                              : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                          }`}
                        >
                          ＋ 指標（KR）を追加
                        </button>
                      </div>
                    </div>

                    {/* 構造化KR 追加フォーム */}
                    {isOpen && (
                      <div className="mb-3 rounded-2xl border border-zinc-200 bg-white p-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {/* 種類 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">種類</div>
                              <Tooltip text="このKRが何に効くかを選びます。新規獲得（ACQ）/単価（ARPU）/解約（CHURN）/各種コスト/投資/成功確率/シナジー/直接の売上増減。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.kind}
                              onChange={(e) => setDraft(addKey, { kind: e.target.value as KRKind })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
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
                              <div className="text-[11px] text-zinc-600">単位</div>
                              <Tooltip text="％は割合（5と入力で5%）。件/人は数量。¥は金額です。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.unit}
                              onChange={(e) => setDraft(addKey, { unit: e.target.value as Draft['unit'] })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="%">%</option>
                              <option value="¥">¥</option>
                              <option value="件">件</option>
                              <option value="人">人</option>
                              <option value="比率">比率</option>
                            </select>
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">％は自動で小数（0.05）に換算して扱います。</p>
                            )}
                          </div>

                          {/* 対象範囲 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">対象範囲</div>
                              <Tooltip text="値をどこに効かせるか。会社全体／部門／このプロジェクトのいずれか。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.scope}
                              onChange={(e) => setDraft(addKey, { scope: e.target.value as Draft['scope'] })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="company">会社全体</option>
                              <option value="department">部門</option>
                              <option value="project">このプロジェクト</option>
                            </select>
                            {helpMode && <p className="text-[11px] text-zinc-500">通常は「このプロジェクト」でOKです。</p>}
                          </div>

                          {/* 基準となる指標 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">基準となる指標</div>
                              <Tooltip text="このKRがどの財務指標に紐づくか。acq=新規、arpu=単価、churn=解約、fixed/variable/personnel=費用、invest=投資、synergy=相乗、revenue=売上。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.baseKey}
                              onChange={(e) => setDraft(addKey, { baseKey: e.target.value as Draft['baseKey'] })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="acq">新規獲得（acq）</option>
                              <option value="arpu">単価（arpu）</option>
                              <option value="churn">解約（churn）</option>
                              <option value="fixed_cost">固定費（fixed_cost）</option>
                              <option value="variable_cost">変動費（variable_cost）</option>
                              <option value="personnel_cost">人件費（personnel_cost）</option>
                              <option value="invest">投資（invest）</option>
                              <option value="success_rate">成功確率（success_rate）</option>
                              <option value="synergy">シナジー（synergy）</option>
                              <option value="revenue">売上（revenue）</option>
                            </select>
                            {helpMode && <p className="text-[11px] text-zinc-500">迷ったら ACQ / ARPU / CHURN でOK。</p>}
                          </div>

                          {/* 名称 */}
                          <div className="space-y-1 md:col-span-2">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">名称（わかりやすく）</div>
                              <Tooltip text="施策をひとことで。例：オンライン広告で新規200件増やす">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="例：オンライン広告で新規200件増やす"
                              value={d.label}
                              onChange={(e) => setDraft(addKey, { label: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                            {helpMode && <p className="text-[11px] text-zinc-500">後で見ても意図が伝わる短い文が◎</p>}
                          </div>

                          {/* 目標値 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">目標値（数値）</div>
                              <Tooltip text="実現したい増減の量。％は5→5%（自動で0.05に換算）。解約の改善はマイナスで入力（例：-0.5）。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="例：200 / 5 / -0.5 など"
                              value={d.target}
                              onChange={(e) => setDraft(addKey, { target: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                            {helpMode && <p className="text-[11px] text-zinc-500">件/人/¥はそのままの数値でOK。</p>}
                          </div>

                          {/* 担当者 */}
                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">担当者（任意）</div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="氏名やメールなど"
                              value={d.owner}
                              onChange={(e) => setDraft(addKey, { owner: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>

                          {/* 期限 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">期限（任意 / YYYY-MM）</div>
                              <Tooltip text="このKRの完了目安。例：2026-03">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="2026-03"
                              value={d.due}
                              onChange={(e) => setDraft(addKey, { due: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>

                          {/* ▼ 拡張パラメータ */}
                          {/* 重み */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">重み（複数KRの配分）</div>
                              <Tooltip text="同じ指標に効くKRが複数ある場合の配分比率。通常は1のままでOK。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="1（標準）"
                              value={d.weight}
                              onChange={(e) => setDraft(addKey, { weight: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                            {helpMode && <p className="text-[11px] text-zinc-500">効き目の強さの相対比です。</p>}
                          </div>

                          {/* 弾性 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">弾性（効果の強さ）</div>
                              <Tooltip text="活動→指標（ACQ/ARPU/CHURN）への変換係数。0.2なら、入力の20%が実際の増分になります。未入力は1。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="例：0.2"
                              value={d.elasticity}
                              onChange={(e) => setDraft(addKey, { elasticity: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>

                          {/* ラグ（月） */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">ラグ（月）</div>
                              <Tooltip text="効果が出るまでの遅れ。2なら2ヶ月後から効き始めます。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="numeric"
                              placeholder="0"
                              value={d.lagMonths}
                              onChange={(e) => setDraft(addKey, { lagMonths: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                            {helpMode && <p className="text-[11px] text-zinc-500">0〜3ヶ月程度が目安です。</p>}
                          </div>

                          {/* 開始月 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">開始月（YYYY-MM）</div>
                              <Tooltip text="このKRの効果をいつから数えるか。空欄なら期間の開始月。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="2025-11"
                              value={d.startYm}
                              onChange={(e) => setDraft(addKey, { startYm: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>

                          {/* 反映方法 */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">反映方法</div>
                              <Tooltip text="按分：基準値に対して分け合って反映。上書き：指定値を基準として固定します。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.overrideMode}
                              onChange={(e) => setDraft(addKey, { overrideMode: e.target.value as Draft['overrideMode'] })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="APPORTION">按分（基準を分けて反映）</option>
                              <option value="OVERRIDE">上書き（値を直接指定）</option>
                            </select>
                            {helpMode && (
                              <p className="text-[11px] text-zinc-500">通常は「按分」。計画で基準を固定したい時のみ「上書き」。</p>
                            )}
                          </div>

                          {/* 上書き値 */}
                          <div className="space-y-1">
                            <div className="flex items中心 gap-1">
                              <div className="text-[11px] text-zinc-600">上書き値（上書きを選んだ場合）</div>
                              <Tooltip text="反映方法で「上書き」を選んだ場合に、基準値として使う数値です。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="例：1000000"
                              value={d.baseOverride}
                              onChange={(e) => setDraft(addKey, { baseOverride: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId || d.overrideMode !== 'OVERRIDE'}
                            />
                          </div>

                          {/* メモ */}
                          <div className="space-y-1 md:col-span-3">
                            <div className="flex items-center gap-1">
                              <div className="text-[11px] text-zinc-600">メモ（任意）</div>
                              <Tooltip text="補足や前提条件、計算根拠などを自由に残せます。">
                                <HelpCircle className="h-3.5 w-3.5 text-zinc-500" />
                              </Tooltip>
                            </div>
                            <textarea
                              className="min-h-[72px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px]"
                              placeholder="補足や前提条件など"
                              value={d.notes}
                              onChange={(e) => setDraft(addKey, { notes: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-800 hover:bg-zinc-50"
                            onClick={() => {
                              resetDraft(addKey);
                              setOpenAdd((m) => ({ ...m, [addKey]: false }));
                            }}
                            disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                          >
                            やめる
                          </button>
                          <button
                            className="rounded-xl bg-black px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90 active:opacity-85 disabled:opacity-40"
                            onClick={() => addStructuredKR(deptIdx, projIdx)}
                            disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                          >
                            追加する
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 構造化KRリスト */}
                    {okrsV2.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">
                        指標（KR）はまだありません。「＋ 指標（KR）を追加」から登録してください。
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
                                      <span className="text-[14px] text-zinc-900">{kk.label}</span>
                                    </div>
                                    <div className="text-[13px] text-zinc-700">
                                      目標：<strong>{kk.target}</strong>
                                      {kk.unit} ／ 対象：{kk.scope} ／ 基準：{kk.baseKey}
                                    </div>
                                    <div className="text-[12px] text-zinc-600 flex flex-wrap gap-2">
                                      {kk.owner && <span>担当：{kk.owner}</span>}
                                      {kk.due && <span>期限：{kk.due}</span>}
                                      {kk.weight != null && <span>重み：{kk.weight}</span>}
                                      {kk.elasticity != null && <span>弾性：{kk.elasticity}</span>}
                                      {kk.lagMonths != null && <span>ラグ（月）：{kk.lagMonths}</span>}
                                      {kk.startYm && <span>開始：{kk.startYm}</span>}
                                      {kk.overrideMode && (
                                        <span>反映：{kk.overrideMode === 'OVERRIDE' ? '上書き' : '按分'}</span>
                                      )}
                                      {kk.baseOverride != null && kk.overrideMode === 'OVERRIDE' && (
                                        <span>上書き値：{kk.baseOverride}</span>
                                      )}
                                    </div>
                                    {kk.notes && (
                                      <div className="text-[12px] text-zinc-500 mt-1 whitespace-pre-wrap">
                                        メモ：{kk.notes}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => setEditIdx(`${deptIdx}:${projIdx}:${i}`)}
                                      className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[12px] text-zinc-800 hover:bg-zinc-50"
                                      disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                    >
                                      編集
                                    </button>
                                    <button
                                      onClick={() => deleteStructuredKR(deptIdx, projIdx, i)}
                                      className="rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[12px] text-rose-600 hover:bg-rose-50"
                                      disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                    >
                                      削除
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                                  <select
                                    value={kk.kind}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { kind: e.target.value as KRKind })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
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

                                  <input
                                    value={kk.label ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { label: e.target.value })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    placeholder="名称（わかりやすく）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <input
                                    value={String(kk.target ?? '')}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { target: Number(e.target.value || 0) })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="目標値（数値）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <select
                                    value={kk.unit ?? '件'}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { unit: e.target.value as Draft['unit'] })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  >
                                    <option value="%">%</option>
                                    <option value="¥">¥</option>
                                    <option value="件">件</option>
                                    <option value="人">人</option>
                                    <option value="比率">比率</option>
                                  </select>

                                  <select
                                    value={kk.scope ?? 'project'}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { scope: e.target.value as Draft['scope'] })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  >
                                    <option value="company">会社全体</option>
                                    <option value="department">部門</option>
                                    <option value="project">このプロジェクト</option>
                                  </select>

                                  <select
                                    value={kk.baseKey ?? 'acq'}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { baseKey: e.target.value as Draft['baseKey'] })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  >
                                    <option value="acq">新規獲得（acq）</option>
                                    <option value="arpu">単価（arpu）</option>
                                    <option value="churn">解約（churn）</option>
                                    <option value="fixed_cost">固定費（fixed_cost）</option>
                                    <option value="variable_cost">変動費（variable_cost）</option>
                                    <option value="personnel_cost">人件費（personnel_cost）</option>
                                    <option value="invest">投資（invest）</option>
                                    <option value="success_rate">成功確率（success_rate）</option>
                                    <option value="synergy">シナジー（synergy）</option>
                                    <option value="revenue">売上（revenue）</option>
                                  </select>

                                  <input
                                    value={kk.owner ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { owner: e.target.value })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] md:col-span-3"
                                    placeholder="担当者（任意）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <input
                                    value={kk.due ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { due: e.target.value })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] md:col-span-2"
                                    placeholder="期限（YYYY-MM）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  {/* 追加：重み・弾性・ラグ・開始月・反映方法・上書き値・メモ */}
                                  <input
                                    value={kk.weight ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { weight: Number(e.target.value || 0) })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="重み"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <input
                                    value={kk.elasticity ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { elasticity: Number(e.target.value || 0) })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="弾性（係数）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <input
                                    value={kk.lagMonths ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { lagMonths: Number(e.target.value || 0) })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="numeric"
                                    placeholder="ラグ（月）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <input
                                    value={kk.startYm ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { startYm: e.target.value })}
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    placeholder="開始月（YYYY-MM）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <select
                                    value={kk.overrideMode ?? 'APPORTION'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        overrideMode: e.target.value as 'APPORTION' | 'OVERRIDE',
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  >
                                    <option value="APPORTION">按分</option>
                                    <option value="OVERRIDE">上書き</option>
                                  </select>

                                  <input
                                    value={kk.baseOverride ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, { baseOverride: Number(e.target.value || 0) })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="上書き値（上書き選択時）"
                                    disabled={
                                      !hydrated ||
                                      scopeCompanyId !== accessCompanyId ||
                                      kk.overrideMode !== 'OVERRIDE'
                                    }
                                  />

                                  <textarea
                                    value={kk.notes ?? ''}
                                    onChange={(e) => updateStructuredKR(deptIdx, projIdx, i, { notes: e.target.value })}
                                    className="min-h-[60px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] md:col-span-3"
                                    placeholder="メモ（任意）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <div className="flex items-center justify-end gap-2 md:col-span-3">
                                    <button
                                      onClick={() => setEditIdx(null)}
                                      className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-800 hover:bg-zinc-50"
                                      disabled={!hydrated || scopeCompanyId !== accessCompanyId}
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
