// /app/execution/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import ProjectCard from '@/components/execution/ProjectCard';
import { saveProgressLog } from '@/utils/supabase/strategy';
import { supabase } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';
import { X, Stars, Send, Clock, CheckCircle2 } from 'lucide-react';
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';
import type { Department, Project as ProjectStrict, OKR as OKRStrict } from '@/types/strategy';

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === "1";

/* =========================
 * ユーティリティ
 * ======================= */
const toStrictOKR = (okr: any): OKRStrict => ({
  objective: String(okr?.objective ?? ''),
  keyResults: Array.isArray(okr?.keyResults) ? okr.keyResults.map((k: any) => String(k)) : [],
  owner: okr?.owner ? String(okr.owner) : undefined,
});

// okrsV2 を潰さないため、title だけ正規化して残りは元projを活かす
const toStrictProject = (proj: any): ProjectStrict => ({
  title: String(proj?.title ?? proj?.name ?? ''),
  okrs: Array.isArray(proj?.okrs) ? proj.okrs.map(toStrictOKR) : [],
});

// OKRを一意に指す軽量ID（DB主キーではなく“ログ紐づけ用キー”）
const okrKey = (d: number, p: number, o: number, okr?: any) =>
  (okr && typeof okr.id === 'string' && okr.id.trim()) ? okr.id : `okr-${d}-${p}-${o}`;

/* =========================
 * progress_logs ロード用型（content 版）
 * ======================= */
type LogRow = {
  id?: string;
  created_at?: string;
  content?: string | null;
  score?: number | null;
  status?: string | null;
};

/* =========================
 * 右ドロワー：実行支援パネル
 * ======================= */
function ExecPanel(props: {
  open: boolean;
  onClose: () => void;
  userId?: string;
  deptName: string;
  projectTitle: string;
  objective: string;
  keyResults: string[];
  okrId: string;
}) {
  const { open, onClose, userId, deptName, projectTitle, objective, keyResults, okrId } = props;

  const access = useAccess();
  const canCheckin = !!userId;
  const canFeedback = access.canEditCompany();

  const [tab, setTab] = useState<'checkin' | 'feedback'>('checkin');
  const [progressText, setProgressText] = useState('');
  const [rating, setRating] = useState<number>(0);
  const [helpRequest, setHelpRequest] = useState('');

  const [reviewScore, setReviewScore] = useState<number>(0);
  const [reviewText, setReviewText] = useState('');

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);

  // 履歴ロード（content / score / status 版）
  useEffect(() => {
    const loadLogs = async () => {
      if (!open || !userId || !okrId) return;
      setLoadingLogs(true);
      try {
        const { data, error } = await supabase
          .from('progress_logs')
          .select('id, created_at, content, score, status')
          .eq('user_id', userId)
          .eq('okr_id', okrId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) {
          console.warn('load progress_logs error:', error);
        }
        if (Array.isArray(data)) setLogs(data as LogRow[]);
      } finally {
        setLoadingLogs(false);
      }
    };
    loadLogs();
  }, [open, userId, okrId]);

  // 保存（チェックイン）
  const onSaveCheckin = useCallback(async () => {
    if (!canCheckin || !userId) {
      setNotice('⚠️ ログイン中のみ保存できます。');
      return;
    }
    if (!progressText.trim() && !helpRequest.trim() && !rating) {
      setNotice('⚠️ いずれかを入力してください。');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const composed =
        helpRequest.trim()
          ? `${progressText.trim()}\n\n--- Help ---\n${helpRequest.trim()}`
          : progressText.trim();

      const { error } = await saveProgressLog({
        userId,
        okrId,
        content: composed,
        score: rating || null,
      });
      if (error) throw error;

      setNotice('✅ 記録しました');
      const nowIso = new Date().toISOString();
      setLogs((prev) => [
        {
          id: 'local-' + nowIso,
          created_at: nowIso,
          content: composed,
          score: rating || null,
          status: null,
        },
        ...prev,
      ]);
      setProgressText('');
      setHelpRequest('');
      setRating(0);
    } catch (e: any) {
      setNotice('❌ 保存に失敗しました');
      console.warn('save log error', e?.message || e);
    } finally {
      setSaving(false);
      setTimeout(() => setNotice(''), 2000);
    }
  }, [canCheckin, userId, okrId, progressText, rating, helpRequest]);

  // 保存（フィードバック）
  const onSaveFeedback = useCallback(async () => {
    if (!canFeedback || !userId) {
      setNotice('⚠️ 会社管理権限（Admin/Manager）が必要です。');
      return;
    }
    if (!reviewText.trim() && !reviewScore) {
      setNotice('⚠️ いずれかを入力してください。');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const fbContent = `[FB]\n${reviewText.trim()}`;

      const { error } = await saveProgressLog({
        userId,
        okrId,
        content: fbContent,
        score: reviewScore || null,
      });
      if (error) throw error;

      setNotice('✅ フィードバックを保存しました');
      const nowIso = new Date().toISOString();
      setLogs((prev) => [
        {
          id: 'local-' + nowIso,
          created_at: nowIso,
          content: fbContent,
          score: reviewScore || null,
          status: null,
        },
        ...prev,
      ]);
      setReviewText('');
      setReviewScore(0);
    } catch (e: any) {
      setNotice('❌ 保存に失敗しました');
      console.warn('save feedback error', e?.message || e);
    } finally {
      setSaving(false);
      setTimeout(() => setNotice(''), 2000);
    }
  }, [canFeedback, userId, okrId, reviewText, reviewScore]);

  const StarInput = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n === value ? 0 : n)}
          className={`rounded p-1 transition-colors ${
            value >= n ? 'text-amber-500' : 'text-gray-300'
          } hover:text-amber-600`}
          type="button"
        >
          <Stars className="h-5 w-5" />
        </button>
      ))}
    </div>
  );

  const isFeedback = (row: LogRow) =>
    (row.content || '').startsWith('[FB]');

  const feedbackBody = (row: LogRow) =>
    (row.content || '').replace(/^\[FB]\s*\n?/, '').trim();

  // チェックイン時の「支援依頼」分離表示
  const splitContent = (content: string | null | undefined) => {
    if (!content) return { memo: '', help: '' };
    const [memoPart, helpPart] = content.split('\n\n--- Help ---\n');
    return {
      memo: (memoPart || '').trim(),
      help: (helpPart || '').trim(),
    };
  };

  // Agent Dock 右スペースとの干渉対策
  const [agentDockPx, setAgentDockPx] = useState(0);
  useEffect(() => {
    const readVar = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--agent-dock-w').trim();
      const m = v.match(/(\d+(?:\.\d+)?)\s*px/i);
      setAgentDockPx(m ? Number(m[1]) : 0);
    };
    readVar();
    window.addEventListener('resize', readVar);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(readVar) : null;
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', readVar);
      ro?.disconnect();
    };
  }, []);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed top-0 left-0 bottom-0 z-40 bg-black/10 backdrop-blur-sm"
        style={{ right: agentDockPx }}
        onClick={onClose}
      />
      <aside
        className="fixed top-0 z-50 h-full w-full max-w-xl overflow-y-auto border-l border-black/10 bg-white/90 backdrop-blur-lg shadow-2xl"
        style={{
          right: agentDockPx,
          width: `min(560px, calc(100vw - ${agentDockPx}px))`,
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white/80 px-5 py-4 backdrop-blur-md">
          <div className="space-y-1">
            <div className="text-[11px] text-gray-500 tracking-wide">
              {deptName} / {projectTitle}
            </div>
            <h2 className="text-lg font-semibold tracking-tight">実行支援</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-black/10 bg-white px-2 py-2 text-gray-700 hover:bg-gray-50"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-4">
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-1">
            <button
              className={`px-3 py-1.5 text-sm rounded-lg transition ${
                tab === 'checkin' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-100'
              }`}
              onClick={() => setTab('checkin')}
            >
              チェックイン
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded-lg transition ${
                tab === 'feedback' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-100'
              }`}
              onClick={() => setTab('feedback')}
            >
              フィードバック
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="space-y-6 p-5">
          {/* OKR概要 */}
          <section className="rounded-2xl border border-black/10 bg-white/70 p-4">
            <div className="text-xs font-medium text-gray-600 tracking-wide mb-1">達成目標（O）</div>
            <div className="whitespace-pre-wrap text-[15px]">{objective || '（未設定）'}</div>
            {keyResults?.length ? (
              <>
                <div className="mt-3 text-xs font-medium text-gray-600 tracking-wide">主要な成果（KR）</div>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-800">
                  {keyResults.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {/* チェックイン */}
          {tab === 'checkin' && (
            <>
              <section className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold tracking-tight">進捗メモ</h3>
                  <StarInput value={rating} onChange={setRating} />
                </div>
                <textarea
                  className="h-28 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none"
                  placeholder="例：KR#1 が 60% 達成。◯◯の承認待ち。"
                  value={progressText}
                  onChange={(e) => setProgressText(e.target.value)}
                />
                <div className="mt-4">
                  <label className="mb-1 block text-xs text-gray-600">支援依頼（任意）</label>
                  <textarea
                    className="h-20 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none"
                    placeholder="例：決裁者向け1枚資料のレビューを依頼。"
                    value={helpRequest}
                    onChange={(e) => setHelpRequest(e.target.value)}
                  />
                </div>
              </section>
              <section className="flex items-center gap-2">
                <button
                  onClick={onSaveCheckin}
                  disabled={saving || !userId}
                  className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-black/90 disabled:bg-gray-300"
                >
                  <Send className="h-4 w-4" />
                  {saving ? '保存中…' : '保存'}
                </button>
                {notice && <span className="text-sm text-gray-700">{notice}</span>}
              </section>
            </>
          )}

          {/* フィードバック */}
          {tab === 'feedback' && (
            <>
              <section className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <div className="mb-3 flex items-center justify_between">
                  <div className="text-sm font-semibold tracking-tight">フィードバック</div>
                  <StarInput value={reviewScore} onChange={setReviewScore} />
                </div>
                <textarea
                  className="h-28 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none"
                  placeholder="例：KR#2 の指標定義を明確化すると計測が安定します。"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                />
              </section>
              <section className="flex items-center gap-2">
                <button
                  onClick={onSaveFeedback}
                  disabled={saving || !userId}
                  className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-black/90 disabled:bg-gray-300"
                >
                  <Send className="h-4 w-4" />
                  {saving ? '保存中…' : '保存'}
                </button>
                {notice && <span className="text-sm text-gray-700">{notice}</span>}
              </section>
            </>
          )}

          {/* 履歴 */}
          <section className="rounded-2xl border border-black/10 bg-white/70">
            <div className="flex items-center gap-2 border-b border-black/10 px-4 py-3">
              <Clock className="h-4 w-4 text-gray-600" />
              <h3 className="text-sm font-semibold tracking-tight">履歴</h3>
            </div>
            {loadingLogs ? (
              <div className="px-4 py-5 text-sm text-gray-600">読み込み中…</div>
            ) : logs.length === 0 ? (
              <div className="px-4 py-5 text-sm text-gray-600">まだ履歴がありません。</div>
            ) : (
              <ul className="divide-y divide-black/5">
                {logs.map((row, i) => {
                  const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
                  const fb = isFeedback(row);
                  const body = fb ? feedbackBody(row) : (row.content ?? '');
                  const { memo, help } = splitContent(row.content ?? '');
                  const score = typeof row.score === 'number' ? row.score : null;

                  return (
                    <li key={row.id ?? i} className="px-4 py-3">
                      <div className="mb-1 flex items-center justify-between">
                        <div className="text-xs text-gray-500">{when}</div>
                        <div className="flex items-center gap-2 text-xs text-gray-700">
                          {score && score > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Stars className="h-3 w-3 text-amber-600" />
                              {score}
                            </span>
                          )}
                          <span className="rounded-full bg-gray-100 px-2 py-0.5">
                            {fb ? 'FB' : 'メモ'}
                          </span>
                        </div>
                      </div>
                      {fb ? (
                        <div className="rounded-xl bg-gray-50 p-3 text_sm text-gray-900 whitespace-pre-wrap">
                          {body}
                        </div>
                      ) : (
                        <>
                          {memo && (
                            <div className="text-[15px] text-gray-900 whitespace-pre-wrap">
                              {memo}
                            </div>
                          )}
                          {help && (
                            <div className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                              {help}
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="pb-12" />
        </div>
      </aside>
    </>
  );
}

/* =========================
 * ページ本体
 * ======================= */
export default function ExecutionPage() {
  const { departments, editableCascadeResult } = useStrategyStore() as any;
  const { companyId: scopeCompanyId, hydrated, setCompanyScope } = useStrategyStore();

  const access = useAccess();
  const accessCompanyId: string | undefined =
    (access as any)?.companyId ?? (useStrategyStore.getState().companyId as string | undefined);

  useEffect(() => {
    if (!accessCompanyId) return;
    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      hardResetForCompanySwitch(accessCompanyId);
    } else {
      setCompanyScope(accessCompanyId);
    }
  }, [accessCompanyId, scopeCompanyId, setCompanyScope]);

  useEffect(() => {
    if (!accessCompanyId) return;
    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) return;
      try {
        if (DEBUG) console.log('[execution] 📥 loadAndHydrate 開始', { accessCompanyId });
        await loadAndHydrate(accessCompanyId);
        if (DEBUG) console.log('[execution] ✅ loadAndHydrate 完了');
      } catch (err) {
        // 🐛 FIX: loadAndHydrate may throw if refetch fails
        const errObj = err as any;
        console.error('[execution] ❌ loadAndHydrate error:', {
          message: errObj?.message || String(err),
          code: errObj?.code,
        });
      } finally {
        if (!cancelled) {
          if (DEBUG) console.log('[execution] 🏁 loadAndHydrate effect 終了');
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [accessCompanyId, hydrated, scopeCompanyId]);

  useAutoSave([scopeCompanyId]);
  const user = useUserStore((s) => s.user);

  const cascade: Department[] = useMemo(() => {
    const base: Department[] = Array.isArray(departments) ? (departments as Department[]) : [];
    const alt: Department[] = Array.isArray(editableCascadeResult) ? (editableCascadeResult as Department[]) : [];

    if (base.length === 0) return alt;

    return base.map((d, i) => {
      const a = alt[i];
      return {
        ...d,
        name: d.name ?? a?.name,
        mission: d.mission ?? a?.mission,
        strategy: d.strategy ?? a?.strategy,
      };
    });
  }, [editableCascadeResult, departments]);

  const [selected, setSelected] = useState<{ d: number; p: number; o: number } | null>(null);

  const selection = useMemo(() => {
    if (!selected) return null;
    const dept = cascade[selected.d];
    const proj = dept?.projects?.[selected.p];

    if (!dept || !proj) return null;

    const okr = proj?.okrs?.[selected.o];
    const okrsV2 = Array.isArray((proj as any)?.okrsV2) ? ((proj as any).okrsV2 as any[]) : [];
    const v2Labels = okrsV2.map((k) => String(k?.label ?? '')).filter(Boolean);

    let objective = '';
    let keyResults: string[] = [];

    if (okr) {
      const strictO = toStrictOKR(okr);
      objective = strictO.objective || (v2Labels.length ? '構造化KRに基づく実行（自動生成）' : '');
      keyResults = [...strictO.keyResults];
    } else if (v2Labels.length) {
      objective = '構造化KRに基づく実行（自動生成）';
      keyResults = [];
    } else {
      return null;
    }

    if (v2Labels.length) {
      keyResults = [...keyResults, ...v2Labels];
    }

    const strictProj = toStrictProject(proj);

    return {
      deptName: dept?.name ?? '',
      projectTitle: strictProj.title,
      objective,
      keyResults,
      okrId: okrKey(selected.d, selected.p, selected.o, okr ?? { id: undefined }),
    };
  }, [selected, cascade]);

  const isHydrating = !hydrated || scopeCompanyId !== accessCompanyId;

  const cards = useMemo(() => {
    const items: JSX.Element[] = [];
    cascade.forEach((dept, di) => {
      (dept?.projects ?? []).forEach((proj, pi) => {
        const strictProj = toStrictProject(proj);
        const okrs = Array.isArray(proj?.okrs) ? proj.okrs : [];
        const okrsV2 = Array.isArray((proj as any)?.okrsV2) ? ((proj as any).okrsV2 as any[]) : [];

        const projForCard = { ...(proj as any), title: strictProj.title };

        if (okrs.length > 0) {
          okrs.forEach((okr, oi) => {
            items.push(
              <ProjectCard
                key={`${dept?.name ?? 'dept'}-${strictProj.title}-okr-${oi}`}
                deptName={dept?.name ?? ''}
                project={projForCard as any}
                onClick={() => {
                  if (isHydrating) return;
                  setSelected({ d: di, p: pi, o: oi });
                }}
              />
            );
          });
          return;
        }

        if (okrsV2.length > 0) {
          items.push(
            <ProjectCard
              key={`${dept?.name ?? 'dept'}-${strictProj.title}-v2`}
              deptName={dept?.name ?? ''}
              project={projForCard as any}
              onClick={() => {
                if (isHydrating) return;
                setSelected({ d: di, p: pi, o: 0 });
              }}
            />
          );
          return;
        }

        items.push(
          <ProjectCard
            key={`${dept?.name ?? 'dept'}-${strictProj.title}-no-okr`}
            deptName={dept?.name ?? ''}
            project={projForCard as any}
            onClick={() => {}}
          />
        );
      });
    });
    return items;
  }, [cascade, isHydrating]);

  return (
    <main className="min-h-screen bg-gray-50 p-6 avoid-agent-dock">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">STAGE5 実行計画支援</h1>
          {isHydrating && (
            <div className="mt-2 text-sm text-gray-500">サーバーのデータを読み込み中です…</div>
          )}
        </div>
        {selection ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800">
            <CheckCircle2 className="h-3 w-3" />
            実
          </span>
        ) : null}
      </header>

      {/* モバイル */}
      <div className="md:hidden -mx-6 px-6">
        <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
          {cards.length ? (
            cards.map((el, i) => (
              <div
                key={`m-${i}`}
                className="min-w-[300px] max-w-[360px] shrink-0 snap-start"
              >
                {el}
              </div>
            ))
          ) : (
            !isHydrating && (
              <div className="text-sm text-gray-600">表示できる実行計画がありません。</div>
            )
          )}
        </div>
      </div>

      {/* md以上 */}
      <div className="hidden md:grid gap-6 md:[grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {cards.length ? (
          cards
        ) : (
          !isHydrating && (
            <div className="text-sm text-gray-600">表示できる実行計画がありません。</div>
          )
        )}
      </div>

      <ExecPanel
        open={!!selection}
        onClose={() => setSelected(null)}
        userId={user?.id}
        deptName={selection?.deptName ?? ''}
        projectTitle={selection?.projectTitle ?? ''}
        objective={selection?.objective ?? ''}
        keyResults={selection?.keyResults ?? []}
        okrId={selection?.okrId ?? ''}
      />
    </main>
  );
}
