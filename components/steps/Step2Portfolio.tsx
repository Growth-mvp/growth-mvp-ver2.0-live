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
import { saveWithAudit } from '@/utils/persist/saveWithAudit';

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

/** 参照共有を避けるための deep clone */
function clonePortfolio(p: BusinessPortfolio): BusinessPortfolio {
  return {
    ...p,
    threshold: { ...p.threshold },
    units: (p.units ?? []).map((u) => ({ ...u })),
  };
}

/** 入力値を最低限正規化（undefined/NaN を潰す） */
function normalizePortfolio(p: BusinessPortfolio): BusinessPortfolio {
  return {
    ...p,
    threshold: {
      growthBaseline: Number.isFinite(p.threshold?.growthBaseline) ? p.threshold.growthBaseline : 0,
      profitBaseline: Number.isFinite(p.threshold?.profitBaseline) ? p.threshold.profitBaseline : 0,
    },
    units: (p.units ?? []).map((u, idx) => ({
      id: typeof u.id === 'string' ? u.id : `unit-${idx}`,
      name: typeof u.name === 'string' ? u.name : `Unit ${idx + 1}`,
      revenueShare: Number.isFinite(u.revenueShare as any) ? (u.revenueShare as number) : 0,
      growthRate: Number.isFinite(u.growthRate as any) ? (u.growthRate as number) : 0,
      profitMargin: Number.isFinite(u.profitMargin as any) ? (u.profitMargin as number) : 0,
      note: typeof u.note === 'string' ? u.note : undefined,
      color: typeof u.color === 'string' ? u.color : undefined,
      stage: u.stage,
    })),
  };
}

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
  const role = (useUserStore() as any).role;
  const userId = user?.id ?? null;

  // 単一ソース（未設定ならデフォルト生成）
  const portfolio: BusinessPortfolio = useMemo(() => {
    const base = businessPortfolio ?? createDefaultPortfolio('business', 'FY2025', 'JPY');
    return normalizePortfolio(clonePortfolio(base));
  }, [businessPortfolio]);

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

  /** ★保存は store 全体ではなく buildPayload を優先（混線・上書き事故を減らす） */
  const persistNow = useCallback(async () => {
    const state = useStrategyStore.getState() as any;
    const payload = typeof state.buildPayload === 'function' ? state.buildPayload() : state;
    await saveWithAudit(payload, userId!, companyId!, undefined, {}, 'step2Portfolio:save');
  }, [userId, companyId]);

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
        await persistNow();
      } catch (e: any) {
        dirtyRef.current = true;
        setSaveError(e?.message || '保存に失敗しました');
        timerRef.current = setTimeout(trySave, 1500);
      } finally {
        setSaving(false);
      }
    }, 700);
  }, [canPersist, persistNow]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // commit: store更新 + dirty（deep clone + normalize）
  const commit = (next: BusinessPortfolio) => {
    const safe = normalizePortfolio(clonePortfolio(next));
    setBusinessPortfolio(safe);
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
      0,
    );
  }, [portfolio.units]);

  /* ============ 操作群 ============ */
  const newId = () =>
    (globalThis as any).crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

  /** ★更新は最新 store を基準にして競合を避ける */
  const updateUnit = (id: string, patch: Partial<BusinessUnit>) => {
    const latest =
      (useStrategyStore.getState().businessPortfolio as BusinessPortfolio | undefined) ?? portfolio;

    const safeLatest = normalizePortfolio(clonePortfolio(latest));
    const next: BusinessPortfolio = {
      ...safeLatest,
      units: (safeLatest.units ?? []).map((u) => (u.id === id ? { ...u, ...patch } : u)),
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
    const next: BusinessPortfolio = {
      ...portfolio,
      threshold: { ...portfolio.threshold, ...patch },
    };
    commit(next);
  };

  const setUnitType = (t: UnitType) => {
    const next: BusinessPortfolio = { ...portfolio, unitType: t };
    commit(next);
  };

  /* ============================================================
   * チャート設定（ここは“触らない”想定：元のまま）
   * ============================================================ */
  const width = 760;
  const height = 380;
  const padding = 40;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  // （例）x=利益率, y=成長率 のまま
  const profitValues: number[] = [];
  const growthValues: number[] = [];

  (portfolio.units ?? []).forEach((u) => {
    if (Number.isFinite(u.profitMargin)) profitValues.push(u.profitMargin as number);
    if (Number.isFinite(u.growthRate)) growthValues.push(u.growthRate as number);
  });

  profitValues.push(portfolio.threshold.profitBaseline ?? 0);
  growthValues.push(portfolio.threshold.growthBaseline ?? 0);
  profitValues.push(0);
  growthValues.push(0);

  let pMin = profitValues.length > 0 ? Math.min(...profitValues) : -10;
  let pMax = profitValues.length > 0 ? Math.max(...profitValues) : 10;
  let gMin = growthValues.length > 0 ? Math.min(...growthValues) : -10;
  let gMax = growthValues.length > 0 ? Math.max(...growthValues) : 10;

  const pSpan = pMax - pMin || 1;
  const gSpan = gMax - gMin || 1;
  const pMargin = Math.max(pSpan * 0.15, 2);
  const gMargin = Math.max(gSpan * 0.15, 2);
  pMin -= pMargin;
  pMax += pMargin;
  gMin -= gMargin;
  gMax += gMargin;

  const pExtent = Math.max(Math.abs(pMin), Math.abs(pMax), 10);
  const gExtent = Math.max(Math.abs(gMin), Math.abs(gMax), 10);
  const pDomainMin = -pExtent;
  const pDomainMax = pExtent;
  const gDomainMin = -gExtent;
  const gDomainMax = gExtent;

  const px = (profitMargin: number) =>
    clamp(
      padding + ((profitMargin - pDomainMin) / (pDomainMax - pDomainMin)) * innerWidth,
      padding,
      width - padding,
    );

  const gy = (growthRate: number) =>
    clamp(
      height - padding - ((growthRate - gDomainMin) / (gDomainMax - gDomainMin)) * innerHeight,
      padding,
      height - padding,
    );

  const rScale = (share: number) => 8 + (clamp(share, 0, 100) / 100) * (40 - 8);

  const zeroX = px(0);
  const zeroY = gy(0);

  // ベースライン（利益率=縦線 / 成長率=横線）
  const baselineX = px(portfolio.threshold.profitBaseline);
  const baselineY = gy(portfolio.threshold.growthBaseline);

  /* ============ 手動保存 ============ */
  const handleManualSave = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!canPersist || !savingGateRef.current) return;

    dirtyRef.current = false;
    setSaving(true);
    setSaveError(null);

    try {
      await persistNow();
    } catch (e: any) {
      dirtyRef.current = true;
      setSaveError(e?.message || '保存に失敗しました');
      scheduleSave();
    } finally {
      setSaving(false);
    }
  }, [canPersist, persistNow, scheduleSave]);

  /* ============ UI ============ */
  return (
    <div className="space-y-6">
      {/* ヘッダ */}
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
            <Button
              size="sm"
              className="border bg-white hover:bg-gray-50"
              onClick={handleManualSave}
              disabled={!canPersist || saving}
            >
              手動で保存
            </Button>
          </div>
        </div>
      </div>

      {/* 粒度/期間/通貨 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">粒度</label>
          <div className="flex gap-2">
            {UNIT_TYPE_ITEMS.map((t) => {
              const active = portfolio.unitType === t;
              return (
                <Button
                  key={t}
                  className={
                    active
                      ? 'bg-gray-900 text-white hover:bg-gray-800'
                      : 'border bg-white hover:bg-gray-50'
                  }
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
            onChange={(e) =>
              commit({
                ...portfolio,
                currency: e.target.value as BusinessPortfolio['currency'],
              })
            }
          >
            <option value="JPY">JPY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
      </div>

      {/* ベースライン入力：表示順だけ入れ替え（利益率 → 成長率） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-sm text-gray-600 mb-1">利益率ベースライン（%）</label>
          <input
            type="number"
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.threshold.profitBaseline}
            onChange={(e) => {
              const n = toNumberOrUndefined(e.target.value);
              if (n == null) return;
              setThreshold({ profitBaseline: n });
            }}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">成長率ベースライン（%）</label>
          <input
            type="number"
            className="w-full rounded-xl border px-3 py-2"
            value={portfolio.threshold.growthBaseline}
            onChange={(e) => {
              const n = toNumberOrUndefined(e.target.value);
              if (n == null) return;
              setThreshold({ growthBaseline: n });
            }}
          />
        </div>

        <div className="text-xs text-gray-500">
          会社：{companyId ?? '(未確定)'} / 役割：{role ?? '(不明)'}
        </div>
      </div>

      {/* チャート */}
      <div className="rounded-2xl border bg-white p-4 overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="事業ポートフォリオ">
          {/* 0%軸 */}
          <line x1={zeroX} y1={padding} x2={zeroX} y2={height - padding} stroke="#9ca3af" strokeWidth={1} />
          <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="#9ca3af" strokeWidth={1} />

          {/* ベースライン */}
          <line x1={baselineX} y1={padding} x2={baselineX} y2={height - padding} stroke="#e5e7eb" strokeDasharray="6 6" />
          <line x1={padding} y1={baselineY} x2={width - padding} y2={baselineY} stroke="#e5e7eb" strokeDasharray="6 6" />

          {/* 軸ラベル（ここも“触らない”想定：元のまま） */}
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

          {/* 気泡 */}
          {displayUnits.map((u) => {
            const cx = px(u.growthRate);
            const cy = gy(u.profitMargin);
            const r = rScale(u.revenueShare);
            const fill = u.color || '#4f46e5';
            return (
              <g key={u.id}>
                <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.2} stroke={fill} />
                <text x={cx} y={cy} textAnchor="middle" dy="0.35em" className="text-[12px] fill-gray-800">
                  {u.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* テーブル */}
      <div className="rounded-2xl border bg-white">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-medium">一覧編集</div>
          <Button className="border bg-white hover:bg-gray-50" onClick={() => addUnit()}>
            追加
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 w-[28%]">名称</th>
                <th className="text-right px-4 py-2 w-[14%]">構成比（%）</th>

                {/* 3列目：成長率 / 4列目：利益率 */}
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
                      onChange={(e) => {
                        const n = toNumberOrUndefined(e.target.value);
                        if (n == null) return;
                        updateUnit(u.id, { revenueShare: clamp(n, 0, 100) });
                      }}
                      placeholder="0-100"
                    />
                  </td>

                  {/* ★ここを修正：ヘッダ3列目=成長率 に合わせて growthRate */}
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.growthRate}
                      onChange={(e) => {
                        const n = toNumberOrUndefined(e.target.value);
                        if (n == null) return;
                        updateUnit(u.id, { growthRate: clamp(n, -100, 300) });
                      }}
                    />
                  </td>

                  {/* ★ここを修正：ヘッダ4列目=利益率 に合わせて profitMargin */}
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      className="w-full rounded-lg border px-3 py-2 text-right"
                      value={u.profitMargin}
                      onChange={(e) => {
                        const n = toNumberOrUndefined(e.target.value);
                        if (n == null) return;
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
                    <Button
                      size="sm"
                      className="bg-red-600 text-white hover:bg-red-700"
                      onClick={() => removeUnit(u.id)}
                    >
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
