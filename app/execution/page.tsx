// /app/execution/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import ProjectCard from '@/components/execution/ProjectCard';
import { saveProgressLog, supabase } from '@/utils/supabase';
import { useUserStore } from '@/store/userStore';
import { X, Stars, Send, Clock, CheckCircle2, Lock } from 'lucide-react';

// アクセス制御（company_members.role が唯一の真実）
import { useAccess } from '@/utils/access';

// ★ 追加：安定化ユーティリティ（会社スコープ確立・初期ロード）
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';

// ★ 追加：保存の一本化フック（deps必須）
import { useAutoSave } from '@/hooks/useAutoSave';

// 公式型（最低限）
import type { Department, Project as ProjectStrict, OKR as OKRStrict } from '@/types/strategy';

/* =========================
 * ユーティリティ
 * ======================= */
const toStrictOKR = (okr: any): OKRStrict => ({
  objective: String(okr?.objective ?? ''),
  keyResults: Array.isArray(okr?.keyResults) ? okr.keyResults.map((k: any) => String(k)) : [],
  owner: okr?.owner ? String(okr.owner) : undefined,
});

const toStrictProject = (proj: any): ProjectStrict => ({
  title: String(proj?.title ?? proj?.name ?? ''),
  okrs: Array.isArray(proj?.okrs) ? proj.okrs.map(toStrictOKR) : [],
});

// OKRを一意に指す軽量ID（DB主キーではなく“ログ紐づけ用キー”）
// 並び替え耐性：OKR に安定 id があればそれを優先
const okrKey = (d: number, p: number, o: number, okr?: any) =>
  (okr && typeof okr.id === 'string' && okr.id.trim()) ? okr.id : `okr-${d}-${p}-${o}`;

/* =========================
 * 履歴Row型（progress_logs 取得）
 * ======================= */
type LogRow = {
  id?: string;
  created_at?: string;
  progress_text?: string;
  rating?: number | null;
  rating_comment?: string;
  advice?: string;
  help_request?: string;
  department?: string;
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

  // アクセス判定（company_members.role 起点）
  const access = useAccess();
  const canCheckin = !!userId;                 // 進捗メモはログイン者なら可
  const canFeedback = access.canEditCompany(); // 会社編集可(Admin/Manager 以上)

  // タブ
  const [tab, setTab] = useState<'checkin' | 'feedback'>('checkin');

  // --- チェックイン 入力 ---
  const [progressText, setProgressText] = useState('');
  const [rating, setRating] = useState<number>(0); // 0=未設定
  const [helpRequest, setHelpRequest] = useState('');

  // --- フィードバック 入力 ---
  const [reviewScore, setReviewScore] = useState<number>(0);
  const [reviewText, setReviewText] = useState('');

  // 共通
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);

  // 履歴ロード（ユーザー×OKR 単位）
  useEffect(() => {
    const loadLogs = async () => {
      if (!open || !userId || !okrId) return;
      setLoadingLogs(true);
      try {
        const { data, error } = await supabase
          .from('progress_logs')
          .select('id, created_at, progress_text, rating, rating_comment, advice, help_request, department')
          .eq('user_id', userId)
          .eq('okr_id', okrId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) {
          console.warn('load progress_logs error:', error);
        }
        if (Array.isArray(data)) setLogs(data as any[]);
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
      await saveProgressLog(userId, okrId, {
        progressText: progressText.trim(),
        rating: rating || undefined,
        ratingComment: '', // シンプル化
        advice: '',        // シンプル化
        helpRequest: helpRequest.trim(),
        department: deptName,
      });
      setNotice('✅ 記録しました');
      const nowIso = new Date().toISOString();
      setLogs((prev) => [
        {
          id: 'local-' + nowIso + '-' + Math.random().toString(36).slice(2, 8),
          created_at: nowIso,
          progress_text: progressText.trim(),
          rating: rating || null,
          rating_comment: '',
          advice: '',
          help_request: helpRequest.trim(),
          department: deptName,
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
      setTimeout(() => setNotice(''), 2200);
    }
  }, [canCheckin, userId, okrId, progressText, rating, helpRequest, deptName]);

  // 保存（フィードバック＝会社編集可のみ）
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
      const fbComment = `[FB]\n${reviewText.trim()}`;
      await saveProgressLog(userId, okrId, {
        progressText: '',
        rating: reviewScore || undefined,
        ratingComment: fbComment,
        advice: '',
        helpRequest: '',
        department: deptName,
      });

      setNotice('✅ フィードバックを保存しました');
      const nowIso = new Date().toISOString();
      setLogs((prev) => [
        {
          id: 'local-' + nowIso + '-' + Math.random().toString(36).slice(2, 8),
          created_at: nowIso,
          progress_text: '',
          rating: reviewScore || null,
          rating_comment: fbComment,
          advice: '',
          help_request: '',
          department: deptName,
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
      setTimeout(() => setNotice(''), 2200);
    }
  }, [canFeedback, userId, okrId, reviewText, reviewScore, deptName]);

  // 星コンポーネント（最小）
  const StarInput = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n === value ? 0 : n)}
          className={`rounded p-1 transition-colors ${value >= n ? 'text-amber-500' : 'text-gray-300'} hover:text-amber-600`}
          title={`${n}`}
          aria-label={`rating ${n}`}
          type="button"
        >
          <Stars className="h-5 w-5" />
        </button>
      ))}
    </div>
  );

  // [FB] 解析（簡易）
  const parseFeedback = (row: LogRow) => {
    const raw = row.rating_comment || '';
    if (!raw.startsWith('[FB]')) return null;
    const text = raw.replace(/^\[FB]\s*\n?/, '');
    return { text: text.trim() };
  };

  // 右ドロワーの右オフセット（AIエージェント分）
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
      {/* 背景オーバーレイ */}
      <div
        className="fixed top-0 left-0 bottom-0 z-40 bg-black/10 backdrop-blur-sm"
        style={{ right: agentDockPx }}
        onClick={onClose}
      />

      {/* 右ドロワー */}
      <aside
        className="fixed top-0 z-50 h-full w-full max-w-xl overflow-y-auto border-l border-black/10 bg-white/90 backdrop-blur-lg shadow-2xl"
        style={{
          right: agentDockPx,
          width: `min(560px, calc(100vw - ${agentDockPx}px))`,
        }}
      >
        {/* ヘッダー */}
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
            aria-label="close"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* セグメント（タブ） */}
        <div className="px-5 pt-4">
          <div className="inline-flex rounded-xl border border-black/10 bg-white p-1">
            <button
              className={`px-3 py-1.5 text-sm rounded-lg transition ${tab === 'checkin' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-100'}`}
              onClick={() => setTab('checkin')}
              type="button"
            >
              チェックイン
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded-lg transition ${tab === 'feedback' ? 'bg-gray-900 text-white' : 'text-gray-800 hover:bg-gray-100'}`}
              onClick={() => setTab('feedback')}
              type="button"
            >
              フィードバック
            </button>
          </div>
        </div>

        {/* 本文 */}
        <div className="space-y-6 p-5">
          {/* OKR 概要 */}
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

          {/* チェックイン（全ログインユーザー可） */}
          {tab === 'checkin' && (
            <>
              {!canCheckin && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  閲覧のみ：ログインするとチェックインできます。
                </div>
              )}
              <section className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold tracking-tight">進捗メモ</h3>
                  <StarInput value={rating} onChange={setRating} />
                </div>
                <textarea
                  className="h-28 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="例：KR#1 が 60% 達成。◯◯の承認待ち。"
                  value={progressText}
                  onChange={(e) => setProgressText(e.target.value)}
                  readOnly={!canCheckin}
                />
                <div className="mt-4">
                  <label className="mb-1 block text-xs text-gray-600">支援依頼（任意）</label>
                  <textarea
                    className="h-20 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                    placeholder="例：決裁者向け1枚資料のレビューを依頼。"
                    value={helpRequest}
                    onChange={(e) => setHelpRequest(e.target.value)}
                    readOnly={!canCheckin}
                  />
                </div>
              </section>

              <section className="flex items-center gap-2">
                <button
                  onClick={onSaveCheckin}
                  disabled={saving || !userId || !canCheckin}
                  className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-black/90 disabled:bg-gray-300"
                  type="button"
                >
                  <Send className="h-4 w-4" />
                  {saving ? '保存中…' : '保存'}
                </button>
                {notice && <span className="text-sm text-gray-700">{notice}</span>}
              </section>
            </>
          )}

          {/* フィードバック（会社編集可） */}
          {tab === 'feedback' && (
            <>
              {!canFeedback && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  閲覧のみ：会社管理権限（Admin/Manager）のみフィードバックを登録できます。
                </div>
              )}
              <section className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-semibold tracking-tight">フィードバック</div>
                  <StarInput value={reviewScore} onChange={setReviewScore} />
                </div>
                <textarea
                  className="h-28 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="例：KR#2 の指標定義を明確化すると計測が安定します。"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  readOnly={!canFeedback}
                />
              </section>

              <section className="flex items-center gap-2">
                <button
                  onClick={onSaveFeedback}
                  disabled={saving || !userId || !canFeedback}
                  className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-black/90 disabled:bg-gray-300"
                  type="button"
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
                  const fb = parseFeedback(row);
                  const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
                  return (
                    <li key={row.id ?? i} className="px-4 py-3">
                      <div className="mb-1 flex items-center justify-between">
                        <div className="text-xs text-gray-500">{when}</div>
                        <div className="flex items-center gap-2 text-xs text-gray-700">
                          {typeof row.rating === 'number' && row.rating! > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Stars className="h-3 w-3 text-amber-600" />
                              {row.rating}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-gray-100 px-2 py-0.5">
                            {fb ? 'FB' : 'メモ'}
                          </span>
                        </div>
                      </div>

                      {fb ? (
                        <div className="rounded-xl bg-gray-50 p-3 text-sm text-gray-900 whitespace-pre-wrap">
                          {fb.text}
                        </div>
                      ) : (
                        <>
                          {row.progress_text ? (
                            <div className="text-[15px] text-gray-900 whitespace-pre-wrap">
                              {row.progress_text}
                            </div>
                          ) : null}
                          {row.help_request ? (
                            <div className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                              {row.help_request}
                            </div>
                          ) : null}
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
  // store：スコープ・hydration 制御を利用
  const { departments, editableCascadeResult } = useStrategyStore() as any;

  // 会社スコープ制御
  const {
    companyId: scopeCompanyId,
    hydrated,
    setCompanyScope,
  } = useStrategyStore();

  // アクセス情報（companyId は access 側を優先）
  const access = useAccess();
  const accessCompanyId: string | undefined =
    (access as any)?.companyId ?? (useStrategyStore.getState().companyId as string | undefined);

  // 初期ロード（会社切替時の完全リセット＋loadAndHydrate）
  useEffect(() => {
    if (!accessCompanyId) return;
    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      // 会社切替：完全リセット＋スコープ更新
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

      const load = async () => {
        await loadAndHydrate(accessCompanyId);
      };

      const timer = setTimeout(async () => {
        try {
          await loadAndHydrate(accessCompanyId);
        } catch { /* silent */ }
      }, 7000);

      try {
        await load();
      } finally {
        clearTimeout(timer);
      }

      if (cancelled) return;
    };

    run();
    return () => { cancelled = true; };
  }, [accessCompanyId, hydrated, scopeCompanyId]);

  // 最低限の useAutoSave（deps必須・このページでは表示の一貫性担保用）
  useAutoSave([scopeCompanyId]);

  // store: user はそのまま。companyId は不要（RLS 側で付与想定）
  const user = useUserStore((s) => s.user);

  // 表示用カスケード（編集可能結果 or departments）
  const cascade: Department[] = useMemo(() => {
    if (Array.isArray(editableCascadeResult)) return editableCascadeResult as Department[];
    if (Array.isArray(departments)) return departments as Department[];
    return [];
  }, [editableCascadeResult, departments]);

  const [selected, setSelected] = useState<{ d: number; p: number; o: number } | null>(null);

  const selection = useMemo(() => {
    if (!selected) return null;
    const dept = cascade[selected.d];
    const proj = dept?.projects?.[selected.p];
    const okr = proj?.okrs?.[selected.o];
    if (!dept || !proj || !okr) return null;
    const strictProj = toStrictProject(proj);
    const strictOkr = toStrictOKR(okr);
    return {
      deptName: dept?.name ?? '',
      projectTitle: strictProj.title,
      objective: strictOkr.objective,
      keyResults: strictOkr.keyResults,
      okrId: okrKey(selected.d, selected.p, selected.o, okr),
    };
  }, [selected, cascade]);

  // Hydration 状態
  const isHydrating = !hydrated || scopeCompanyId !== accessCompanyId;

  return (
    <main className="min-h-screen bg-gray-50 p-6 avoid-agent-dock">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">STAGE5 実行計画支援</h1>
          {isHydrating && (
            <div className="mt-2 text-sm text-gray-500">
              サーバーのデータを読み込み中です…
            </div>
          )}
        </div>
        {selection ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800">
            <CheckCircle2 className="h-3 w-3" />
            実
          </span>
        ) : null}
      </header>

      {/* OKRブロック一覧（OKRが0件でもカードを1枚表示） */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3 opacity-100">
        {cascade.map((dept, di) =>
          (dept?.projects ?? []).flatMap((proj, pi) => {
            const okrs = Array.isArray(proj?.okrs) ? proj.okrs : [];
            const strictProj = toStrictProject(proj);

            // OKRがある場合は従来通りOKRごとにカードを出す（クリックで右パネル）
            if (okrs.length > 0) {
              return okrs.map((okr, oi) => (
                <ProjectCard
                  key={`${dept?.name ?? 'dept'}-${strictProj.title}-${oi}`}
                  deptName={dept?.name ?? ''}
                  project={strictProj}
                  onClick={() => {
                    if (isHydrating) return;
                    setSelected({ d: di, p: pi, o: oi });
                  }}
                />
              ));
            }

            // OKRが0件でも1枚表示（クリックは無効）
            return (
              <ProjectCard
                key={`${dept?.name ?? 'dept'}-${strictProj.title}-no-okr`}
                deptName={dept?.name ?? ''}
                project={strictProj}
                onClick={() => {}}
              />
            );
          })
        )}
        {cascade.length === 0 && !isHydrating && (
          <div className="text-sm text-gray-600">表示できる実行計画がありません。</div>
        )}
      </div>

      {/* 実行支援パネル（OKR選択時のみ） */}
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
