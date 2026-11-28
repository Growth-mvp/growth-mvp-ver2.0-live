'use client';

import { useEffect, useRef } from 'react';
import type { CompanionAction } from '@/lib/companion/companionEngine';

type Props = {
  action: CompanionAction;
  onDismiss: () => void;
  onAsk: (question: string) => void;
  askDisabled: boolean;
  /** 案内が実際に画面内に見えた時に一度だけ呼ぶ（閉じた引き出しの中では記録しない） */
  onVisible: () => void;
  /** 経営点検の結果を、利用者の操作で最新の保存済みデータから再取得する（自動の繰り返しはしない） */
  onRefresh?: () => void;
};

/* 自律伴走の案内。会話履歴には入れない（AIへの送信内容を増やさず、重複発話もしない）。
 * 進行・操作の案内（progress）と、節目の経営助言（advice）を同じ枠で表示する。 */
export default function CEOChatCompanionCard({ action, onDismiss, onAsk, askDisabled, onVisible, onRefresh }: Props) {
  const cardRef = useRef<HTMLElement | null>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    if (action.kind !== 'progress') return;
    const el = cardRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      onVisibleRef.current();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        onVisibleRef.current();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [action.key, action.kind]);

  const isAdvice = action.kind === 'advice';
  const loading = isAdvice && action.status === 'loading';
  const question = isAdvice
    ? `次の助言の内容を、根拠と合わせて詳しく説明してください。\n---\n${action.body ?? ''}`
    : `${action.title}。${action.message} 経営の観点から、次に何を優先すべきか教えてください。`;

  return (
    <section
      ref={cardRef}
      aria-label={isAdvice ? 'AI経営コンサルタントの助言' : 'AI経営コンサルタントからの案内'}
      className={[
        'rounded-lg border px-4 py-3 text-[13px] leading-6 text-zinc-900',
        isAdvice ? 'border-accent/30 bg-accent-soft/60' : 'border-bluegray-light bg-bluegray-mist',
      ].join(' ')}
      data-companion-key={action.key}
      data-companion-kind={action.kind}
    >
      <div className="font-semibold">{action.title}</div>
      {isAdvice ? (
        loading ? (
          <p className="mt-1 text-zinc-600">保存済みの内容から、助言を準備しています…</p>
        ) : (
          <>
            <p className="mt-1 whitespace-pre-wrap break-words">{action.summary ?? action.body}</p>
            {action.detail && (
              <details className="mt-2 group">
                <summary className="cursor-pointer select-none text-[12px] font-semibold text-accent hover:underline">
                  経営点検の詳細を見る
                </summary>
                <div className="mt-2 whitespace-pre-wrap break-words rounded border border-zinc-200 bg-white/80 p-3 text-[12px] leading-5 text-zinc-800">
                  {action.detail}
                </div>
              </details>
            )}
            {action.checkedLabel && <p className="mt-2 text-[11px] text-zinc-500">{action.checkedLabel}</p>}
            <p className="mt-2 text-[11px] text-zinc-500">
              AIの助言です。根拠と前提を確かめて、判断は利用者が行ってください。
            </p>
          </>
        )
      ) : (
        <>
          <p className="mt-1">{action.message}</p>
          {action.steps.length > 0 && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[12px] text-zinc-700">
              {action.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!isAdvice && (
          <a
            href={action.href}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-[12px] font-semibold text-zinc-900 hover:bg-zinc-50"
          >
            {action.linkLabel}
          </a>
        )}
        {!loading && (
          <button
            type="button"
            onClick={() => onAsk(question)}
            disabled={askDisabled}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-[12px] text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAdvice ? 'この助言について相談する' : 'この件をAIに相談する'}
          </button>
        )}
        {!loading && isAdvice && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-[12px] text-zinc-800 hover:bg-zinc-50"
          >
            最新の点検を確認
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-[12px] text-zinc-500 hover:text-zinc-800"
        >
          閉じる
        </button>
      </div>
    </section>
  );
}
