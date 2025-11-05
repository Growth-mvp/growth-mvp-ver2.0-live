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
import { saveStrategyData as saveStrategyDataApi } from '@/utils/supabase/strategy';

/* ============ ユーティリティ ============ */
function toNumberOrUndefined(v: string | number | null | undefined): number | undefined {
  if (v === '' || v === null || typeof v === 'undefined') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
const UNIT_TYPE_ITEMS: UnitType[] = ['business', 'product', 'service'];

/* ============ Props ============ */
type Props = {
  onPrev?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
};

/* ============ 本体 ============ */
export default function Step2Portfolio(_props: Props) {
  const { businessPortfolio, setBusinessPortfolio } = useStrategyStore() as {
    businessPortfolio: BusinessPortfolio | undefined;
    setBusinessPortfolio: (p: BusinessPortfolio) => void;
  };

  const { user, companyId, hydrated, membershipLoaded } = useUserStore() as any;
  const role = (useUserStore() as any).role; // 必要なら保持
  const userId = user?.id ?? null;

  // 単一ソース（未設定ならデフォルト生成）
  const portfolio: BusinessPortfolio =
    businessPortfolio ?? createDefaultPortfolio('business', 'FY2025', 'JPY');

  // 保存ガード
  const canPersist = !!userId && !!companyId && !!hydrated && !!membershipLoaded;

  // 自動保存（デバウンス）
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingGateRef = useRef(false);

  useEffect(() => {
    savingGateRef.current = canPersist;
  }, [canPersist]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async function trySave() {
      if (!savingGateRef.current || !canPersist) {
        timerRef.current = setTimeout(trySave, 600);
        return;
      }
      if (!dirtyRef.current) return;

      dirtyRef.current = false;
      setSaving(true);
      setSaveError(null);
      try {
        const state = useStrategyStore.getState() as any;
        await saveStrategyDataApi(state, userId!, companyId!);
      } catch (e: any) {
        dirtyRef.current = true;
        setSaveError(e?.message || '保存に失敗しました');
        timerRef.current = setTimeout(trySave, 1500);
      } finally {
        setSaving(false);
      }
    }, 700);
  }, [canPersist, userId, companyId]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // commit: store更新 + dirty
  const commit = (next: BusinessPortfolio) => {
    setBusinessPortfolio(next);
    markDirty();
  };

  /* ============ 派生値 ============ */
  const displayUnits = useMemo<BusinessUnit[]>(() => {
    return (portfolio.units ?? []).map((u) => {
      const stage = u.stage ?? classifyStage(u.growthRate, u.profitMargin, portfolio.threshold);
      return { ...u, stage };
    });
  }, [portfolio.units, portfolio.threshold]);

  const totalShare = useMemo<number>(() => {
    return (portfolio.units ?? []).reduce(
      (sum, u) => sum + (Number.isFinite(u.revenueShare) ? (u.revenueShare as number) : 0),
      0
    );
  }, [portfolio.units]);

  /* ============ 操作群 ============ */
  const newId = () =>
    (globalThis as any).crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const addUnit = (patch?: Partial<BusinessUnit>) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      units: [
        ...(portfolio.units ?? []),
        { id: newId(), name: `Unit ${(portfolio.units?.length ?? 0) + 1}`, revenueShare: 10, growthRate: 0, profitMargin: 0, ...patch },
      ],
    };
    commit(next);
  };

  const updateUnit = (id: string, patch: Partial<BusinessUnit>) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      units: (portfolio.units ?? []).map((u) => (u.id === id ? { ...u, ...patch } : u)),
    };
    commit(next);
  };

  const removeUnit = (id: string) => {
    const next: BusinessPortfolio = {
      ...portfolio,
      units: (portfolio.units ?? []).filter((u) => u.id !== id),
    };
    commit(next);
  };

  const setThreshold = (patch: Partial<PortfolioThreshold>) => {
    const next: BusinessPortfolio = { ...portfolio, threshold: { ...portfolio.threshold, ...patch } };
    commit(next);
  };

  const setUnitType = (t: UnitType) => {
    const next: BusinessPortfolio = { ...portfolio, unitType: t };
    commit(next);
  };

  /* ============ チャート設定 ============ */
  const width = 760, height = 380, padding = 40;
  const gx = (profitMargin: number) => clamp(padding + ((profitMargin - (-50)) / (100)) * (width - padding * 2), padding, width - padding);
  const gy = (growthRate: number) => {
    const min = -100, max = 150;
    return clamp(height - padding - ((growthRate - min) / (max - min)) * (height - padding * 2), padding, height - padding);
  };
  const rScale = (share: number) => 8 + (clamp(share, 0, 100) / 100) * (40 - 8);
  const baselineX = gx(portfolio.threshold.profitBaseline);
  const baselineY = gy(portfolio.threshold.growthBaseline);

  /* ============ 手動保存 ============ */
  const handleManualSave = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!canPersist || !savingGateRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    setSaveError(null);
    try {
      const state = useStrategyStore.getState() as any;
      await saveStrategyDataApi(state, userId!, companyId!);
    } catch (e: any) {
      dirtyRef.current = true;
      setSaveError(e?.message || '保存に失敗しました');
      scheduleSave();
    } finally {
      setSaving(false);
    }
  }, [canPersist, userId, companyId, scheduleSave]);

  /* ============ UI ============ */
  return (
    <div className="space-y-6">
      {/* ヘッダ（簡素化） */}
      <div className="rounded-xl border bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            合計構成比：{' '}
            <span className={totalShare > 100 ? 'text-red-600 font-medium' : 'text-gray-800'}>
              {Math.round(totalShare)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {saving ? '保存中…' : saveError ? `保存失敗：${saveError}` : '保存待ち'}
            </span>
            <Button size="sm" className="border bg-white hover:bg-gray-50" onClick={handleManualSave} disabled={!canPersist || saving}>
              手動で保存
            </Button>
          </div>
        </div>
      </div>

      {/* 粒度/期間/通貨（シンプル） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">粒度</label>
          <div className="flex gap-2">
            {UNIT_TYPE_ITEMS.map((t) => {
              const active = portfolio.unitType === t;
              return (
                <Button
                  key={t}
                  className={active ? 'bg-gray-900 text-white hover:bg-gray-800' : 'border bg-white hover:bg-gray-50'}
                  onClick={() => setUnitType(t)}
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
            onChange={(e) => commit({ ...portfolio, periodLabel: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">通貨</label>
          <select
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.currency}
            onChange={(e) => commit({ ...portfolio, currency: e.target.value as BusinessPortfolio['currency'] })}
          >
            <option value="JPY">JPY</option><option value="USD">USD</option><option value="EUR">EUR</option>
          </select>
        </div>
      </div>

      {/* ベースライン */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-sm text-gray-600 mb-1">成長率ベースライン（%）</label>
          <input
            type="number"
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.threshold.growthBaseline}
            onChange={(e) => {
              const n = toNumberOrUndefined(e.target.value); if (n == null) return;
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
            onChange={(e) => {
              const n = toNumberOrUndefined(e.target.value); if (n == null) return;
              setThreshold({ profitBaseline: n });
            }}
          />
        </div>
        <div className="text-xs text-gray-500">
          会社：{companyId ?? '(未確定)'} / 役割：{role ?? '(不明)'}
        </div>
      </div>

      {/* チャート（必要最小のガイド線とラベルのみ） */}
      <div className="rounded-2xl border bg-white p-4 overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="事業ポートフォリオ">
          <line x1={baselineX} y1={padding} x2={baselineX} y2={height - padding} stroke="#e5e7eb" strokeDasharray="6 6" />
          <line x1={padding} y1={baselineY} x2={width - padding} y2={baselineY} stroke="#e5e7eb" strokeDasharray="6 6" />
          <text x={width / 2} y={height - 6} textAnchor="middle" className="fill-gray-500 text-[12px]">利益率（%）</text>
          <text x={12} y={height / 2} transform={`rotate(-90 12 ${height / 2})`} textAnchor="middle" className="fill-gray-500 text-[12px]">成長率（%）</text>

          {displayUnits.map((u) => {
            const cx = gx(u.profitMargin);
            const cy = gy(u.growthRate);
            const r  = rScale(u.revenueShare);
            const fill = u.color || '#4f46e5';
            return (
              <g key={u.id}>
                <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.2} stroke={fill} />
                <text x={cx} y={cy} textAnchor="middle" dy="0.35em" className="text-[12px] fill-gray-800">{u.name}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* テーブル（最小限の操作のみ） */}
      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-medium">一覧編集</div>
          <Button className="border bg-white hover:bg-gray-50" onClick={() => addUnit()}>追加</Button>
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
              {(portfolio.units ?? []).map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2">
                    <input
                      className="w-full rounded-lg border px-3 py-2"
                      value={u.name}
                      onChange={(e) => updateUnit(u.id, { name: e.target.value })}
                      placeholder={portfolio.unitType === 'business' ? '事業名' : portfolio.unitType === 'product' ? '商品名' : 'サービス名'}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.revenueShare}
                      onChange={(e) => {
                        const n = toNumberOrUndefined(e.target.value); if (n == null) return;
                        updateUnit(u.id, { revenueShare: clamp(n, 0, 100) });
                      }}
                      placeholder="0-100"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.growthRate}
                      onChange={(e) => {
                        const n = toNumberOrUndefined(e.target.value); if (n == null) return;
                        updateUnit(u.id, { growthRate: clamp(n, -100, 300) });
                      }}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.profitMargin}
                      onChange={(e) => {
                        const n = toNumberOrUndefined(e.target.value); if (n == null) return;
                        updateUnit(u.id, { profitMargin: clamp(n, -100, 100) });
                      }}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      className="w-full rounded-lg border px-3 py-2"
                      value={u.note ?? ''}
                      onChange={(e) => updateUnit(u.id, { note: e.target.value })}
                      placeholder="補足・課題・仮説など"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" onClick={() => removeUnit(u.id)}>
                      削除
                    </Button>
                  </td>
                </tr>
              ))}

              {(!portfolio.units || portfolio.units.length === 0) && (
                <tr className="border-t">
                  <td className="px-4 py-6 text-gray-500" colSpan={6}>
                    まだ項目がありません。右上の「追加」から構成比・成長率・利益率を入力してください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
