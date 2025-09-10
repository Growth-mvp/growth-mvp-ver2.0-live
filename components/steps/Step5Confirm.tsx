// /components/steps/Step5Confirm.tsx
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

/* =========================================================
 * Apple風ミニマル確認画面
 * - ガラスカード / 余白広め / モノトーン / 情報の階層化
 * - 絵文字装飾は最小限にし、アイコンも控えめ
 * - 生成ボタンは pill 形状 + スピナー
 * ========================================================= */

// セッターが無ければ setState にフォールバックする安全ラッパー
function setFieldSafe(store: any, key: string, value: any) {
  const fnName = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
  const setter = store?.[fnName];
  if (typeof setter === 'function') {
    setter(value);
  } else if (typeof (useStrategyStore as any)?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

// ストア通知 or ローカル通知を安全に出す
function notifySafe(store: any, msg: string, setLocal: (s: string) => void) {
  if (typeof store?.setNotification === 'function') {
    store.setNotification(msg);
  } else {
    setLocal(msg);
  }
}

// Glassカード
function GlassCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/60 shadow-sm backdrop-blur-md ring-1 ring-black/5">
      <div className="p-4 md:p-5">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// 情報1行（ラベル:値）
function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="min-w-[8rem] shrink-0 text-xs text-gray-500">{label}</span>
      <span className="grow text-sm text-gray-800">{value ? String(value) : '（未入力）'}</span>
    </div>
  );
}

export default function Step5Confirm() {
  const router = useRouter();
  const st = useStrategyStore() as any; // ストア全体

  const [isGenerating, setIsGenerating] = useState(false);
  const [localNotice, setLocalNotice] = useState('');

  // 値は未定義でも空扱いにしておく
  const companyName: string = st?.companyName ?? '';
  const foundationYear: string = st?.foundationYear ?? '';
  const location: string = st?.location ?? '';
  const industry: string = st?.industry ?? '';
  const revenue: string = st?.revenue ?? '';
  const employees: string = st?.employees ?? '';
  const businessContent: string = st?.businessContent ?? '';
  const customerSegment: string = st?.customerSegment ?? '';

  const thought: string = st?.thought ?? '';
  const strength: string = st?.strength ?? '';
  const weakness: string = st?.weakness ?? '';
  const opportunity: string = st?.opportunity ?? '';
  const threat: string = st?.threat ?? '';

  const mission: string = st?.mission ?? '';
  const vision: string = st?.vision ?? '';
  const value: string = st?.value ?? '';

  const csvFinanceData: any = st?.csvFinanceData ?? null;
  const answers: any = st?.answers ?? null;
  const answers2: any = st?.answers2 ?? null;

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setLocalNotice('');

    try {
      const res = await fetch('/api/generate-story-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thought,
          mission,
          vision,
          value,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          csvFinanceData,
          answers,
          answers2,
        }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.error) {
        console.error('❌ 生成エラー:', data?.error || res.status);
        notifySafe(st, '❌ ストーリー生成に失敗しました', setLocalNotice);
        return;
      }

      if (typeof data?.story !== 'undefined') setFieldSafe(st, 'story', data.story);
      if (typeof data?.summary !== 'undefined') setFieldSafe(st, 'strategySummary', data.summary);

      router.push('/story-process');
    } catch (err) {
      console.error('❌ 通信エラー:', err);
      notifySafe(st, '❌ 通信エラーが発生しました', setLocalNotice);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <StepLayout step={5} totalSteps={5} title="入力内容の最終確認">
      <div className="space-y-6">
        {/* 通知（ストア通知が無い場合はローカル表示） */}
        {localNotice && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {localNotice}
          </div>
        )}

        {/* 概要（会社 & 事業） */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <GlassCard title="会社情報">
            <div className="divide-y divide-black/5">
              <InfoRow label="会社名" value={companyName} />
              <InfoRow label="設立年" value={foundationYear} />
              <InfoRow label="所在地" value={location} />
              <InfoRow label="業種" value={industry} />
              <InfoRow label="売上" value={revenue ? `${revenue} 百万円` : ''} />
              <InfoRow label="従業員数" value={employees ? `${employees} 人` : ''} />
            </div>
          </GlassCard>

          <GlassCard title="事業情報">
            <div className="divide-y divide-black/5">
              <InfoRow label="主な事業内容" value={businessContent} />
              <InfoRow label="主要な顧客層" value={customerSegment} />
            </div>
          </GlassCard>
        </div>

        {/* MVV */}
        <GlassCard title="経営者の思いとMVV">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">経営者の思い</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{thought || '（未入力）'}</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="mb-1 text-xs font-medium text-gray-500">Mission</div>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{mission || '（未入力）'}</p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="mb-1 text-xs font-medium text-gray-500">Vision</div>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{vision || '（未入力）'}</p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="mb-1 text-xs font-medium text-gray-500">Value</div>
                <p className="whitespace-pre-wrap text-sm text-gray-800">{value || '（未入力）'}</p>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* SWOT */}
        <GlassCard title="SWOT分析">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Strength（強み）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{strength || '（未入力）'}</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Weakness（弱み）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{weakness || '（未入力）'}</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Opportunity（機会）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{opportunity || '（未入力）'}</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white/70 p-3">
              <div className="mb-1 text-xs font-medium text-gray-500">Threat（脅威）</div>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{threat || '（未入力）'}</p>
            </div>
          </div>
        </GlassCard>

        {/* 注意書き */}
        <div className="text-center text-xs text-gray-500">「ストーリーを生成」を押すと、AIがたたき台ストーリーを作成します。</div>

        {/* 生成ボタン */}
        <div className="flex justify-center">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/80 px-6 py-2.5 text-sm font-medium text-gray-800 shadow-sm backdrop-blur hover:bg-white focus:outline-none focus:ring-2 focus:ring-black/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border border-black/30 border-t-transparent" />
                生成中…
              </>
            ) : (
              <>ストーリーを生成 →</>
            )}
          </button>
        </div>
      </div>
    </StepLayout>
  );
}
