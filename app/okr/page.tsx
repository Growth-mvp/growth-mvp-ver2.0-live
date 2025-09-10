// /app/okr/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase';
import { ChevronDown, ChevronRight } from 'lucide-react';

/* ========================
 *  ローカル型（storeに依存し過ぎない）
 * ====================== */
type KR = string;
type OKR = { objective: string; keyResults: KR[]; owner?: string; due?: string; status?: string };
type Project = { title?: string; name?: string; okrs?: OKR[] };
type Department = { name?: string; projects?: Project[] };

/* ==========================================================
 *  保存ステータス & 今すぐ保存ボタン（フッティング・ドック）
 * ======================================================== */
function SaveDock() {
  const state = useStrategyStore() as any;
  const { user } = useUserStore();
  const departments = state?.departments ?? [];

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [formattedSavedAt, setFormattedSavedAt] = useState<string>('');
  const [error, setError] = useState('');
  const savedHashRef = useRef<string>('');

  const currentHash = useMemo(() => JSON.stringify(departments), [departments]);

  useEffect(() => {
    setDirty(savedHashRef.current !== currentHash);
  }, [currentHash]);

  useEffect(() => {
    if (!savedHashRef.current) {
      savedHashRef.current = currentHash;
      setDirty(false);
    }
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
    if (!lastSavedAt) {
      setFormattedSavedAt('');
      return;
    }
    try {
      const fmt = new Intl.DateTimeFormat('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Tokyo',
      }).format(lastSavedAt);
      setFormattedSavedAt(fmt);
    } catch {
      setFormattedSavedAt('');
    }
  }, [lastSavedAt]);

  const saveNow = useCallback(async () => {
    if (!user?.id) return;
    setSaving(true);
    setError('');
    try {
      await saveStrategyData(useStrategyStore.getState() as any, user.id);
      savedHashRef.current = JSON.stringify((useStrategyStore.getState() as any).departments ?? []);
      setLastSavedAt(Date.now());
      setDirty(false);
    } catch (e: any) {
      setError('保存に失敗しました');
      console.warn('SaveDock save error:', e?.message || e);
    } finally {
      setSaving(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!saving) saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow, saving]);

  if (!hydrated) {
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <div className="rounded-2xl border border-zinc-200 bg-white/95 backdrop-blur px-3 py-2 shadow">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-2 w-2 rounded-full bg-zinc-300" />
            <span className="text-xs text-zinc-600">状態確認中…</span>
            <span className="text-xs text-zinc-400">|</span>
            <span className="text-xs text-zinc-800">保存ステータス取得中…</span>
            <button
              disabled
              className="ml-2 inline-flex items-center rounded-full h-8 px-3 text-xs font-semibold bg-zinc-200 text-zinc-500 cursor-not-allowed"
              title="今すぐ保存（⌘/Ctrl+S）"
            >
              今すぐ保存
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canSave = !saving && online === true && dirty && !!user?.id;

  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div className="rounded-2xl border border-zinc-200 bg-white/95 backdrop-blur px-3 py-2 shadow">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              online === true ? 'bg-emerald-500' : online === false ? 'bg-amber-500' : 'bg-zinc-300'
            }`}
          />
          <span className="text-xs text-zinc-600">
            {online === true ? 'オンライン' : online === false ? 'オフライン（保存は保留）' : '状態確認中…'}
          </span>
          <span className="text-xs text-zinc-400">|</span>
          <span className="text-xs text-zinc-800">
            {saving
              ? '保存中…'
              : dirty
              ? '未保存の変更あり'
              : formattedSavedAt
              ? `保存済み（${formattedSavedAt}）`
              : '保存済み'}
          </span>
          <button
            onClick={saveNow}
            disabled={!canSave}
            className={`ml-2 inline-flex items-center rounded-full h-8 px-3 text-xs font-semibold transition ${
              canSave
                ? 'bg-black text-white hover:opacity-90 active:opacity-85'
                : 'bg-zinc-200 text-zinc-500 cursor-not-allowed'
            }`}
            title="今すぐ保存（⌘/Ctrl+S）"
          >
            今すぐ保存
          </button>
        </div>
        {error && <div className="mt-1 text-[11px] text-rose-600">{error}</div>}
      </div>
    </div>
  );
}

/* =========================
 *      メイン：OKRページ
 * ======================= */
export default function OKRPage() {
  const { departments, setDepartments } = useStrategyStore() as any;
  const { user } = useUserStore();

  const cascade: Department[] = useMemo(
    () => (Array.isArray(departments) ? (departments as Department[]) : []),
    [departments]
  );

  /* ---------- デバウンス保存 ---------- */
  const timerRef = useRef<any>(null);
  const persistDebounced = (nextDeps: Department[]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        if (!user?.id) return;
        const state = useStrategyStore.getState() as any;
        await saveStrategyData({ ...state, departments: nextDeps }, user.id);
      } catch (e) {
        console.warn('save departments failed', e);
      }
    }, 500);
  };

  const commit = (next: Department[]) => {
    // 不変更新を明示化（Zustandでの変更検知を確実に）
    const cloned = next.map(d => ({
      ...d,
      projects: Array.isArray(d.projects)
        ? d.projects.map(p => ({ ...p, okrs: Array.isArray(p.okrs) ? p.okrs.map(o => ({ ...o, keyResults: [...(o.keyResults ?? [])] })) : [] }))
        : []
    }));
    setDepartments(cloned);
    persistDebounced(cloned);
  };

  /* ---------- ユーティリティ ---------- */
  const ensureArray = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  const projTitle = (p?: Project, idx?: number) => p?.title ?? p?.name ?? `Project ${String((idx ?? 0) + 1)}`;
  const isOKRComplete = (o: OKR) =>
    (o?.objective ?? '').trim().length > 0 &&
    Array.isArray(o?.keyResults) &&
    o.keyResults.filter((k) => (k ?? '').trim()).length >= 2;

  /* ---------- 折りたたみ ---------- */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleProject = (dIdx: number, pIdx: number) => {
    const key = `${dIdx}:${pIdx}`;
    setCollapsed((m) => ({ ...m, [key]: !m[key] }));
  };

  /* ---------- ネスト更新ヘルパ ---------- */
  const setDept = (dIdx: number, mapper: (dept: Department) => Department) => {
    const next = cascade.map((d, i) => (i === dIdx ? mapper({ ...d }) : d));
    commit(next);
  };

  const setProject = (dIdx: number, pIdx: number, mapper: (p: Project) => Project) =>
    setDept(dIdx, (dept) => {
      const projects = ensureArray(dept.projects).map((p, i) => (i === pIdx ? mapper({ ...p }) : p));
      return { ...dept, projects };
    });

  const setOKR = (dIdx: number, pIdx: number, oIdx: number, mapper: (o: OKR) => OKR) =>
    setProject(dIdx, pIdx, (p) => {
      const okrs = ensureArray(p.okrs).map((o, i) => (i === oIdx ? mapper({ ...o }) : o));
      return { ...p, okrs };
    });

  /* ---------- 部門：プロジェクト操作 ---------- */
  const addProject = (dIdx: number) =>
    setDept(dIdx, (dept) => {
      const projects = ensureArray(dept.projects);
      const nextProjects = [...projects, { title: '', okrs: [] }];
      return { ...dept, projects: nextProjects };
    });

  const deleteProject = (dIdx: number, pIdx: number) =>
    setDept(dIdx, (dept) => {
      const projects = ensureArray(dept.projects).filter((_, i) => i !== pIdx);
      return { ...dept, projects };
    });

  const renameProject = (dIdx: number, pIdx: number, value: string) =>
    setProject(dIdx, pIdx, (p) => ({ ...p, title: value }));

  const moveProject = (dIdx: number, pIdx: number, dir: -1 | 1) =>
    setDept(dIdx, (dept) => {
      const list = ensureArray(dept.projects);
      const j = pIdx + dir;
      if (j < 0 || j >= list.length) return dept;
      const copy = [...list];
      const [item] = copy.splice(pIdx, 1);
      copy.splice(j, 0, item);
      return { ...dept, projects: copy };
    });

  /* ---------- プロジェクト：OKR操作 ---------- */
  const addOKR = (dIdx: number, pIdx: number) =>
    setProject(dIdx, pIdx, (p) => ({
      ...p,
      okrs: [...ensureArray(p.okrs), { objective: '', keyResults: [''], owner: '', status: 'draft' }],
    }));

  const deleteOKR = (dIdx: number, pIdx: number, oIdx: number) =>
    setProject(dIdx, pIdx, (p) => ({ ...p, okrs: ensureArray(p.okrs).filter((_, i) => i !== oIdx) }));

  const moveOKR = (dIdx: number, pIdx: number, oIdx: number, dir: -1 | 1) =>
    setProject(dIdx, pIdx, (p) => {
      const list = ensureArray(p.okrs);
      const j = oIdx + dir;
      if (j < 0 || j >= list.length) return p;
      const copy = [...list];
      const [item] = copy.splice(oIdx, 1);
      copy.splice(j, 0, item);
      return { ...p, okrs: copy };
    });

  const updateObjective = (dIdx: number, pIdx: number, oIdx: number, value: string) =>
    setOKR(dIdx, pIdx, oIdx, (o) => ({ ...o, objective: value }));

  const updateOwner = (dIdx: number, pIdx: number, oIdx: number, value: string) =>
    setOKR(dIdx, pIdx, oIdx, (o) => ({ ...o, owner: value }));

  const updateStatus = (dIdx: number, pIdx: number, oIdx: number, value: string) =>
    setOKR(dIdx, pIdx, oIdx, (o) => ({ ...o, status: value }));

  const updateDue = (dIdx: number, pIdx: number, oIdx: number, value: string) =>
    setOKR(dIdx, pIdx, oIdx, (o) => ({ ...o, due: value }));

  /* ---------- OKR：KR操作 ---------- */
  const addKR = (dIdx: number, pIdx: number, oIdx: number) =>
    setOKR(dIdx, pIdx, oIdx, (o) => ({ ...o, keyResults: [...ensureArray(o.keyResults), ''] }));

  const deleteKR = (dIdx: number, pIdx: number, oIdx: number, kIdx: number) =>
    setOKR(dIdx, pIdx, oIdx, (o) => ({ ...o, keyResults: ensureArray(o.keyResults).filter((_, i) => i !== kIdx) }));

  const moveKR = (dIdx: number, pIdx: number, oIdx: number, kIdx: number, dir: -1 | 1) =>
    setOKR(dIdx, pIdx, oIdx, (o) => {
      const list = ensureArray(o.keyResults);
      const j = kIdx + dir;
      if (j < 0 || j >= list.length) return o;
      const copy = [...list];
      const [item] = copy.splice(kIdx, 1);
      copy.splice(j, 0, item);
      return { ...o, keyResults: copy };
    });

  const updateKR = (dIdx: number, pIdx: number, oIdx: number, kIdx: number, value: string) =>
    setOKR(dIdx, pIdx, oIdx, (o) => {
      const copy = [...ensureArray(o.keyResults)];
      copy[kIdx] = value;
      return { ...o, keyResults: copy };
    });

  /* ---------- Render ---------- */
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900">STAGE４ 実行計画策定</h1>
        <p className="text-[14px] text-zinc-600">部門戦略をベースにプロジェクト・OKRを設定してください。変更は自動保存されます。</p>
        <div className="mt-6 h-px w-full bg-zinc-200" />
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {cascade.map((dept: Department, deptIdx: number) => {
          const projects = ensureArray(dept.projects);
          return (
            <section key={deptIdx} className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-zinc-900 tracking-tight">{dept?.name ?? '部門'}</h2>
                <button
                  onClick={() => addProject(deptIdx)}
                  className="inline-flex items-center justify-center rounded-full h-9 px-4 text-[13px] font-medium bg-black text-white hover:opacity-90 active:opacity-85"
                  title="プロジェクトを追加"
                >
                  プロジェクトを追加
                </button>
              </div>

              {projects.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
                  プロジェクトがありません。「プロジェクトを追加」から始めてください。
                </div>
              )}

              {projects.map((proj: Project, projIdx: number) => {
                const key = `${deptIdx}:${projIdx}`;
                const isCollapsed = !!collapsed[key];
                const okrs = ensureArray(proj.okrs);

                return (
                  <div key={projIdx} className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    {/* プロジェクトヘッダー */}
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleProject(deptIdx, projIdx)}
                          className="rounded-full border border-zinc-200 bg-white p-1.5 text-zinc-700 hover:bg-white/90"
                          title={isCollapsed ? '展開' : '折りたたむ'}
                        >
                          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <input
                          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-4 focus:ring-zinc-200"
                          value={projTitle(proj, projIdx)}
                          onChange={(e) => renameProject(deptIdx, projIdx, e.target.value)}
                          placeholder="プロジェクト名"
                        />
                      </div>

                      <div className="flex items-center gap-2 text-[13px]">
                        <button
                          onClick={() => moveProject(deptIdx, projIdx, -1)}
                          disabled={projIdx === 0}
                          className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 disabled:opacity-40"
                          title="上へ"
                        >
                          上
                        </button>
                        <button
                          onClick={() => moveProject(deptIdx, projIdx, +1)}
                          disabled={projIdx === projects.length - 1}
                          className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 disabled:opacity-40"
                          title="下へ"
                        >
                          下
                        </button>
                        <button
                          onClick={() => deleteProject(deptIdx, projIdx)}
                          className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-rose-600 hover:bg-rose-50"
                          title="削除"
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    {/* 折りたたみ中は内容を非表示 */}
                    {isCollapsed ? null : (
                      <>
                        {okrs.length === 0 && (
                          <div className="mb-3 rounded-2xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">
                            OKRがありません。「OKRを追加」を押してください。
                          </div>
                        )}

                        {okrs.map((okr: OKR, okrIdx: number) => (
                          <div key={okrIdx} className="mb-3 rounded-2xl border border-zinc-200 bg-white p-4">
                            {/* 完成度表示 + 並び替え/削除 */}
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-[12px] font-medium text-zinc-600">
                                {isOKRComplete(okr) ? 'Objective + KR(2以上) が入力されています' : 'Objective または KR が不足しています'}
                              </span>
                              <div className="flex items-center gap-2 text-[13px]">
                                <button
                                  onClick={() => moveOKR(deptIdx, projIdx, okrIdx, -1)}
                                  disabled={okrIdx === 0}
                                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-700 disabled:opacity-40"
                                  title="上へ"
                                >
                                  上
                                </button>
                                <button
                                  onClick={() => moveOKR(deptIdx, projIdx, okrIdx, +1)}
                                  disabled={okrIdx === okrs.length - 1}
                                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-700 disabled:opacity-40"
                                  title="下へ"
                                >
                                  下
                                </button>
                                <button
                                  onClick={() => deleteOKR(deptIdx, projIdx, okrIdx)}
                                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-rose-600 hover:bg-rose-50"
                                  title="このOKRを削除"
                                >
                                  削除
                                </button>
                              </div>
                            </div>

                            {/* Objective */}
                            <label className="mb-1 block text-[12px] font-medium text-zinc-700">Objective</label>
                            <input
                              type="text"
                              value={okr.objective ?? ''}
                              onChange={(e) => updateObjective(deptIdx, projIdx, okrIdx, e.target.value)}
                              placeholder="例：新規顧客獲得で持続可能な成長軌道に乗せる"
                              className="mb-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-4 focus:ring-zinc-200"
                            />

                            {/* Key Results */}
                            <label className="mb-1 block text-[12px] font-medium text-zinc-700">Key Results</label>
                            {(okr.keyResults ?? []).map((kr: KR, krIdx: number) => (
                              <div key={krIdx} className="mb-1.5 flex items-center gap-2">
                                <input
                                  type="text"
                                  value={kr ?? ''}
                                  onChange={(e) => updateKR(deptIdx, projIdx, okrIdx, krIdx, e.target.value)}
                                  placeholder="例：月間MQLを120件に増やす"
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-4 focus:ring-zinc-200"
                                />
                                <div className="flex items-center gap-2 text-[13px]">
                                  <button
                                    onClick={() => moveKR(deptIdx, projIdx, okrIdx, krIdx, -1)}
                                    disabled={krIdx === 0}
                                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-700 disabled:opacity-40"
                                    title="上へ"
                                  >
                                    上
                                  </button>
                                  <button
                                    onClick={() => moveKR(deptIdx, projIdx, okrIdx, krIdx, +1)}
                                    disabled={krIdx === (okr.keyResults?.length || 1) - 1}
                                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-700 disabled:opacity-40"
                                    title="下へ"
                                  >
                                    下
                                  </button>
                                  <button
                                    onClick={() => deleteKR(deptIdx, projIdx, okrIdx, krIdx)}
                                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-rose-600 hover:bg-rose-50"
                                    title="削除"
                                  >
                                    削除
                                  </button>
                                </div>
                              </div>
                            ))}

                            <button
                              onClick={() => addKR(deptIdx, projIdx, okrIdx)}
                              className="mt-2 inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-medium text-zinc-800 hover:bg-zinc-100"
                            >
                              + Key Result を追加
                            </button>

                            {/* Owner / Due / Status */}
                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                              <div>
                                <label className="mb-1 block text-[12px] font-medium text-zinc-700">Owner</label>
                                <input
                                  type="text"
                                  value={okr.owner ?? ''}
                                  onChange={(e) => updateOwner(deptIdx, projIdx, okrIdx, e.target.value)}
                                  placeholder="担当者名"
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-4 focus:ring-zinc-200"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[12px] font-medium text-zinc-700">Due（任意）</label>
                                <input
                                  type="date"
                                  value={okr.due ?? ''}
                                  onChange={(e) => updateDue(deptIdx, projIdx, okrIdx, e.target.value)}
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-4 focus:ring-zinc-200"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[12px] font-medium text-zinc-700">Status（任意）</label>
                                <select
                                  value={okr.status ?? 'draft'}
                                  onChange={(e) => updateStatus(deptIdx, projIdx, okrIdx, e.target.value)}
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[14px] focus:outline-none focus:ring-4 focus:ring-zinc-200"
                                >
                                  <option value="draft">draft</option>
                                  <option value="active">active</option>
                                  <option value="done">done</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}

                        <button
                          onClick={() => addOKR(deptIdx, projIdx)}
                          className="mt-2 inline-flex items-center rounded-full h-9 px-4 text-[13px] font-medium text-zinc-800 hover:bg-zinc-100"
                        >
                          + OKRを追加
                        </button>
                      </>
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
