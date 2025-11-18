// /components/execution/OKRModal.tsx
'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { emit } from '@/utils/actionBus';
import {
  saveProgressLog,
  type ProgressLogInput,
} from '@/utils/supabase/strategy';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';

type Mode = 'comment' | 'rating' | 'advice' | 'request';

interface OKRModalProps {
  open: boolean;
  onClose: () => void;
  okrId: string;
  objective?: string;
  keyResults?: string[];
  owner?: string;
}

export default function OKRModal({
  open,
  onClose,
  okrId,
  objective,
  keyResults,
  owner,
}: OKRModalProps) {
  const user = useUserStore((s) => s.user);
  const { strategyId } = useStrategyStore();

  const [mode, setMode] = useState<Mode>('comment');
  const [text, setText] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [advice, setAdvice] = useState('');
  const [requestTo, setRequestTo] = useState('');
  const [requestBody, setRequestBody] = useState('');
  const [saving, setSaving] = useState(false);

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // 保存可能かどうか（常に useMemo で評価）
  const canSave = useMemo(() => {
    switch (mode) {
      case 'comment':
        return !!text.trim();
      case 'rating':
        return rating !== null || !!text.trim();
      case 'advice':
        return !!advice.trim();
      case 'request':
        return !!requestTo.trim() && !!requestBody.trim();
      default:
        return false;
    }
  }, [mode, text, rating, advice, requestTo, requestBody]);

  // DB カラム（content / score のみ）に揃えたペイロード
  // status は ProgressLogInput 側で 'ontrack' | 'atrisk' | 'offtrack' 用なので、ここでは送らない
  const buildPayload = useCallback(
    (): Omit<ProgressLogInput, 'userId' | 'okrId' | 'status'> => {
      let content = '';
      let score: number | null = null;

      switch (mode) {
        case 'comment': {
          content = text.trim();
          break;
        }
        case 'rating': {
          score = typeof rating === 'number' ? rating : null;
          const body = text.trim();
          content =
            body.length > 0
              ? `評価: ${score ?? '-'}\n${body}`
              : `評価: ${score ?? '-'}`;
          break;
        }
        case 'advice': {
          content = advice.trim();
          break;
        }
        case 'request': {
          const to = requestTo.trim();
          const body = requestBody.trim();
          content = `協力要請先: ${to}\n${body}`;
          break;
        }
        default: {
          content = '';
        }
      }

      return {
        content,
        score,
      };
    },
    [mode, text, rating, advice, requestTo, requestBody]
  );

  const onSave = useCallback(async () => {
    const userId = user?.id;
    if (!userId || !okrId || saving || !canSave) return;

    setSaving(true);
    try {
      const payload = buildPayload();

      const { data, error } = await saveProgressLog({
        userId,
        okrId,
        ...payload,
      });

      if (error) throw error;

      const logId =
        (Array.isArray(data) ? data[0]?.id : (data as any)?.id) ?? undefined;

      if (strategyId) {
        emit('okr:progress:logged', { strategyId, okrId, logId });
      }

      // 入力クリア
      setText('');
      setAdvice('');
      setRequestTo('');
      setRequestBody('');
      setRating(null);
      setMode('comment');

      onClose();
    } catch (e) {
      console.error('saveProgressLog failed:', e);
      alert('保存に失敗しました。ネットワークまたは権限をご確認ください。');
    } finally {
      setSaving(false);
    }
  }, [user, okrId, saving, canSave, buildPayload, strategyId, onClose]);

  // open + mode 変更時に textarea をフォーカス
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => textAreaRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, mode]);

  // Esc / Ctrl+Enter のショートカット
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose, onSave]);

  // 🔚 ここで early return（Hook はすでに全部呼んだあと）
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !saving && onClose()}
        aria-hidden
      />
      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="okr-modal-title"
        className="relative z-[101] w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"
      >
        <header className="mb-3">
          <h3 id="okr-modal-title" className="text-lg font-bold">
            進捗ログの追加
          </h3>
          <p className="text-xs text-gray-500">
            OKR: {objective ?? '（タイトル未設定）'}
          </p>
        </header>

        {/* Objective Info */}
        <div className="mb-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-gray-500">Owner</div>
            <div className="font-semibold">{owner ?? '未設定'}</div>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 md:col-span-2">
            <div className="mb-1 text-gray-500">Key Results</div>
            {Array.isArray(keyResults) && keyResults.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {keyResults.map((kr, i) => (
                  <li key={i}>{kr}</li>
                ))}
              </ul>
            ) : (
              <div className="text-gray-400">未設定</div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-3 flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {[
            { id: 'comment', label: 'コメント' },
            { id: 'rating', label: '評価' },
            { id: 'advice', label: 'アドバイス' },
            { id: 'request', label: '協力要請' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id as Mode)}
              disabled={saving}
              className={`flex-1 rounded-lg px-3 py-2 font-medium transition ${
                mode === t.id ? 'bg-white shadow' : 'text-gray-600 hover:bg-white/60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Pane */}
        {mode === 'comment' && (
          <div>
            <textarea
              ref={textAreaRef}
              className="h-32 w-full rounded-lg border p-3 text-sm outline-none focus:ring"
              placeholder="今日の進捗・所感・課題を記入（Ctrl+Enterで保存）"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}

        {mode === 'rating' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">自己評価</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={saving}
                    onClick={() => setRating(n)}
                    className={`h-8 w-8 rounded-full border text-sm font-semibold ${
                      rating === n ? 'bg-emerald-600 text-white' : 'bg-white hover:bg-gray-50'
                    }`}
                    aria-label={`${n}点`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setRating(null)}
                  disabled={saving}
                  className="ml-2 text-xs text-gray-500 underline"
                >
                  クリア
                </button>
              </div>
            </div>
            <textarea
              ref={textAreaRef}
              className="h-24 w-full rounded-lg border p-3 text-sm outline-none focus:ring"
              placeholder="補足コメント（任意）"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}

        {mode === 'advice' && (
          <div>
            <textarea
              ref={textAreaRef}
              className="h-28 w-full rounded-lg border p-3 text-sm outline-none focus:ring"
              placeholder="次の一手（やること・やめること・改善案）"
              value={advice}
              onChange={(e) => setAdvice(e.target.value)}
            />
          </div>
        )}

        {mode === 'request' && (
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border p-3 text-sm outline-none focus:ring"
              placeholder="誰に（部署・氏名・役割）"
              value={requestTo}
              onChange={(e) => setRequestTo(e.target.value)}
            />
            <textarea
              ref={textAreaRef}
              className="h-24 w-full rounded-lg border p-3 text-sm outline-none focus:ring"
              placeholder="依頼内容（締切・期待成果・背景）"
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
            />
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">Escで閉じる / Ctrl+Enterで保存</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              onClick={onSave}
              disabled={saving || !canSave}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                saving || !canSave
                  ? 'bg-gray-200 text-gray-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
