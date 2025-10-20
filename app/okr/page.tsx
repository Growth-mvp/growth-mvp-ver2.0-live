// /app/okr/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { ChevronDown } from 'lucide-react';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { KRStructured, KRKind } from '@/types/strategy';

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
};

type Department = {
  name?: string;
  projects?: Project[];
  strategy?: string;
  mission?: string;
};

/* ============================================================
 * 共有ユーティリティ：ID生成 & KRStructured生成
 * ============================================================ */
const genId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `kr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

function mkKRStructured(
  p: Omit<KRStructured, 'id'> & Partial<Pick<KRStructured, 'id' | 'weight' | 'elasticity' | 'lagMonths' | 'startYm' | 'notes'>>
): KRStructured {
  return {
    id: p.id ?? genId(),
    // 任意フィールドの既定値（既存UIは使わないが将来安全のため）
    weight: p.weight ?? 1,
    elasticity: p.elasticity,
    lagMonths: p.lagMonths ?? 0,
    startYm: p.startYm,
    notes: p.notes,
    // 必須フィールド
    kind: p.kind,
    label: p.label,
    target: p.target,
    unit: p.unit,
    scope: p.scope,
    baseKey: p.baseKey,
    baseOverride: p.baseOverride,
    owner: p.owner,
    due: p.due,
  };
}

/* 既存データの後追い補修：okrsV2 の id 不足を補完 */
function ensureKrIds(departments: Department[]): Department[] {
  let touched = false;
  const patched = departments.map((d) => {
    const projs = Array.isArray(d.projects) ? d.projects.map((p) => {
      const list = Array.isArray(p.okrsV2) ? p.okrsV2.map((k) => {
        if (!k?.id) {
          touched = true;
          return mkKRStructured({ ...k });
        }
        return k;
      }) : p.okrsV2;
      return { ...p, okrsV2: list };
    }) : d.projects;
    return { ...d, projects: projs };
  });
  return touched ? patched : departments;
}

/* ============================================================
 * 保存ステータス・ドック（そのまま利用）
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
      setError('保存に失敗しました');
      console.warn('SaveDock error:', e);
    } finally {
      setSaving(false);
    }
  }, [user?.id]);

  if (!hydratedUI)
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <div className="rounded-2xl border border-zinc-200 bg-white/95 px-3 py-2 shadow">
          <span className="text-xs text-zinc-600">状態確認中...</span>
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
          {saving ? '保存中...' : dirty ? '未保存の変更あり' : `保存済み ${formattedSavedAt || ''}`}
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
 * メインコンポーネント（構造化KRの追加・編集・削除に対応）
 * ============================================================ */
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
      // 差分がある場合のみコミット
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
    patch: Partial<KRStructured>
  ) {
    setDepartments((prev: Department[]) => {
      const next = [...prev];
      const dept = next[dIdx];
      if (!dept) return prev;
      const proj = ensureArray(dept.projects)[pIdx];
      if (!proj) return prev;
      const list = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];
      if (list[idx]) list[idx] = { ...list[idx], ...patch };
      proj.okrsV2 = list;
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
      const list = Array.isArray(proj.okrsV2) ? proj.okrsV2.filter((_, i) => i !== idx) : [];
      proj.okrsV2 = list;
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
  };

  // プロジェクト毎の draft をキー管理（"d:p"）
  const [draftMap, setDraftMap] = useState<Record<string, Draft>>({});
  const [openAdd, setOpenAdd] = useState<Record<string, boolean>>({});

  const keyFor = (dIdx: number, pIdx: number) => `${dIdx}:${pIdx}`;

  const setDraft = (k: string, patch: Partial<Draft>) =>
    setDraftMap((m) => ({ ...m, [k]: { ...(m[k] ?? emptyDraft), ...patch } }));

  const resetDraft = (k: string) =>
    setDraftMap((m) => ({ ...m, [k]: { ...emptyDraft } }));

  const toggleAdd = (k: string, open?: boolean) =>
    setOpenAdd((m) => ({ ...m, [k]: typeof open === 'boolean' ? open : !m[k] }));

  const addStructuredKR = (dIdx: number, pIdx: number) => {
    const k = keyFor(dIdx, pIdx);
    const draft = draftMap[k] ?? emptyDraft;

    // バリデーション
    const t = Number(draft.target);
    if (!Number.isFinite(t)) {
      alert('ターゲットは数値で入力してください');
      return;
    }
    if (!draft.label.trim()) {
      alert('ラベルを入力してください');
      return;
    }

    // ★ id を自動付与して生成
    const kr: KRStructured = mkKRStructured({
      kind: draft.kind,
      label: draft.label.trim(),
      target: t,
      unit: draft.unit,
      scope: draft.scope,
      baseKey: draft.baseKey,
      owner: draft.owner?.trim() || undefined,
      due: draft.due?.trim() || undefined,
    });

    setDepartments((prev: Department[]) => {
      const next = [...prev];
      const dept = next[dIdx];
      if (!dept) return prev;
      const proj = ensureArray(dept.projects)[pIdx];
      if (!proj) return prev;
      const list = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];
      list.push(kr);
      proj.okrsV2 = list;
      dept.projects![pIdx] = proj;
      next[dIdx] = dept;
      commit(next);
      return next;
    });

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
          プロジェクトに紐づく<strong className="font-semibold">構造化KR</strong>を設定・編集すると、STAGE6の財務シミュレーションに反映されます。
        </p>
        {(!hydrated || scopeCompanyId !== accessCompanyId) && (
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-600">
            サーバーのデータを読み込み中です…
          </div>
        )}
        <div className="mt-6 h-px w-full bg-zinc-200" />
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
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
                const okrsV2 = ensureArray(proj.okrsV2);
                const addKey = keyFor(deptIdx, projIdx);
                const d = draftMap[addKey] ?? emptyDraft;
                const isOpen = !!openAdd[addKey];

                return (
                  <div
                    key={projIdx}
                    className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    {/* プロジェクトヘッダー */}
                    <div className="mb-2 flex items-center justify-between">
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

                      <button
                        onClick={() => toggleAdd(addKey)}
                        disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                        className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                          (!hydrated || scopeCompanyId !== accessCompanyId)
                            ? 'border-zinc-200 bg-zinc-200 text-zinc-500'
                            : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
                        }`}
                      >
                        ＋ 構造化KR
                      </button>
                    </div>

                    {/* 構造化KR 追加フォーム */}
                    {isOpen && (
                      <div className="mb-3 rounded-2xl border border-zinc-200 bg-white p-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">種別（kind）</div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.kind}
                              onChange={(e) => setDraft(addKey, { kind: e.target.value as KRKind })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="ACQ">ACQ（新規獲得）</option>
                              <option value="ARPU">ARPU（単価）</option>
                              <option value="CHURN">CHURN（解約）</option>
                              <option value="COST_FIXED">固定費</option>
                              <option value="COST_VARIABLE">変動費</option>
                              <option value="PERSONNEL">人件費</option>
                              <option value="INVEST">投資</option>
                              <option value="SUCCESS_RATE">成功率</option>
                              <option value="SYNERGY">シナジー</option>
                              <option value="REVENUE">売上Δ</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">単位（unit）</div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.unit}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  unit: e.target.value as Draft['unit'],
                                })
                              }
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="%">%</option>
                              <option value="¥">¥</option>
                              <option value="件">件</option>
                              <option value="人">人</option>
                              <option value="比率">比率</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">スコープ（scope）</div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.scope}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  scope: e.target.value as Draft['scope'],
                                })
                              }
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="company">company</option>
                              <option value="department">department</option>
                              <option value="project">project</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">ベースキー（baseKey）</div>
                            <select
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                              value={d.baseKey}
                              onChange={(e) =>
                                setDraft(addKey, {
                                  baseKey: e.target.value as Draft['baseKey'],
                                })
                              }
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            >
                              <option value="acq">acq</option>
                              <option value="arpu">arpu</option>
                              <option value="churn">churn</option>
                              <option value="fixed_cost">fixed_cost</option>
                              <option value="variable_cost">variable_cost</option>
                              <option value="personnel_cost">personnel_cost</option>
                              <option value="invest">invest</option>
                              <option value="success_rate">success_rate</option>
                              <option value="synergy">synergy</option>
                              <option value="revenue">revenue</option>
                            </select>
                          </div>

                          <div className="space-y-1 md:col-span-2">
                            <div className="text-[11px] text-zinc-600">ラベル</div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="例：オンライン広告で新規200件増"
                              value={d.label}
                              onChange={(e) => setDraft(addKey, { label: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">ターゲット（数値）</div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              inputMode="decimal"
                              placeholder="例：200 / 5 / -10 など"
                              value={d.target}
                              onChange={(e) => setDraft(addKey, { target: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">オーナー（任意）</div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="担当者（メール等）"
                              value={d.owner}
                              onChange={(e) => setDraft(addKey, { owner: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] text-zinc-600">期限（任意 / YYYY-MM）</div>
                            <input
                              className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                              placeholder="2026-03"
                              value={d.due}
                              onChange={(e) => setDraft(addKey, { due: e.target.value })}
                              disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-800 hover:bg-zinc-50"
                            onClick={() => {
                              resetDraft(addKey);
                              toggleAdd(addKey, false);
                            }}
                            disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                          >
                            キャンセル
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
                        構造化KRがありません。「＋ 構造化KR」から追加してください。
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {okrsV2.map((k, i) => {
                          const editing = editIdx === `${deptIdx}:${projIdx}:${i}`;
                          return (
                            <li
                              key={k.id ?? i}
                              className="rounded-2xl border border-zinc-200 bg-white p-3"
                            >
                              {!editing ? (
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                                      {k.kind}
                                    </span>
                                    <span className="text-[14px] text-zinc-900">{k.label}</span>
                                    <span className="text-[13px] text-zinc-600">
                                      ：{k.target}
                                      {k.unit}（scope:{k.scope} / base:{k.baseKey}）
                                    </span>
                                    {k.owner && (
                                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">
                                        {k.owner}
                                      </span>
                                    )}
                                    {k.due && (
                                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">
                                        {k.due}
                                      </span>
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
                                    value={k.kind}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        kind: e.target.value as KRKind,
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  >
                                    <option value="ACQ">ACQ</option>
                                    <option value="ARPU">ARPU</option>
                                    <option value="CHURN">CHURN</option>
                                    <option value="COST_FIXED">COST_FIXED</option>
                                    <option value="COST_VARIABLE">COST_VARIABLE</option>
                                    <option value="PERSONNEL">PERSONNEL</option>
                                    <option value="INVEST">INVEST</option>
                                    <option value="SUCCESS_RATE">SUCCESS_RATE</option>
                                    <option value="SYNERGY">SYNERGY</option>
                                    <option value="REVENUE">REVENUE</option>
                                  </select>

                                  <input
                                    value={k.label ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, { label: e.target.value })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    placeholder="ラベル"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <input
                                    value={String(k.target ?? '')}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        target: Number(e.target.value || 0),
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px]"
                                    inputMode="decimal"
                                    placeholder="ターゲット（数値）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <select
                                    value={k.unit ?? '件'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        unit: e.target.value as Draft['unit'],
                                      })
                                    }
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
                                    value={k.scope ?? 'project'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        scope: e.target.value as Draft['scope'],
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  >
                                    <option value="company">company</option>
                                    <option value="department">department</option>
                                    <option value="project">project</option>
                                  </select>

                                  <select
                                    value={k.baseKey ?? 'acq'}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, {
                                        baseKey: e.target.value as Draft['baseKey'],
                                      })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-2 text-[14px]"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  >
                                    <option value="acq">acq</option>
                                    <option value="arpu">arpu</option>
                                    <option value="churn">churn</option>
                                    <option value="fixed_cost">fixed_cost</option>
                                    <option value="variable_cost">variable_cost</option>
                                    <option value="personnel_cost">personnel_cost</option>
                                    <option value="invest">invest</option>
                                    <option value="success_rate">success_rate</option>
                                    <option value="synergy">synergy</option>
                                    <option value="revenue">revenue</option>
                                  </select>

                                  <input
                                    value={k.owner ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, { owner: e.target.value })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] md:col-span-3"
                                    placeholder="オーナー（任意）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <input
                                    value={k.due ?? ''}
                                    onChange={(e) =>
                                      updateStructuredKR(deptIdx, projIdx, i, { due: e.target.value })
                                    }
                                    className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[14px] md:col-span-2"
                                    placeholder="期限 YYYY-MM（任意）"
                                    disabled={!hydrated || scopeCompanyId !== accessCompanyId}
                                  />

                                  <div className="flex items-center justify-end gap-2 md:col-span-1">
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
