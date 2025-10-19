// components/steps/Step2Portfolio.tsx
'use client';

import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { Button } from '@/components/ui/button';
import type {
  BusinessPortfolio,
  BusinessUnit,
  PortfolioThreshold,
  UnitType,
} from '@/types/portfolio';
import { classifyStage, createDefaultPortfolio } from '@/types/portfolio';
import { saveStrategyData as saveStrategyDataApi } from '@/utils/supabase';

/** 数値入力の安全パース（空文字は undefined にする） */
function toNumberOrUndefined(v: string): number | undefined {
  if (v === '' || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 範囲クランプ */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

const UNIT_TYPE_ITEMS: UnitType[] = ['business', 'product', 'service'];

type Props = {
  onPrev?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
};

export default function Step2Portfolio(_props: Props) {
  const { businessPortfolio, setBusinessPortfolio } = useStrategyStore() as any;

  // ユーザー・会社の可視化用
  const { user, companyId, role, hydrated, membershipLoaded } = useUserStore();
  const userId = user?.id ?? null;

  /** 単一ソース：store の値（未設定ならデフォルト生成） */
  const portfolio: BusinessPortfolio =
    businessPortfolio ?? createDefaultPortfolio('business', 'FY2025', 'JPY');

  /** store を丸ごと更新するユーティリティ（period/currency/units/threshold 用） */
  const commit = (next: BusinessPortfolio): void => {
    setBusinessPortfolio(next);
    markDirty(); // 変更フラグ
  };

  /** ====== 自動保存（デバウンス） ====== */
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    // 0.8秒デバウンスで保存
    timerRef.current = setTimeout(async () => {
      if (!dirtyRef.current) return;
      if (!userId) return; // 未ログインなら保存しない
      dirtyRef.current = false;
      setSaving(true);
      setSaveError(null);
      try {
        const state = useStrategyStore.getState() as any;
        await saveStrategyDataApi(state, userId);
      } catch (e: any) {
        setSaveError(e?.message || '保存に失敗しました');
        console.error('[AUTO SAVE] failed:', e);
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [userId]);

  // アンマウント時にタイマー解除
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /** 表示用ユニット（stage を補完） */
  const displayUnits = useMemo<BusinessUnit[]>(() => {
    return (portfolio.units ?? []).map((u: BusinessUnit) => {
      const stage =
        u.stage ?? classifyStage(u.growthRate, u.profitMargin, portfolio.threshold);
      return { ...u, stage };
    });
  }, [portfolio.units, portfolio.threshold]);

  /** 合計構成比（%） */
  const totalShare = useMemo<number>(() => {
    return (portfolio.units ?? []).reduce(
      (sum: number, u: BusinessUnit) =>
        sum + (Number.isFinite(u.revenueShare) ? (u.revenueShare as number) : 0),
      0
    );
  }, [portfolio.units]);

  /** ====== ストアに存在しなかった操作群をコンポーネント内で吸収 ====== */

  // id 生成
  const newId = () =>
    (globalThis as any).crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 追加
  const addUnit = (patch?: Partial<BusinessUnit>) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      units: [
        ...(portfolio.units ?? []),
        {
          id: newId(),
          name: `Unit ${(portfolio.units?.length ?? 0) + 1}`,
          revenueShare: 10,
          growthRate: 0,
          profitMargin: 0,
          ...patch,
        },
      ],
    };
    commit(next);
  };

  // 更新
  const updateUnit = (id: string, patch: Partial<BusinessUnit>) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      units: (portfolio.units ?? []).map((u) => (u.id === id ? { ...u, ...patch } : u)),
    };
    commit(next);
  };

  // 削除
  const removeUnit = (id: string) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      units: (portfolio.units ?? []).filter((u) => u.id !== id),
    };
    commit(next);
  };

  // 閾値変更
  const setThreshold = (patch: Partial<PortfolioThreshold>) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      threshold: { ...portfolio.threshold, ...patch },
    };
    commit(next);
  };

  // 粒度切り替え
  const setUnitType = (t: UnitType) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      unitType: t,
    };
    commit(next);
  };

  /** ====== チャート設定/スケール ====== */
  const width = 760;
  const height = 380;
  const padding = 40;

  // 横軸：利益率（%）
  const gx = (profitMargin: number): number => {
    const min = -50;
    const max = 50;
    const x = padding + ((profitMargin - min) / (max - min)) * (width - padding * 2);
    return clamp(x, padding, width - padding);
  };

  // 縦軸：成長率（%） 上がプラス成長に見えるよう反転
  const gy = (growthRate: number): number => {
    const min = -100;
    const max = 150;
    const y =
      height - padding - ((growthRate - min) / (max - min)) * (height - padding * 2);
    return clamp(y, padding, height - padding);
  };

  // バブル半径：構成比 0-100 → r 8-40
  const rScale = (share: number): number => {
    const minR = 8;
    const maxR = 40;
    const r = minR + (clamp(share, 0, 100) / 100) * (maxR - minR);
    return r;
  };

  // Baseline 座標
  const baselineX = gx(portfolio.threshold.profitBaseline);
  const baselineY = gy(portfolio.threshold.growthBaseline);

  /** ====== 手動保存（念のため） ====== */
  const handleManualSave = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    dirtyRef.current = false;
    if (!userId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const state = useStrategyStore.getState() as any;
      await saveStrategyDataApi(state, userId);
      console.log('[MANUAL SAVE] businessPortfolio snapshot:', portfolio);
    } catch (e: any) {
      setSaveError(e?.message || '保存に失敗しました');
      console.error('[MANUAL SAVE] failed:', e);
    } finally {
      setSaving(false);
    }
  }, [userId, portfolio]);

  /** ====== テスト保存（ログを多めに出す） ====== */
  const handleTestSave = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    dirtyRef.current = false;
    if (!userId) return;
    setSaving(true);
    setSaveError(null);
    try {
      console.groupCollapsed('%c[TEST SAVE] payload preview', 'color:#2563eb');
      console.log('userId:', userId);
      console.log('companyId:', companyId);
      console.log('role:', role, 'hydrated:', hydrated, 'membershipLoaded:', membershipLoaded);
      console.log('businessPortfolio (camel):', portfolio);
      try {
        const unitsBrief = (portfolio.units ?? []).map(u => ({
          id: u.id, name: u.name, share: u.revenueShare, g: u.growthRate, pm: u.profitMargin
        }));
        console.log('units brief:', unitsBrief);
      } catch {}
      console.groupEnd();

      const state = useStrategyStore.getState() as any;
      await saveStrategyDataApi(state, userId);
      console.log('[TEST SAVE] saveStrategyData completed');
    } catch (e: any) {
      setSaveError(e?.message || '保存に失敗しました');
      console.error('[TEST SAVE] failed:', e);
    } finally {
      setSaving(false);
    }
  }, [userId, portfolio, companyId, role, hydrated, membershipLoaded]);

  return (
    <div className="space-y-6">
      {/* 接続ステータス（userId / companyId / role / hydration） */}
      <div className="rounded-xl border bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-6">
            <div>
              <span className="text-gray-500">userId:</span>{' '}
              <code className="text-gray-800">{userId ?? '(none)'}</code>
            </div>
            <div>
              <span className="text-gray-500">companyId:</span>{' '}
              <code className="text-gray-800">{companyId ?? '(none)'} </code>
            </div>
            <div>
              <span className="text-gray-500">role:</span>{' '}
              <code className="text-gray-800">{role ?? '(none)'}</code>
            </div>
            <div className="text-gray-500">
              hydrated: <code className="text-gray-800">{String(!!hydrated)}</code> / membershipLoaded{' '}
              <code className="text-gray-800">{String(!!membershipLoaded)}</code>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                console.groupCollapsed('%c[USER CHECK]', 'color:#0ea5e9');
                console.log('user:', user);
                console.log('userId:', userId);
                console.log('companyId:', companyId);
                console.log('role:', role);
                console.log('hydrated:', hydrated, 'membershipLoaded:', membershipLoaded);
                console.groupEnd();
                alert(
                  `userId: ${userId ?? '(none)'}\ncompanyId: ${companyId ?? '(none)'}\nrole: ${role ?? '(none)'}`
                );
              }}
            >
              ユーザー/会社チェック
            </Button>
          </div>
        </div>
        {!userId && (
          <div className="mt-2 text-xs text-red-600">
            userId がありません。ログイン/認証が完了しているか確認してください（保存は無効化されます）。
          </div>
        )}
      </div>

      {/* 粒度切り替え & 期間/通貨 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">粒度</label>
          <div className="flex gap-2">
            {UNIT_TYPE_ITEMS.map((t: UnitType) => {
              const active = portfolio.unitType === t;
              return (
                <Button
                  key={t}
                  variant={active ? 'primary' : 'outline'}
                  onClick={() => { setUnitType(t); }}
                >
                  {t === 'business' ? '事業' : t === 'product' ? '商品' : 'サービス'}
                </Button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">期間</label>
          <input
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.periodLabel}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const next: BusinessPortfolio = { ...portfolio, periodLabel: e.target.value };
              commit(next);
            }}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">通貨</label>
          <select
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.currency}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const v = e.target.value as BusinessPortfolio['currency'];
              const next: BusinessPortfolio = { ...portfolio, currency: v };
              commit(next);
            }}
          >
            <option value="JPY">JPY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
      </div>

      {/* Baseline 入力 + 保存ステータス */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-sm text-gray-600 mb-1">成長率ベースライン（%）</label>
          <input
            type="number"
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.threshold.growthBaseline}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const n = toNumberOrUndefined(e.target.value);
              if (typeof n === 'undefined') return;
              setThreshold({ growthBaseline: n });
            }}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">利益率ベースライン（%）</label>
          <input
            type="number"
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.threshold.profitBaseline}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const n = toNumberOrUndefined(e.target.value);
              if (typeof n === 'undefined') return;
              setThreshold({ profitBaseline: n });
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            合計構成比：{' '}
            <span className={totalShare > 100 ? 'text-red-600 font-medium' : ''}>
              {Math.round(totalShare)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            {saving ? (
              <span className="text-xs text-gray-500">保存中…</span>
            ) : saveError ? (
              <span className="text-xs text-red-600">保存失敗：{saveError}</span>
            ) : (
              <span className="text-xs text-gray-500">保存待ち</span>
            )}
            <Button variant="outline" size="sm" onClick={handleManualSave} disabled={saving || !userId}>
              手動で保存
            </Button>
          </div>
        </div>
      </div>

      {/* チャート */}
      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-medium">成長率 × 利益率 バブルチャート</div>
          <div className="text-xs text-gray-500">バブルの大きさ＝売上構成比（%）</div>
        </div>
        <div className="p-4 overflow-x-auto">
          <svg width={width} height={height} role="img" aria-label="事業ポートフォリオ">
            {/* ガイド線 */}
            <line
              x1={baselineX}
              y1={padding}
              x2={baselineX}
              y2={height - padding}
              stroke="#e5e7eb"
              strokeDasharray="6 6"
            />
            <line
              x1={padding}
              y1={baselineY}
              x2={width - padding}
              y2={baselineY}
              stroke="#e5e7eb"
              strokeDasharray="6 6"
            />

            {/* 軸ラベル */}
            <text x={width / 2} y={height - 6} textAnchor="middle" className="fill-gray-500 text-[12px]">
              利益率（%）
            </text>
            <text
              x={12}
              y={height / 2}
              transform={`rotate(-90 12 ${height / 2})`}
              textAnchor="middle"
              className="fill-gray-500 text-[12px]"
            >
              成長率（%）
            </text>

            {/* バブル */}
            {displayUnits.map((u: BusinessUnit, i: number) => {
              const cx = gx(u.profitMargin);
              const cy = gy(u.growthRate);
              const r = rScale(u.revenueShare);
              const fill = u.color || '#4f46e5';
              return (
                <g key={u.id || i}>
                  <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.2} stroke={fill} />
                  <text x={cx} y={cy} textAnchor="middle" dy="0.35em" className="text-[12px] fill-gray-800">
                    {u.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* テーブル入力 */}
      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-medium">一覧編集</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                addUnit();
              }}
            >
              追加
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 w-[28%]">名称</th>
                <th className="text-right px-4 py-2 w-[14%]">構成比（%）</th>
                <th className="text-right px-4 py-2 w-[14%]">成長率（%）</th>
                <th className="text-right px-4 py-2 w-[14%]">利益率（%）</th>
                <th className="text-left px-4 py-2 w-[18%]">メモ</th>
                <th className="px-4 py-2 w-[12%] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(portfolio.units ?? []).map((u: BusinessUnit) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2">
                    <input
                      className="w-full rounded-lg border px-3 py-2"
                      value={u.name}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        updateUnit(u.id, { name: e.target.value });
                      }}
                      onBlur={markDirty}
                      placeholder={
                        portfolio.unitType === 'business'
                          ? '事業名'
                          : portfolio.unitType === 'product'
                          ? '商品名'
                          : 'サービス名'
                      }
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.revenueShare}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const n = toNumberOrUndefined(e.target.value);
                        if (typeof n === 'undefined') return;
                        updateUnit(u.id, { revenueShare: clamp(n, 0, 100) });
                      }}
                      onBlur={markDirty}
                      placeholder="0-100"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.growthRate}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const n = toNumberOrUndefined(e.target.value);
                        if (typeof n === 'undefined') return;
                        updateUnit(u.id, { growthRate: clamp(n, -100, 300) });
                      }}
                      onBlur={markDirty}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.profitMargin}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const n = toNumberOrUndefined(e.target.value);
                        if (typeof n === 'undefined') return;
                        updateUnit(u.id, { profitMargin: clamp(n, -100, 100) });
                      }}
                      onBlur={markDirty}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      className="w-full rounded-lg border px-3 py-2"
                      value={u.note ?? ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        updateUnit(u.id, { note: e.target.value });
                      }}
                      onBlur={markDirty}
                      placeholder="補足・課題・仮説など"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          removeUnit(u.id);
                          markDirty();
                        }}
                      >
                        削除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* 0件時のガイド行 */}
              {(!portfolio.units || portfolio.units.length === 0) && (
                <tr className="border-t">
                  <td className="px-4 py-6 text-gray-500" colSpan={6}>
                    まだ項目がありません。右上の「追加」を押して、まずは感覚値で構成比・成長率・利益率を入れてみてください。
                    後から CSV や実データで上書きできます。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== フッター（固定）にテスト保存ボタンを追加 ===== */}
      <div className="sticky bottom-0 z-10 bg-white/85 backdrop-blur border-t">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="text-xs">
            {saving ? (
              <span className="text-gray-600">保存中…</span>
            ) : saveError ? (
              <span className="text-red-600">保存失敗：{saveError}</span>
            ) : (
              <span className="text-gray-500">保存待ち</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleManualSave} disabled={saving || !userId}>
              手動で保存
            </Button>
            <Button variant="primary" size="sm" onClick={handleTestSave} disabled={saving || !userId}>
              テスト保存（ログ出力）
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
