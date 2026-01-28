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
const EMPTY_SEGMENTS: any[] = Object.freeze([]) as unknown as any[];

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

function safeJsonStringify(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * 年度を number に正規化（"2024", "2024年度", 2024 などを許容）
 */
function toYear(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  const s = String(v).trim();
  if (!s) return null;

  // 例: "2024年度", "FY2024" などから数字だけ抜く
  const m = s.match(/(19|20)\d{2}/);
  if (!m) return null;

  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * kind の表記ゆれを吸収する（API側の出力ブレに耐える）
 * - "segment_pl"
 * - "segmentPL:事業部A"
 * - "segmentBS/事業部B"
 * のような場合も許容
 */
function normalizeKind(k: any): TabKey | null {
  const raw = String(k ?? '').trim();
  if (!raw) return null;

  // suffix を落とす（":" "/" "|" 以降は事業部名などの可能性）
  const head = raw.split(':')[0].split('/')[0].split('|')[0].trim();
  const lower = head.toLowerCase();

  if (lower === 'companypl' || lower === 'company_pl') return 'companyPL';
  if (lower === 'companybs' || lower === 'company_bs') return 'companyBS';
  if (lower === 'segmentpl' || lower === 'segment_pl' || lower === 'segpl') return 'segmentPL';
  if (lower === 'segmentbs' || lower === 'segment_bs' || lower === 'segbs') return 'segmentBS';
  if (lower === 'pbr') return 'pbr';

  // 元が正規の TabKey ならそのまま
  if (head in TAB_LABELS) return head as TabKey;

  return null;
}

/**
 * 事業部名（segmentName）の表記ゆれを吸収する
 * - APIが segmentName 以外のキーで返しても適用できるようにする
 * - kind に "segmentPL:事業部A" のように埋め込まれていても拾う
 */
function pickSegmentName(c: any): string | null {
  const raw =
    c?.segmentName ??
    c?.segment ??
    c?.segment_name ??
    c?.businessSegment ??
    c?.businessSegmentName ??
    c?.departmentName ??
    c?.deptName ??
    c?.fields?.segmentName ??
    c?.fields?.segment ??
    c?.fields?.departmentName ??
    c?.['事業部'];

  const s0 = typeof raw === 'string' ? raw : raw != null ? String(raw) : '';
  const out0 = s0.trim();
  if (out0) return out0;

  // kind に埋め込まれているケースを拾う（例: "segmentPL:事業部A"）
  const kind = String(c?.kind ?? '').trim();
  if (kind) {
    const parts = kind.split(':');
    if (parts.length >= 2) {
      const out1 = parts.slice(1).join(':').trim();
      if (out1) return out1;
    }
    // "segmentBS/事業部B" など
    const parts2 = kind.split('/');
    if (parts2.length >= 2) {
      const out2 = parts2.slice(1).join('/').trim();
      if (out2) return out2;
    }
  }

  return null;
}

/**
 * segmentPL / segmentBS の kind が崩れているケースを fields から推定して補正
 * - keys が PL_FIELD_LABELS に多く一致する → segmentPL
 * - keys が BS_FIELD_LABELS に多く一致する → segmentBS
 */
function inferSegmentKindFromFields(c: any): TabKey | null {
  const fields = c?.fields ?? {};
  const keys = Object.keys(fields);

  const plHit = keys.some((k) => k in PL_FIELD_LABELS);
  const bsHit = keys.some((k) => k in BS_FIELD_LABELS);

  if (plHit && !bsHit) return 'segmentPL';
  if (bsHit && !plHit) return 'segmentBS';
  return null;
}

/** kindを正規化し、必要ならfieldsから補正する（UI側で最短復旧するため） */
function resolveTabKey(c: any): TabKey | null {
  let k = normalizeKind(c?.kind);
  if (!k) return null;

  if (k === 'segmentPL' || k === 'segmentBS') {
    const inferred = inferSegmentKindFromFields(c);
    if (inferred) k = inferred;
  }
  return k;
}

/**
 * businessSegments の型が（string[] / {name}[] / {segmentName}[] 等）混在しても
 * 事業部名の重複を避けて追加する
 */
function mergeBusinessSegments(existing: any[], addNames: string[]): any[] {
  const ex = Array.isArray(existing) ? existing : [];
  const names = new Set<string>();

  const extractName = (x: any): string | null => {
    if (typeof x === 'string') return x.trim() || null;
    if (x && typeof x === 'object') {
      const v = x.name ?? x.segmentName ?? x.title ?? x.label;
      const s = typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : '';
      return s || null;
    }
    return null;
  };

  for (const item of ex) {
    const n = extractName(item);
    if (n) names.add(n);
  }
  for (const n of addNames.map((x) => String(x ?? '').trim()).filter(Boolean)) {
    names.add(n);
  }

  // 既存の型に寄せる：string[] なら string[]、object[] なら {name} を追加
  const existingLooksString = ex.length === 0 ? false : ex.every((x) => typeof x === 'string');
  if (existingLooksString) {
    return Array.from(names);
  }

  // object[] 想定
  const byName = new Map<string, any>();
  for (const item of ex) {
    const n = extractName(item);
    if (n) byName.set(n, item);
  }
  for (const n of names) {
    if (!byName.has(n)) byName.set(n, { name: n });
  }

  return Array.from(byName.values());
}

/* =========================================================
 * メインコンポーネント
 * ========================================================= */
export default function DocumentImportPanel() {
  // Store
  const financePL = useStrategyStore((s) => s.financePL ?? EMPTY_PL_ARR);
  const financeBS = useStrategyStore((s) => s.financeBS ?? EMPTY_BS_ARR);
  const segmentPL = useStrategyStore((s) => s.segmentPL ?? EMPTY_SEG_PL);
  const segmentBS = useStrategyStore((s) => s.segmentBS ?? EMPTY_SEG_BS);

  // 事業部一覧（ここが更新されないと「事業部別が画面に出ない」）
  const businessSegments = useStrategyStore((s) => (s as any).businessSegments ?? EMPTY_SEGMENTS);
  const setBusinessSegments = useStrategyStore((s) => (s as any).setBusinessSegments);

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

  // 解析レスポンスの要約（ボタンが出ない時に原因が見えるようにする）
  const [lastDebug, setLastDebug] = useState<{
    ok: boolean;
    httpStatus?: number;
    candidatesCount?: number;
    kinds?: Record<string, number>;
    rawPreviewText?: string;
  } | null>(null);

  // 候補をタブ別にグループ化（kind 正規化 + fields補正込み）
  const groupedCandidates = useMemo(() => {
    const groups: Record<TabKey, Stage1ImportCandidate[]> = {
      companyPL: [],
      companyBS: [],
      segmentPL: [],
      segmentBS: [],
      pbr: [],
    };

    const unmapped: Stage1ImportCandidate[] = [];
    for (const c of candidates) {
      const k = resolveTabKey(c as any);
      if (!k) {
        unmapped.push(c);
        continue;
      }
      groups[k].push(c);
    }

    // ★ DEBUG：グループ化結果をログ
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1' || unmapped.length > 0) {
      const segmentPLSegs = new Set<string>();
      const segmentBSSegs = new Set<string>();

      for (const c of groups.segmentPL) {
        const seg = pickSegmentName(c as any);
        if (seg) segmentPLSegs.add(seg);
      }
      for (const c of groups.segmentBS) {
        const seg = pickSegmentName(c as any);
        if (seg) segmentBSSegs.add(seg);
      }

      console.log('[DocumentImportPanel] groupedCandidates', {
        companyPL: groups.companyPL.length,
        companyBS: groups.companyBS.length,
        segmentPL: groups.segmentPL.length,
        segmentPLSegments: Array.from(segmentPLSegs),
        segmentBS: groups.segmentBS.length,
        segmentBSSegments: Array.from(segmentBSSegs),
        pbr: groups.pbr.length,
        unmappedCount: unmapped.length,
        unmappedKinds: unmapped.map((c) => (c as any).kind),
      });
    }

    return groups;
  }, [candidates]);

  // 各タブの候補数（kind 正規化 + fields補正込み）
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = {
      companyPL: 0,
      companyBS: 0,
      segmentPL: 0,
      segmentBS: 0,
      pbr: 0,
    };

    for (const c of candidates) {
      const k = resolveTabKey(c as any);
      if (!k) continue;
      counts[k]++;
    }
    return counts;
  }, [candidates]);

  // ファイルアップロード
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // アップロード開始時に必ず開く（結果が見えず「ボタンが出ない」状態を防ぐ）
    setIsOpen(true);

    setIsUploading(true);
    setError(null);
    setCandidates([]);
    setTableHints([]);
    setApplyMessage(null);
    setLastDebug(null);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      const res = await fetch('/api/stage1/import', { method: 'POST', body: formData });

      // 非200のとき、本文も含めて表示（原因が見える）
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setLastDebug({ ok: false, httpStatus: res.status });
        setError(`取込APIが失敗しました（HTTP ${res.status}）。\n${text ? `\n${text}` : ''}`.trim());
        return;
      }

      const result = (await res.json()) as Stage1ImportResult;

      if (!result || typeof result !== 'object') {
        setLastDebug({ ok: false, httpStatus: res.status });
        setError('取込APIのレスポンス形式が不正です（JSONではありません）');
        return;
      }

      if (!(result as any).success) {
        setLastDebug({
          ok: false,
          httpStatus: res.status,
          rawPreviewText: (result as any).previewText,
        });
        setError((result as any).error || '解析に失敗しました');
        return;
      }

      const nextCandidates = Array.isArray((result as any).candidates)
        ? ((result as any).candidates as Stage1ImportCandidate[])
        : [];
      const nextHints = Array.isArray((result as any).tableHints) ? ((result as any).tableHints as string[]) : [];

      // kinds 要約（生kind + 正規化kind を両方見えるようにする）
      const kinds: Record<string, number> = {};
      for (const c of nextCandidates) {
        const rawKind = String((c as any)?.kind ?? 'unknown');
        const norm = resolveTabKey(c as any);
        const key = norm ? `${rawKind} -> ${norm}` : `${rawKind} -> (unmapped)`;
        kinds[key] = (kinds[key] ?? 0) + 1;
      }
      setLastDebug({
        ok: true,
        httpStatus: res.status,
        candidatesCount: nextCandidates.length,
        kinds,
        rawPreviewText: (result as any).previewText,
      });

      // ★ DEBUG：APIレスポンスで受け取った候補をセグメント別に分析
      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        const segmentNames = new Set<string>();
        const byKind: Record<string, number> = {};
        const bySegment: Record<string, number> = {};

        for (const c of nextCandidates) {
          const kind = String((c as any).kind ?? 'unknown');
          byKind[kind] = (byKind[kind] ?? 0) + 1;

          const segName = pickSegmentName(c as any);
          if (segName) {
            segmentNames.add(segName);
            bySegment[segName] = (bySegment[segName] ?? 0) + 1;
          }
        }

        console.log('[DocumentImportPanel] candidates from API', {
          totalCandidates: nextCandidates.length,
          uniqueSegmentNames: Array.from(segmentNames),
          byKind,
          bySegment,
        });
      }

      setCandidates(nextCandidates);
      setTableHints(nextHints);

      // previewText は「エラー」ではなく注意書きとして出るケースがあるため、
      // UI上は amber に表示する（既存挙動維持）
      if ((result as any).previewText) {
        setError(String((result as any).previewText));
      }

      // 候補があるタブを自動選択（正規化kindで）
      if (nextCandidates.length > 0) {
        const firstNorm = resolveTabKey(nextCandidates[0] as any);
        if (firstNorm) setActiveTab(firstNorm);
      } else {
        setError(
          (prev) =>
            prev ??
            '解析は完了しましたが、抽出候補が0件でした。PDF/Excelの表構造（年度列・項目名・単位）を確認してください。'
        );
      }
    } catch (err) {
      setLastDebug({ ok: false });
      setError(err instanceof Error ? err.message : '通信エラー');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  }, []);

  // 候補を適用
  const handleApply = useCallback(() => {
    if (candidates.length === 0) return;

    let appliedCount = 0;
    let appliedSegmentAnything = false;

    // ★ kind 正規化（API側の出力ブレに対応）
    const normalizeKindSimple = (k: any): string => {
      const s = String(k ?? '').trim().toLowerCase();
      if (s === 'company_pl' || s === 'companypl') return 'companyPL';
      if (s === 'company_bs' || s === 'companybs') return 'companyBS';
      if (s === 'segment_pl' || s === 'segmentpl' || s === 'segpl') return 'segmentPL';
      if (s === 'segment_bs' || s === 'segmentbs' || s === 'segbs') return 'segmentBS';
      if (s === 'pbr') return 'pbr';
      return String(k ?? '');
    };

    // ★ candidate を FinancePLRow に変換（year 型チェック + キー正規化）
    const toPLRow = (c: any): FinancePLRow | null => {
      const y = toYear(c?.year);
      if (!Number.isFinite(y)) {
        console.warn('[DocumentImportPanel] PL candidate year invalid', {
          original: c?.year,
          parsed: y,
        });
        return null;
      }

      const f = c?.fields ?? {};
      return {
        year: y as number,
        revenue: f.revenue != null ? Number(f.revenue) : undefined,
        grossProfit: f.grossProfit != null ? Number(f.grossProfit) : undefined,
        cogs: f.cogs != null ? Number(f.cogs) : undefined,
        sga: f.sga != null ? Number(f.sga) : undefined,
        operatingIncome:
          f.operatingIncome != null
            ? Number(f.operatingIncome)
            : f.operatingProfit != null
              ? Number(f.operatingProfit)
              : undefined,
        depreciation: f.depreciation != null ? Number(f.depreciation) : undefined,
        interest: f.interest != null ? Number(f.interest) : undefined,
        tax: f.tax != null ? Number(f.tax) : undefined,
        netIncome: f.netIncome != null ? Number(f.netIncome) : undefined,
      };
    };

    // ★ candidate を FinanceBSRow に変換（year 型チェック + キー正規化）
    const toBSRow = (c: any): FinanceBSRow | null => {
      const y = toYear(c?.year);
      if (!Number.isFinite(y)) {
        console.warn('[DocumentImportPanel] BS candidate year invalid', {
          original: c?.year,
          parsed: y,
        });
        return null;
      }

      const f = c?.fields ?? {};
      return {
        year: y as number,
        cash: f.cash != null ? Number(f.cash) : undefined,
        ar: f.ar != null ? Number(f.ar) : undefined,
        inventory: f.inventory != null ? Number(f.inventory) : undefined,
        ap: f.ap != null ? Number(f.ap) : undefined,
        fixedAssets: f.fixedAssets != null ? Number(f.fixedAssets) : undefined,
        totalAssets: f.totalAssets != null ? Number(f.totalAssets) : undefined,
        interestBearingDebt: f.interestBearingDebt != null ? Number(f.interestBearingDebt) : undefined,
        equity: f.equity != null ? Number(f.equity) : undefined,
        netAssets: f.netAssets != null ? Number(f.netAssets) : undefined,
      };
    };

    // ★ DEBUG：kind別カウント（正規化前後）
    const countByRawKind: Record<string, number> = {};
    const countByNormalizedKind: Record<string, number> = {};
    for (const c of candidates) {
      const raw = String((c as any).kind ?? 'unknown');
      const norm = normalizeKindSimple((c as any).kind);
      countByRawKind[raw] = (countByRawKind[raw] ?? 0) + 1;
      countByNormalizedKind[norm] = (countByNormalizedKind[norm] ?? 0) + 1;
    }

    // ★ DEBUG：適用ボタン押下時の詳細ログ
    console.log('[DocumentImportPanel] handleApply START', {
      totalCandidates: candidates.length,
      countByRawKind,
      countByNormalizedKind,
      groupedByKind: {
        companyPL: groupedCandidates.companyPL.length,
        companyBS: groupedCandidates.companyBS.length,
        segmentPL: groupedCandidates.segmentPL.length,
        segmentBS: groupedCandidates.segmentBS.length,
        pbr: groupedCandidates.pbr.length,
      },
      currentStoreState: {
        financePL_len: financePL?.length ?? 0,
        financeBS_len: financeBS?.length ?? 0,
        segmentPL_keys: Object.keys(segmentPL ?? {}).length,
        segmentBS_keys: Object.keys(segmentBS ?? {}).length,
        businessSegments_len: businessSegments?.length ?? 0,
      },
    });

    // 事業部名の収集（適用後に businessSegments を自動登録する）
    const importedSegNames = new Set<string>();
    for (const c of [...groupedCandidates.segmentPL, ...groupedCandidates.segmentBS]) {
      const n = pickSegmentName(c as any);
      if (n) importedSegNames.add(n);
    }

    // PL候補を適用
    const plCandidates = groupedCandidates.companyPL;
    if (plCandidates.length > 0) {
      // ★ candidates を FinancePLRow に変換（year 型強制 + キー正規化）
      const convertedPL = plCandidates
        .map((c) => toPLRow(c))
        .filter((r) => r !== null) as FinancePLRow[];

      console.log('[DocumentImportPanel] PL candidates converted', {
        originalCount: plCandidates.length,
        convertedCount: convertedPL.length,
        filtered: plCandidates.length - convertedPL.length,
      });

      if (convertedPL.length > 0) {
        const plMap = new Map<number, FinancePLRow>();
        for (const row of financePL) plMap.set(row.year, { ...row });

        for (const row of convertedPL) {
          const existing = plMap.get(row.year) ?? { ...row };
          // 既存行とマージ（新しいデータで上書き）
          for (const [key, val] of Object.entries(row)) {
            if (val !== undefined) (existing as any)[key] = val;
          }
          plMap.set(row.year, existing);
          appliedCount++;
        }

        const newPL = Array.from(plMap.values()).sort((a, b) => a.year - b.year);
        setFinancePL(newPL);

        console.log('[DocumentImportPanel] companyPL applied', {
          candidatesCount: plCandidates.length,
          convertedCount: convertedPL.length,
          appliedRowCount: newPL.length,
          yearsInNewPL: newPL.map((r) => r.year),
        });
      }

      // ★ DEBUG：setFinancePL 直後のスナップショット
      setTimeout(() => {
        const s = useStrategyStore.getState();
        console.log('[DocumentImportPanel] after setFinancePL snapshot', {
          financePL_len: s.financePL?.length ?? null,
          financeBS_len: s.financeBS?.length ?? null,
          segmentPL_keys: Object.keys(s.segmentPL ?? {}),
          segmentBS_keys: Object.keys(s.segmentBS ?? {}),
        });
      }, 10);
    }

    // BS候補を適用
    const bsCandidates = groupedCandidates.companyBS;
    if (bsCandidates.length > 0) {
      // ★ candidates を FinanceBSRow に変換（year 型強制 + キー正規化）
      const convertedBS = bsCandidates
        .map((c) => toBSRow(c))
        .filter((r) => r !== null) as FinanceBSRow[];

      console.log('[DocumentImportPanel] BS candidates converted', {
        originalCount: bsCandidates.length,
        convertedCount: convertedBS.length,
        filtered: bsCandidates.length - convertedBS.length,
      });

      if (convertedBS.length > 0) {
        const bsMap = new Map<number, FinanceBSRow>();
        for (const row of financeBS) bsMap.set(row.year, { ...row });

        for (const row of convertedBS) {
          const existing = bsMap.get(row.year) ?? { ...row };
          // 既存行とマージ（新しいデータで上書き）
          for (const [key, val] of Object.entries(row)) {
            if (val !== undefined) (existing as any)[key] = val;
          }
          bsMap.set(row.year, existing);
          appliedCount++;
        }

        const newBS = Array.from(bsMap.values()).sort((a, b) => a.year - b.year);
        setFinanceBS(newBS);

        console.log('[DocumentImportPanel] companyBS applied', {
          candidatesCount: bsCandidates.length,
          convertedCount: convertedBS.length,
          appliedRowCount: newBS.length,
          yearsInNewBS: newBS.map((r) => r.year),
        });
      }

      // ★ DEBUG：setFinanceBS 直後のスナップショット
      setTimeout(() => {
        const s = useStrategyStore.getState();
        console.log('[DocumentImportPanel] after setFinanceBS snapshot', {
          financePL_len: s.financePL?.length ?? null,
          financeBS_len: s.financeBS?.length ?? null,
          segmentPL_keys: Object.keys(s.segmentPL ?? {}),
          segmentBS_keys: Object.keys(s.segmentBS ?? {}),
        });
      }, 10);
    }

    // segmentPL候補を適用（segmentName 表記ゆれ吸収 + year 正規化）
    const segPlCandidates = groupedCandidates.segmentPL;
    if (segPlCandidates.length > 0) {
      const newSegmentPL: Record<string, FinancePLRow[]> = { ...(segmentPL ?? {}) };
      const processedSegments = new Set<string>();

      for (const c of segPlCandidates) {
        const y = toYear((c as any).year);
        if (!y) continue;

        const segName = pickSegmentName(c as any);
        if (!segName) continue;

        if (!newSegmentPL[segName]) newSegmentPL[segName] = [];
        processedSegments.add(segName);

        const segMap = new Map<number, FinancePLRow>();
        for (const row of newSegmentPL[segName]) segMap.set(row.year, { ...row });

        const existing = segMap.get(y) ?? ({ year: y } as FinancePLRow);
        for (const [key, val] of Object.entries((c as any).fields ?? {})) {
          if (val !== undefined && typeof val === 'number') (existing as any)[key] = val;
        }
        segMap.set(y, existing);
        newSegmentPL[segName] = Array.from(segMap.values()).sort((a, b) => a.year - b.year);

        appliedCount++;
        appliedSegmentAnything = true;
      }

      // ★ DEBUG：セグメントPL適用前後の状態をログ
      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        const candidateSegments = new Map<string, number>();
        for (const c of segPlCandidates) {
          const seg = pickSegmentName(c as any);
          if (seg) candidateSegments.set(seg, (candidateSegments.get(seg) ?? 0) + 1);
        }

        console.log('[DocumentImportPanel] segmentPL apply', {
          totalCandidates: segPlCandidates.length,
          candidatesBySegment: Object.fromEntries(candidateSegments),
          processedSegments: Array.from(processedSegments),
          beforeKeys: Object.keys(segmentPL || {}),
          afterKeys: Object.keys(newSegmentPL),
          keysAdded: Object.keys(newSegmentPL).filter((k) => !(segmentPL as any)?.[k]),
          finalSegmentPLDistribution: Object.fromEntries(
            Object.entries(newSegmentPL).map(([k, v]) => [k, v?.length ?? 0])
          ),
        });
      }

      setSegmentPL(newSegmentPL);

      // ★ DEBUG：setSegmentPL 直後のスナップショット
      setTimeout(() => {
        const s = useStrategyStore.getState();
        console.log('[DocumentImportPanel] after setSegmentPL snapshot', {
          financePL_len: s.financePL?.length ?? null,
          financeBS_len: s.financeBS?.length ?? null,
          segmentPL_keys: Object.keys(s.segmentPL ?? {}),
          segmentPL_distribution: Object.fromEntries(
            Object.entries(s.segmentPL ?? {}).map(([k, v]) => [k, (v as any)?.length ?? 0])
          ),
          segmentBS_keys: Object.keys(s.segmentBS ?? {}),
        });
      }, 10);
    }

    // segmentBS候補を適用（segmentName 表記ゆれ吸収 + year 正規化）
    const segBsCandidates = groupedCandidates.segmentBS;
    if (segBsCandidates.length > 0) {
      const newSegmentBS: Record<string, SegmentBSRow[]> = { ...(segmentBS ?? {}) };
      const processedSegmentsBS = new Set<string>();

      for (const c of segBsCandidates) {
        const y = toYear((c as any).year);
        if (!y) continue;

        const segName = pickSegmentName(c as any);
        if (!segName) continue;

        if (!newSegmentBS[segName]) newSegmentBS[segName] = [];
        processedSegmentsBS.add(segName);

        const segMap = new Map<number, SegmentBSRow>();
        for (const row of newSegmentBS[segName]) {
          const ry = toYear((row as any)?.year);
          if (ry) segMap.set(ry, { ...(row as any) });
        }

        const existing = (segMap.get(y) ?? ({ year: y } as any)) as SegmentBSRow;
        for (const [key, val] of Object.entries((c as any).fields ?? {})) {
          if (val !== undefined && typeof val === 'number') (existing as any)[key] = val;
        }
        segMap.set(y, existing);

        newSegmentBS[segName] = Array.from(segMap.values()).sort(
          (a: any, b: any) => (toYear(a?.year) ?? 0) - (toYear(b?.year) ?? 0)
        ) as any;

        appliedCount++;
        appliedSegmentAnything = true;
      }

      // ★ DEBUG：セグメントBS適用前後の状態をログ
      if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
        const candidateSegmentsBS = new Map<string, number>();
        for (const c of segBsCandidates) {
          const seg = pickSegmentName(c as any);
          if (seg) candidateSegmentsBS.set(seg, (candidateSegmentsBS.get(seg) ?? 0) + 1);
        }

        console.log('[DocumentImportPanel] segmentBS apply', {
          totalCandidates: segBsCandidates.length,
          candidatesBySegment: Object.fromEntries(candidateSegmentsBS),
          processedSegments: Array.from(processedSegmentsBS),
          beforeKeys: Object.keys(segmentBS || {}),
          afterKeys: Object.keys(newSegmentBS),
          keysAdded: Object.keys(newSegmentBS).filter((k) => !(segmentBS as any)?.[k]),
          finalSegmentBSDistribution: Object.fromEntries(
            Object.entries(newSegmentBS).map(([k, v]) => [k, v?.length ?? 0])
          ),
        });
      }

      setSegmentBS(newSegmentBS);

      // ★ DEBUG：setSegmentBS 直後のスナップショット
      setTimeout(() => {
        const s = useStrategyStore.getState();
        console.log('[DocumentImportPanel] after setSegmentBS snapshot', {
          financePL_len: s.financePL?.length ?? null,
          financeBS_len: s.financeBS?.length ?? null,
          segmentPL_keys: Object.keys(s.segmentPL ?? {}),
          segmentBS_keys: Object.keys(s.segmentBS ?? {}),
          segmentBS_distribution: Object.fromEntries(
            Object.entries(s.segmentBS ?? {}).map(([k, v]) => [k, (v as any)?.length ?? 0])
          ),
        });
      }, 10);
    }

    // PBR候補を適用
    const pbrCandidates = groupedCandidates.pbr;
    if (pbrCandidates.length > 0) {
      const pbr = (pbrCandidates[0] as any)?.fields?.pbr;
      if (pbr !== undefined) {
        setProfile({ pbrManual: String(pbr) });
        appliedCount++;
      }
    }

    // 重要：事業部が抽出できた場合は businessSegments に自動登録（表示されない問題の根治）
    if (typeof setBusinessSegments === 'function' && importedSegNames.size > 0) {
      const merged = mergeBusinessSegments(businessSegments, Array.from(importedSegNames));
      setBusinessSegments(merged);
    }

    // ★ DEBUG：適用完了時の最終状態をログ
    console.log('[DocumentImportPanel] handleApply COMPLETE', {
      totalAppliedCount: appliedCount,
      appliedSegmentAnything,
      importedSegmentNames: Array.from(importedSegNames),
      finalStoreState: {
        financePL_len: financePL?.length ?? 0,
        financeBS_len: financeBS?.length ?? 0,
        segmentPL_keys: Object.keys(segmentPL ?? {}).length,
        segmentBS_keys: Object.keys(segmentBS ?? {}).length,
        businessSegments_len: businessSegments?.length ?? 0,
      },
    });

    // ★ DEBUG：実際のZustand state を確認（setterが反映されたか確認）
    setTimeout(() => {
      const actualState = useStrategyStore.getState();
      const actualFinancePL = actualState.financePL ?? [];
      const actualFinanceBS = actualState.financeBS ?? [];
      const actualSegmentPL = actualState.segmentPL ?? {};
      const actualSegmentBS = actualState.segmentBS ?? {};

      console.log('[DocumentImportPanel] actualStoreState after setters', {
        financePL_len: actualFinancePL.length,
        financePL_years: actualFinancePL.map((r: any) => r.year),
        financeBS_len: actualFinanceBS.length,
        financeBS_years: actualFinanceBS.map((r: any) => r.year),
        segmentPL_keys: Object.keys(actualSegmentPL),
        segmentPL_distribution: Object.fromEntries(
          Object.entries(actualSegmentPL).map(([k, v]) => [k, (v as any)?.length ?? 0])
        ),
        segmentBS_keys: Object.keys(actualSegmentBS),
        segmentBS_distribution: Object.fromEntries(
          Object.entries(actualSegmentBS).map(([k, v]) => [k, (v as any)?.length ?? 0])
        ),
      });
    }, 50);

    // valueAnalysis を再計算（引数は union に収まる値のみ）
    setTimeout(() => {
      // 事業部が絡んだときは segment を起点に再計算（ダッシュボードの反映も安定する）
      if (appliedSegmentAnything) {
        recomputeValueAnalysis('setSegmentPL');
      } else {
        recomputeValueAnalysis('setFinancePL');
      }
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
    businessSegments,
    setBusinessSegments,
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
    setLastDebug(null);
  }, []);

  // 年度別にグループ化した候補テーブル（事業部の場合は “事業部別に分割表示” して上書きを防ぐ）
  const renderCandidateTable = useCallback(
    (tabCandidates: Stage1ImportCandidate[], fieldLabels: Record<string, string>) => {
      if (tabCandidates.length === 0) {
        return <div className="text-sm text-gray-500 py-4 text-center">候補がありません</div>;
      }

      const renderSingleTable = (rows: Stage1ImportCandidate[]) => {
        if (rows.length === 0) {
          return <div className="text-sm text-gray-500 py-4 text-center">候補がありません</div>;
        }

        const byYear = new Map<number, Record<string, number | string | undefined>>();
        const allFields = new Set<string>();

        for (const c of rows) {
          const y = toYear((c as any).year);
          if (!y) continue;

          const existing = byYear.get(y) ?? {};
          for (const [key, val] of Object.entries((c as any).fields ?? {})) {
            existing[key] = val as any;
            allFields.add(key);
          }
          byYear.set(y, existing);
        }

        const years = Array.from(byYear.keys()).sort((a, b) => a - b);
        const fields = Array.from(allFields).filter((f) => f in fieldLabels);

        if (years.length === 0) {
          return <div className="text-sm text-gray-500 py-4 text-center">年度情報がありません</div>;
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
                    <td className="px-3 py-2 text-gray-700 border bg-white">{fieldLabels[field] || field}</td>
                    {years.map((y) => {
                      const data = byYear.get(y);
                      const val = data?.[field] as any;
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
      };

      // 事業部名が取れる候補がある場合は、事業部ごとに分割表示（年度上書き・潰れを防止）
      const segNames = new Set<string>();
      for (const c of tabCandidates) {
        const n = pickSegmentName(c as any);
        if (n) segNames.add(n);
      }
      const segList = Array.from(segNames).sort((a, b) => a.localeCompare(b, 'ja'));

      if (segList.length === 0) {
        return renderSingleTable(tabCandidates);
      }

      return (
        <div className="space-y-4">
          {segList.map((seg) => {
            const rows = tabCandidates.filter((c) => pickSegmentName(c as any) === seg);
            return (
              <div key={seg} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-700">
                  {seg}
                  <span className="ml-2 text-gray-400">({rows.length}件)</span>
                </div>
                <div className="p-2">{renderSingleTable(rows)}</div>
              </div>
            );
          })}
        </div>
      );
    },
    []
  );

  // 信頼度表示
  const avgConfidence = useMemo(() => {
    if (candidates.length === 0) return 0;
    const sum = candidates.reduce((acc, c) => acc + (Number((c as any).confidence) || 0), 0);
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
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{candidates.length}件の候補</span>
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

          {/* 解析レスポンス要約（ボタンが出ない原因を可視化） */}
          {lastDebug && (
            <div className="text-xs text-gray-700 bg-gray-50 p-3 rounded border border-gray-200">
              <div className="font-semibold mb-1">解析結果（デバッグ要約）</div>
              <pre className="whitespace-pre-wrap break-words">{safeJsonStringify(lastDebug)}</pre>
            </div>
          )}

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
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {/* 候補表示 */}
          {candidates.length > 0 && (
            <div className="space-y-3">
              {/* 信頼度表示 */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">平均信頼度:</span>
                <span className={getConfidenceColor(avgConfidence)}>{Math.round(avgConfidence * 100)}%</span>
                {avgConfidence < 0.5 && <span className="text-amber-600">（信頼度が低いため、適用後に確認してください）</span>}
              </div>

              {/* タブ */}
              <div className="flex gap-1 border-b border-gray-200">
                {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`px-3 py-2 text-xs font-medium transition ${
                      activeTab === key ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {TAB_LABELS[key]}
                    {tabCounts[key] > 0 && <span className="ml-1 text-gray-400">({tabCounts[key]})</span>}
                  </button>
                ))}
              </div>

              {/* タブコンテンツ */}
              <div className="min-h-[100px]">
                {activeTab === 'companyPL' && renderCandidateTable(groupedCandidates.companyPL, PL_FIELD_LABELS)}
                {activeTab === 'companyBS' && renderCandidateTable(groupedCandidates.companyBS, BS_FIELD_LABELS)}
                {activeTab === 'segmentPL' && renderCandidateTable(groupedCandidates.segmentPL, PL_FIELD_LABELS)}
                {activeTab === 'segmentBS' && renderCandidateTable(groupedCandidates.segmentBS, BS_FIELD_LABELS)}
                {activeTab === 'pbr' && (
                  <div className="text-sm">
                    {groupedCandidates.pbr.length > 0 ? (
                      <div className="p-4 bg-gray-50 rounded">
                        PBR: {formatNumber((groupedCandidates.pbr[0] as any)?.fields?.pbr)}
                      </div>
                    ) : (
                      <div className="text-gray-500 py-4 text-center">PBR候補がありません</div>
                    )}
                  </div>
                )}
              </div>

              {/* 適用ボタン */}
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm text-blue-800">
                    <span className="font-medium">抽出した{candidates.length}件のデータを財務入力に反映します</span>
                    <p className="text-xs text-blue-600 mt-1">※ 既存のデータがある場合はマージされます</p>
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
                  <div className="mt-3 text-sm text-green-700 bg-green-100 px-3 py-2 rounded">✓ {applyMessage}</div>
                )}
              </div>
            </div>
          )}

          {/* 候補0件のときのガイド */}
          {candidates.length === 0 && !isUploading && (
            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded border border-gray-200">
              <div className="font-medium mb-1">適用ボタンが出ない場合</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>解析結果の抽出候補が0件だと、適用ボタンは表示されません（このパネルの仕様です）。</li>
                <li>上の「解析結果（デバッグ要約）」で candidatesCount が 0 になっていないか確認してください。</li>
                <li>PDF/Excelの表で「年度列」「項目名」「数値」「単位（千円/百万円）」が崩れていると候補が出ません。</li>
                <li>HTTPエラーの場合は、API側（/api/stage1/import）のログが必要です。</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
