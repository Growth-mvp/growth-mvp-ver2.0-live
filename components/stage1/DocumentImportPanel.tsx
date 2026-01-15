// /components/stage1/DocumentImportPanel.tsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import type {
  Stage1ImportCandidate,
  Stage1ImportResult,
  FinancePLRow,
  FinanceBSRow,
  SegmentBSRow,
} from '@/types/strategy';

/* =========================================================
 * 安定した空参照（selector で ?? [] / ?? {} を使わないため）
 * ========================================================= */

const EMPTY_PL_ARR: FinancePLRow[] = Object.freeze([]) as unknown as FinancePLRow[];
const EMPTY_BS_ARR: FinanceBSRow[] = Object.freeze([]) as unknown as FinanceBSRow[];
const EMPTY_SEG_PL: Record<string, FinancePLRow[]> = Object.freeze({}) as unknown as Record<string, FinancePLRow[]>;
const EMPTY_SEG_BS: Record<string, SegmentBSRow[]> = Object.freeze({}) as unknown as Record<string, SegmentBSRow[]>;

/* =========================================================
 * 型定義
 * ========================================================= */

type TabKey = 'companyPL' | 'companyBS' | 'segmentPL' | 'segmentBS' | 'pbr';

const TAB_LABELS: Record<TabKey, string> = {
  companyPL: '全社PL',
  companyBS: '全社BS',
  segmentPL: '事業部PL',
  segmentBS: '事業部BS',
  pbr: 'PBR',
};

const PL_FIELD_LABELS: Record<string, string> = {
  revenue: '売上高',
  grossProfit: '売上総利益',
  cogs: '売上原価',
  sga: '販管費',
  operatingIncome: '営業利益',
  depreciation: '減価償却費',
  interest: '支払利息',
  tax: '法人税等',
  netIncome: '当期純利益',
};

const BS_FIELD_LABELS: Record<string, string> = {
  cash: '現預金',
  ar: '売掛金',
  inventory: '棚卸資産',
  ap: '買掛金',
  fixedAssets: '固定資産',
  totalAssets: '総資産',
  interestBearingDebt: '有利子負債',
  equity: '純資産',
  netAssets: '純資産合計',
};

/* =========================================================
 * ユーティリティ
 * ========================================================= */

function formatNumber(n: number | string | undefined): string {
  if (n === undefined || n === null) return '—';
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString();
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return 'text-green-600';
  if (confidence >= 0.5) return 'text-yellow-600';
  return 'text-red-600';
}

/* =========================================================
 * メインコンポーネント
 * ========================================================= */

export default function DocumentImportPanel() {
  // Store - 安定した参照を使用（毎回新しい [] / {} を作らない）
  const financePL = useStrategyStore((s) => s.financePL ?? EMPTY_PL_ARR);
  const financeBS = useStrategyStore((s) => s.financeBS ?? EMPTY_BS_ARR);
  const segmentPL = useStrategyStore((s) => s.segmentPL ?? EMPTY_SEG_PL);
  const segmentBS = useStrategyStore((s) => s.segmentBS ?? EMPTY_SEG_BS);
  const setFinancePL = useStrategyStore((s) => s.setFinancePL);
  const setFinanceBS = useStrategyStore((s) => s.setFinanceBS);
  const setSegmentPL = useStrategyStore((s) => s.setSegmentPL);
  const setSegmentBS = useStrategyStore((s) => s.setSegmentBS);
  const setProfile = useStrategyStore((s) => s.setProfile);
  const recomputeValueAnalysis = useStrategyStore((s) => s.recomputeValueAnalysis);

  // UI State
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [candidates, setCandidates] = useState<Stage1ImportCandidate[]>([]);
  const [tableHints, setTableHints] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('companyPL');
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  // 候補をタブ別にグループ化
  const groupedCandidates = useMemo(() => {
    const groups: Record<TabKey, Stage1ImportCandidate[]> = {
      companyPL: [],
      companyBS: [],
      segmentPL: [],
      segmentBS: [],
      pbr: [],
    };
    for (const c of candidates) {
      if (c.kind in groups) {
        groups[c.kind as TabKey].push(c);
      }
    }
    return groups;
  }, [candidates]);

  // 各タブの候補数
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = {
      companyPL: 0,
      companyBS: 0,
      segmentPL: 0,
      segmentBS: 0,
      pbr: 0,
    };
    for (const c of candidates) {
      if (c.kind in counts) {
        counts[c.kind as TabKey]++;
      }
    }
    return counts;
  }, [candidates]);

  // ファイルアップロード
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setError(null);
    setCandidates([]);
    setTableHints([]);
    setApplyMessage(null);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      const res = await fetch('/api/stage1/import', {
        method: 'POST',
        body: formData,
      });

      const result: Stage1ImportResult = await res.json();

      if (!result.success) {
        setError(result.error || '解析に失敗しました');
        return;
      }

      setCandidates(result.candidates);
      setTableHints(result.tableHints || []);

      if (result.previewText) {
        setError(result.previewText);
      }

      // 候補があるタブを自動選択
      if (result.candidates.length > 0) {
        const firstKind = result.candidates[0].kind as TabKey;
        if (firstKind in TAB_LABELS) {
          setActiveTab(firstKind);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '通信エラー');
    } finally {
      setIsUploading(false);
      // ファイル入力をリセット
      e.target.value = '';
    }
  }, []);

  // 候補を適用
  const handleApply = useCallback(() => {
    if (candidates.length === 0) return;

    let appliedCount = 0;

    // PL候補を適用
    const plCandidates = groupedCandidates.companyPL;
    if (plCandidates.length > 0) {
      const plMap = new Map<number, FinancePLRow>();
      // 既存データをマップに
      for (const row of financePL) {
        plMap.set(row.year, { ...row });
      }
      // 候補をマージ
      for (const c of plCandidates) {
        if (!c.year) continue;
        const existing = plMap.get(c.year) ?? { year: c.year };
        for (const [key, val] of Object.entries(c.fields)) {
          if (val !== undefined && typeof val === 'number') {
            (existing as any)[key] = val;
          }
        }
        plMap.set(c.year, existing);
        appliedCount++;
      }
      // ソートして設定
      const newPL = Array.from(plMap.values()).sort((a, b) => a.year - b.year);
      setFinancePL(newPL);
    }

    // BS候補を適用
    const bsCandidates = groupedCandidates.companyBS;
    if (bsCandidates.length > 0) {
      const bsMap = new Map<number, FinanceBSRow>();
      // 既存データをマップに
      for (const row of financeBS) {
        bsMap.set(row.year, { ...row });
      }
      // 候補をマージ
      for (const c of bsCandidates) {
        if (!c.year) continue;
        const existing = bsMap.get(c.year) ?? { year: c.year };
        for (const [key, val] of Object.entries(c.fields)) {
          if (val !== undefined && typeof val === 'number') {
            (existing as any)[key] = val;
          }
        }
        bsMap.set(c.year, existing);
        appliedCount++;
      }
      // ソートして設定
      const newBS = Array.from(bsMap.values()).sort((a, b) => a.year - b.year);
      setFinanceBS(newBS);
    }

    // segmentPL候補を適用
    const segPlCandidates = groupedCandidates.segmentPL;
    if (segPlCandidates.length > 0) {
      const newSegmentPL = { ...segmentPL };
      for (const c of segPlCandidates) {
        if (!c.year || !c.segmentName) continue;
        const segName = c.segmentName;
        if (!newSegmentPL[segName]) {
          newSegmentPL[segName] = [];
        }
        const segMap = new Map<number, FinancePLRow>();
        for (const row of newSegmentPL[segName]) {
          segMap.set(row.year, { ...row });
        }
        const existing = segMap.get(c.year) ?? { year: c.year };
        for (const [key, val] of Object.entries(c.fields)) {
          if (val !== undefined && typeof val === 'number') {
            (existing as any)[key] = val;
          }
        }
        segMap.set(c.year, existing);
        newSegmentPL[segName] = Array.from(segMap.values()).sort((a, b) => a.year - b.year);
        appliedCount++;
      }
      setSegmentPL(newSegmentPL);
    }

    // segmentBS候補を適用
    const segBsCandidates = groupedCandidates.segmentBS;
    if (segBsCandidates.length > 0) {
      const newSegmentBS = { ...segmentBS };
      for (const c of segBsCandidates) {
        if (!c.year || !c.segmentName) continue;
        const segName = c.segmentName;
        if (!newSegmentBS[segName]) {
          newSegmentBS[segName] = [];
        }
        const segMap = new Map<number, SegmentBSRow>();
        for (const row of newSegmentBS[segName]) {
          segMap.set(row.year, { ...row });
        }
        const existing = segMap.get(c.year) ?? { year: c.year };
        for (const [key, val] of Object.entries(c.fields)) {
          if (val !== undefined && typeof val === 'number') {
            (existing as any)[key] = val;
          }
        }
        segMap.set(c.year, existing);
        newSegmentBS[segName] = Array.from(segMap.values()).sort((a, b) => a.year - b.year);
        appliedCount++;
      }
      setSegmentBS(newSegmentBS);
    }

    // PBR候補を適用
    const pbrCandidates = groupedCandidates.pbr;
    if (pbrCandidates.length > 0) {
      const pbr = pbrCandidates[0].fields.pbr;
      if (pbr !== undefined) {
        setProfile({ pbrManual: String(pbr) });
        appliedCount++;
      }
    }

    // valueAnalysis を再計算（importApply として呼び出し）
    setTimeout(() => {
      recomputeValueAnalysis('setFinancePL');
    }, 100);

    setApplyMessage(`${appliedCount}件の候補を適用しました`);
    setTimeout(() => setApplyMessage(null), 3000);
  }, [
    candidates,
    groupedCandidates,
    financePL,
    financeBS,
    segmentPL,
    segmentBS,
    setFinancePL,
    setFinanceBS,
    setSegmentPL,
    setSegmentBS,
    setProfile,
    recomputeValueAnalysis,
  ]);

  // 結果を破棄
  const handleDiscard = useCallback(() => {
    setCandidates([]);
    setTableHints([]);
    setError(null);
    setApplyMessage(null);
  }, []);

  // 年度別にグループ化した候補テーブル
  const renderCandidateTable = useCallback(
    (tabCandidates: Stage1ImportCandidate[], fieldLabels: Record<string, string>) => {
      if (tabCandidates.length === 0) {
        return (
          <div className="text-sm text-gray-500 py-4 text-center">
            候補がありません
          </div>
        );
      }

      // 年度でグループ化
      const byYear = new Map<number, Record<string, number | string | undefined>>();
      const allFields = new Set<string>();

      for (const c of tabCandidates) {
        if (!c.year) continue;
        const existing = byYear.get(c.year) ?? {};
        for (const [key, val] of Object.entries(c.fields)) {
          existing[key] = val;
          allFields.add(key);
        }
        byYear.set(c.year, existing);
      }

      const years = Array.from(byYear.keys()).sort((a, b) => a - b);
      const fields = Array.from(allFields).filter((f) => f in fieldLabels);

      if (years.length === 0) {
        return (
          <div className="text-sm text-gray-500 py-4 text-center">
            年度情報がありません
          </div>
        );
      }

      return (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left font-semibold text-gray-700 border">項目</th>
                {years.map((y) => (
                  <th key={y} className="px-3 py-2 text-right font-semibold text-gray-700 border min-w-[80px]">
                    {y}年度
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field} className="border-t">
                  <td className="px-3 py-2 text-gray-700 border bg-white">
                    {fieldLabels[field] || field}
                  </td>
                  {years.map((y) => {
                    const data = byYear.get(y);
                    const val = data?.[field];
                    return (
                      <td key={y} className="px-3 py-2 text-right border bg-white">
                        {formatNumber(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },
    []
  );

  // 信頼度表示
  const avgConfidence = useMemo(() => {
    if (candidates.length === 0) return 0;
    const sum = candidates.reduce((acc, c) => acc + c.confidence, 0);
    return sum / candidates.length;
  }, [candidates]);

  return (
    <section className="border border-gray-200 rounded-lg overflow-hidden">
      {/* ヘッダー（折りたたみ） */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">資料アップロード（PDF/Excel/CSV）</span>
          {candidates.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
              {candidates.length}件の候補
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* コンテンツ */}
      {isOpen && (
        <div className="p-4 bg-white space-y-4">
          <p className="text-sm text-gray-600">
            決算書やセグメント情報のPDF・Excelをアップロードすると、財務データを自動抽出します。
            抽出結果を確認してから「適用」ボタンで反映できます。
          </p>

          {/* ファイルアップロード */}
          <div className="flex items-center gap-4">
            <label className="relative cursor-pointer">
              <input
                type="file"
                multiple
                accept=".pdf,.xlsx,.xls,.csv"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <span
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded border transition ${
                  isUploading
                    ? 'bg-gray-100 border-gray-300 text-gray-400'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {isUploading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    解析中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                    ファイルを選択
                  </>
                )}
              </span>
            </label>
            <span className="text-xs text-gray-500">PDF / Excel / CSV（複数可）</span>
          </div>

          {/* テーブルヒント */}
          {tableHints.length > 0 && (
            <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
              {tableHints.map((hint, i) => (
                <div key={i}>{hint}</div>
              ))}
            </div>
          )}

          {/* エラー/警告 */}
          {error && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
              {error}
            </div>
          )}

          {/* 候補表示 */}
          {candidates.length > 0 && (
            <div className="space-y-3">
              {/* 信頼度表示 */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">平均信頼度:</span>
                <span className={getConfidenceColor(avgConfidence)}>
                  {Math.round(avgConfidence * 100)}%
                </span>
                {avgConfidence < 0.5 && (
                  <span className="text-amber-600">
                    （信頼度が低いため、適用後に確認してください）
                  </span>
                )}
              </div>

              {/* タブ */}
              <div className="flex gap-1 border-b border-gray-200">
                {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`px-3 py-2 text-xs font-medium transition ${
                      activeTab === key
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {TAB_LABELS[key]}
                    {tabCounts[key] > 0 && (
                      <span className="ml-1 text-gray-400">({tabCounts[key]})</span>
                    )}
                  </button>
                ))}
              </div>

              {/* タブコンテンツ */}
              <div className="min-h-[100px]">
                {activeTab === 'companyPL' &&
                  renderCandidateTable(groupedCandidates.companyPL, PL_FIELD_LABELS)}
                {activeTab === 'companyBS' &&
                  renderCandidateTable(groupedCandidates.companyBS, BS_FIELD_LABELS)}
                {activeTab === 'segmentPL' &&
                  renderCandidateTable(groupedCandidates.segmentPL, PL_FIELD_LABELS)}
                {activeTab === 'segmentBS' &&
                  renderCandidateTable(groupedCandidates.segmentBS, BS_FIELD_LABELS)}
                {activeTab === 'pbr' && (
                  <div className="text-sm">
                    {groupedCandidates.pbr.length > 0 ? (
                      <div className="p-4 bg-gray-50 rounded">
                        PBR: {formatNumber(groupedCandidates.pbr[0]?.fields.pbr)}
                      </div>
                    ) : (
                      <div className="text-gray-500 py-4 text-center">PBR候補がありません</div>
                    )}
                  </div>
                )}
              </div>

              {/* 適用ボタン（目立つように） */}
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm text-blue-800">
                    <span className="font-medium">抽出した{candidates.length}件のデータを財務入力に反映します</span>
                    <p className="text-xs text-blue-600 mt-1">
                      ※ 既存のデータがある場合はマージされます
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDiscard}
                      className="shrink-0 px-4 py-3 text-sm font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                    >
                      結果を破棄
                    </button>
                    <button
                      onClick={handleApply}
                      className="shrink-0 px-6 py-3 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm"
                    >
                      ↓ 財務入力に適用
                    </button>
                  </div>
                </div>
                {applyMessage && (
                  <div className="mt-3 text-sm text-green-700 bg-green-100 px-3 py-2 rounded">
                    ✓ {applyMessage}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
