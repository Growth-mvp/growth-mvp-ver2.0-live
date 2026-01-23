/**
 * /utils/stage1/benchmarkIssues.ts
 * 外部ベンチマークから論点候補を生成する純関数
 */

import type { IssueBlock, Stage1Benchmarks, BenchmarkTarget } from '@/types/strategy';

/**
 * 自社の財務指標
 */
export type SelfMetrics = {
  growthPct?: number;        // 売上成長率 (%)
  opMarginPct?: number;      // 営業利益率 (%)
  roicPct?: number;          // ROIC (%)
  capitalTurnover?: number;  // 資本回転率
  pbr?: number;              // PBR（上場企業向け）
};

/**
 * 候補生成のモード
 */
export type CandidateMode = 'weakness' | 'strength' | 'both';

/**
 * 候補生成のオプション
 */
export interface BuildExternalIssueCandidatesOptions {
  maxItems?: number;
  isListed?: boolean; // PBR候補を出すかどうか
  mode?: CandidateMode; // デフォルト: 'weakness'
}

/**
 * 候補生成結果に含まれるデバッグ情報
 */
export interface ExternalIssueCandidateDebugInfo {
  usedBenchmarkId: 'industryMedian' | null;
  missingSelfMetrics: (keyof SelfMetrics)[];
  missingBenchMetrics: (keyof Exclude<BenchmarkTarget['metrics'], undefined>)[];
  evaluated: Array<{
    metricKey: keyof SelfMetrics;
    selfValue?: number;
    benchValue?: number;
    gap?: number;
    direction: 'weakness' | 'strength';
    threshold: number;
    passed: boolean; // threshold を満たしたか（候補化したか）
  }>;
}

/**
 * 候補生成結果
 */
export interface ExternalIssueCandidatesResult {
  candidates: IssueBlock[];
  debug: ExternalIssueCandidateDebugInfo;
}

/**
 * 候補内部用：差分と順序付けのための情報
 */
interface CandidateWithGap {
  title: string;
  description: string;
  linkedMetrics: string[];
  scope: 'company' | 'business';
  metricKey: string;
  gap: number; // 負のほうが大きいほど "課題"
  evidence: {
    benchmarkId: 'industryMedian';
    metricKey: string;
    selfValue?: number;
    benchValue?: number;
    gap: number;
    period?: string;
    quality?: string;
  };
}

/**
 * 課題（中央値未達）の閾値
 */
const WEAKNESS_THRESHOLDS: Record<keyof SelfMetrics, number> = {
  growthPct: -1.0,      // 自社が1pt以上低い
  opMarginPct: -2.0,    // 自社が2pt以上低い
  roicPct: -2.0,        // 自社が2pt以上低い
  capitalTurnover: -0.2, // 自社が0.2以上低い
  pbr: -0.3,            // 自社が0.3以上低い
};

/**
 * 強み（中央値超過）の閾値
 */
const STRENGTH_THRESHOLDS: Record<keyof SelfMetrics, number> = {
  growthPct: 1.0,       // 自社が1pt以上高い
  opMarginPct: 2.0,     // 自社が2pt以上高い
  roicPct: 2.0,         // 自社が2pt以上高い
  capitalTurnover: 0.2,  // 自社が0.2以上高い
  pbr: 0.3,             // 自社が0.3以上高い
};

/**
 * 論点候補を生成（industryMediaン ベース）
 */
export function buildExternalIssueCandidates(
  selfMetrics: SelfMetrics | undefined,
  benchmarks: Stage1Benchmarks | undefined,
  options?: BuildExternalIssueCandidatesOptions
): ExternalIssueCandidatesResult {
  const maxItems = options?.maxItems ?? 3;
  const isListed = options?.isListed ?? false;
  const mode = options?.mode ?? 'weakness';

  // デバッグ情報の初期化
  const debug: ExternalIssueCandidateDebugInfo = {
    usedBenchmarkId: null,
    missingSelfMetrics: [],
    missingBenchMetrics: [],
    evaluated: [],
  };

  // ベンチマークが無い、または industryMedian が無い場合は候補無し
  if (!benchmarks?.industryMedian) {
    return { candidates: [], debug };
  }

  const im = benchmarks.industryMedian;
  if (!im.metrics) {
    return { candidates: [], debug };
  }

  debug.usedBenchmarkId = 'industryMedian';

  // 自社値が無い場合も候補無し
  if (!selfMetrics) {
    debug.missingSelfMetrics = ['growthPct', 'opMarginPct', 'roicPct', 'capitalTurnover', 'pbr'];
    return { candidates: [], debug };
  }

  const candidates: CandidateWithGap[] = [];

  // ========== opMarginPct チェック ==========
  if (
    selfMetrics.opMarginPct !== undefined &&
    Number.isFinite(selfMetrics.opMarginPct) &&
    im.metrics.opMarginPct !== undefined &&
    Number.isFinite(im.metrics.opMarginPct)
  ) {
    const gap = selfMetrics.opMarginPct - im.metrics.opMarginPct;

    // 課題（中央値未達）
    if (mode === 'weakness' || mode === 'both') {
      const weaknessThreshold = WEAKNESS_THRESHOLDS.opMarginPct;
      const passed = gap <= weaknessThreshold;

      debug.evaluated.push({
        metricKey: 'opMarginPct',
        selfValue: selfMetrics.opMarginPct,
        benchValue: im.metrics.opMarginPct,
        gap,
        direction: 'weakness',
        threshold: weaknessThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '営業利益率が業界水準を下回っている',
          description:
            `自社の営業利益率は${selfMetrics.opMarginPct.toFixed(1)}%で、` +
            `業界中央値（${im.metrics.opMarginPct.toFixed(1)}%）を${Math.abs(gap).toFixed(1)}pt下回っています。` +
            `コスト構造・価格決定力・生産性のいずれに要因があるか特定し、改善の優先順位を決める必要があります。`,
          linkedMetrics: ['operatingMargin'],
          scope: 'company',
          metricKey: 'opMarginPct',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'opMarginPct',
            selfValue: selfMetrics.opMarginPct,
            benchValue: im.metrics.opMarginPct,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }

    // 強み（中央値超過）
    if (mode === 'strength' || mode === 'both') {
      const strengthThreshold = STRENGTH_THRESHOLDS.opMarginPct;
      const passed = gap >= strengthThreshold;

      debug.evaluated.push({
        metricKey: 'opMarginPct',
        selfValue: selfMetrics.opMarginPct,
        benchValue: im.metrics.opMarginPct,
        gap,
        direction: 'strength',
        threshold: strengthThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '営業利益率が業界水準を上回っている',
          description:
            `自社の営業利益率は${selfMetrics.opMarginPct.toFixed(1)}%で、` +
            `業界中央値（${im.metrics.opMarginPct.toFixed(1)}%）を${gap.toFixed(1)}pt上回っています。` +
            `この優位性（コスト効率性、価格決定力、生産性等）を維持し、戦略的に活用する必要があります。`,
          linkedMetrics: ['operatingMargin'],
          scope: 'company',
          metricKey: 'opMarginPct',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'opMarginPct',
            selfValue: selfMetrics.opMarginPct,
            benchValue: im.metrics.opMarginPct,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }
  }

  // ========== roicPct チェック ==========
  if (
    selfMetrics.roicPct !== undefined &&
    Number.isFinite(selfMetrics.roicPct) &&
    im.metrics.roicPct !== undefined &&
    Number.isFinite(im.metrics.roicPct)
  ) {
    const gap = selfMetrics.roicPct - im.metrics.roicPct;

    // 課題（中央値未達）
    if (mode === 'weakness' || mode === 'both') {
      const weaknessThreshold = WEAKNESS_THRESHOLDS.roicPct;
      const passed = gap <= weaknessThreshold;

      debug.evaluated.push({
        metricKey: 'roicPct',
        selfValue: selfMetrics.roicPct,
        benchValue: im.metrics.roicPct,
        gap,
        direction: 'weakness',
        threshold: weaknessThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '資本効率（ROIC）が業界水準を下回っている',
          description:
            `自社のROICは${selfMetrics.roicPct.toFixed(2)}%で、` +
            `業界中央値（${im.metrics.roicPct.toFixed(2)}%）を${Math.abs(gap).toFixed(2)}pt下回っています。` +
            `投下資本の効率性改善（運転資本削減 or 利益率向上）を検討する必要があります。`,
          linkedMetrics: ['roic'],
          scope: 'company',
          metricKey: 'roicPct',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'roicPct',
            selfValue: selfMetrics.roicPct,
            benchValue: im.metrics.roicPct,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }

    // 強み（中央値超過）
    if (mode === 'strength' || mode === 'both') {
      const strengthThreshold = STRENGTH_THRESHOLDS.roicPct;
      const passed = gap >= strengthThreshold;

      debug.evaluated.push({
        metricKey: 'roicPct',
        selfValue: selfMetrics.roicPct,
        benchValue: im.metrics.roicPct,
        gap,
        direction: 'strength',
        threshold: strengthThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '資本効率（ROIC）が業界水準を上回っている',
          description:
            `自社のROICは${selfMetrics.roicPct.toFixed(2)}%で、` +
            `業界中央値（${im.metrics.roicPct.toFixed(2)}%）を${gap.toFixed(2)}pt上回っています。` +
            `この優位性（利益率またはターンオーバーの効率性）を維持・強化し、戦略的に活用する必要があります。`,
          linkedMetrics: ['roic'],
          scope: 'company',
          metricKey: 'roicPct',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'roicPct',
            selfValue: selfMetrics.roicPct,
            benchValue: im.metrics.roicPct,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }
  }

  // ========== capitalTurnover チェック ==========
  if (
    selfMetrics.capitalTurnover !== undefined &&
    Number.isFinite(selfMetrics.capitalTurnover) &&
    im.metrics.capitalTurnover !== undefined &&
    Number.isFinite(im.metrics.capitalTurnover)
  ) {
    const gap = selfMetrics.capitalTurnover - im.metrics.capitalTurnover;

    // 課題（中央値未達）
    if (mode === 'weakness' || mode === 'both') {
      const weaknessThreshold = WEAKNESS_THRESHOLDS.capitalTurnover;
      const passed = gap <= weaknessThreshold;

      debug.evaluated.push({
        metricKey: 'capitalTurnover',
        selfValue: selfMetrics.capitalTurnover,
        benchValue: im.metrics.capitalTurnover,
        gap,
        direction: 'weakness',
        threshold: weaknessThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '資本回転率が低い（資本滞留の可能性）',
          description:
            `自社の資本回転率は${selfMetrics.capitalTurnover.toFixed(2)}x で、` +
            `業界中央値（${im.metrics.capitalTurnover.toFixed(2)}x）を${Math.abs(gap).toFixed(2)}x 下回っています。` +
            `運転資本や固定資産の効率性改善により、資本回転率を上げる余地があります。`,
          linkedMetrics: [],
          scope: 'company',
          metricKey: 'capitalTurnover',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'capitalTurnover',
            selfValue: selfMetrics.capitalTurnover,
            benchValue: im.metrics.capitalTurnover,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }

    // 強み（中央値超過）
    if (mode === 'strength' || mode === 'both') {
      const strengthThreshold = STRENGTH_THRESHOLDS.capitalTurnover;
      const passed = gap >= strengthThreshold;

      debug.evaluated.push({
        metricKey: 'capitalTurnover',
        selfValue: selfMetrics.capitalTurnover,
        benchValue: im.metrics.capitalTurnover,
        gap,
        direction: 'strength',
        threshold: strengthThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '資本回転率が高い（資本効率が良好）',
          description:
            `自社の資本回転率は${selfMetrics.capitalTurnover.toFixed(2)}x で、` +
            `業界中央値（${im.metrics.capitalTurnover.toFixed(2)}x）を${gap.toFixed(2)}x 上回っています。` +
            `運転資本や固定資産を効率的に活用できていることが競争優位性となっています。`,
          linkedMetrics: [],
          scope: 'company',
          metricKey: 'capitalTurnover',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'capitalTurnover',
            selfValue: selfMetrics.capitalTurnover,
            benchValue: im.metrics.capitalTurnover,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }
  }

  // ========== growthPct チェック ==========
  if (
    selfMetrics.growthPct !== undefined &&
    Number.isFinite(selfMetrics.growthPct) &&
    im.metrics.growthPct !== undefined &&
    Number.isFinite(im.metrics.growthPct)
  ) {
    const gap = selfMetrics.growthPct - im.metrics.growthPct;

    // 課題（中央値未達）
    if (mode === 'weakness' || mode === 'both') {
      const weaknessThreshold = WEAKNESS_THRESHOLDS.growthPct;
      const passed = gap <= weaknessThreshold;

      debug.evaluated.push({
        metricKey: 'growthPct',
        selfValue: selfMetrics.growthPct,
        benchValue: im.metrics.growthPct,
        gap,
        direction: 'weakness',
        threshold: weaknessThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '成長率が業界水準を下回っている',
          description:
            `自社の成長率は${selfMetrics.growthPct.toFixed(1)}%で、` +
            `業界中央値（${im.metrics.growthPct.toFixed(1)}%）を${Math.abs(gap).toFixed(1)}pt 下回っています。` +
            `市場シェアの喪失、顧客基盤の縮小、提供価値の低下などの要因を特定し、成長戦略を再検討する必要があります。`,
          linkedMetrics: ['revenueCAGR'],
          scope: 'company',
          metricKey: 'growthPct',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'growthPct',
            selfValue: selfMetrics.growthPct,
            benchValue: im.metrics.growthPct,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }

    // 強み（中央値超過）
    if (mode === 'strength' || mode === 'both') {
      const strengthThreshold = STRENGTH_THRESHOLDS.growthPct;
      const passed = gap >= strengthThreshold;

      debug.evaluated.push({
        metricKey: 'growthPct',
        selfValue: selfMetrics.growthPct,
        benchValue: im.metrics.growthPct,
        gap,
        direction: 'strength',
        threshold: strengthThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '成長率が業界水準を上回っている',
          description:
            `自社の成長率は${selfMetrics.growthPct.toFixed(1)}%で、` +
            `業界中央値（${im.metrics.growthPct.toFixed(1)}%）を${gap.toFixed(1)}pt 上回っています。` +
            `市場シェアの獲得、新規顧客開拓、提供価値の向上などにより、業界平均より高い成長を実現しています。この成長を持続させるための戦略を構築する必要があります。`,
          linkedMetrics: ['revenueCAGR'],
          scope: 'company',
          metricKey: 'growthPct',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'growthPct',
            selfValue: selfMetrics.growthPct,
            benchValue: im.metrics.growthPct,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }
  }

  // ========== pbr チェック（上場企業向け） ==========
  if (
    isListed &&
    selfMetrics.pbr !== undefined &&
    Number.isFinite(selfMetrics.pbr) &&
    im.metrics.pbr !== undefined &&
    Number.isFinite(im.metrics.pbr)
  ) {
    const gap = selfMetrics.pbr - im.metrics.pbr;

    // 課題（中央値未達）
    if (mode === 'weakness' || mode === 'both') {
      const weaknessThreshold = WEAKNESS_THRESHOLDS.pbr;
      const passed = gap <= weaknessThreshold;

      debug.evaluated.push({
        metricKey: 'pbr',
        selfValue: selfMetrics.pbr,
        benchValue: im.metrics.pbr,
        gap,
        direction: 'weakness',
        threshold: weaknessThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '市場評価（PBR）が業界水準を下回っている',
          description:
            `自社のPBRは${selfMetrics.pbr.toFixed(2)}倍で、` +
            `業界中央値（${im.metrics.pbr.toFixed(2)}倍）を${Math.abs(gap).toFixed(2)}倍 下回っています。` +
            `市場が見ている懸念（成長性、収益性、資本効率、ガバナンス等）を特定し、改善ストーリーを構築する必要があります。`,
          linkedMetrics: ['pbr'],
          scope: 'company',
          metricKey: 'pbr',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'pbr',
            selfValue: selfMetrics.pbr,
            benchValue: im.metrics.pbr,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }

    // 強み（中央値超過）
    if (mode === 'strength' || mode === 'both') {
      const strengthThreshold = STRENGTH_THRESHOLDS.pbr;
      const passed = gap >= strengthThreshold;

      debug.evaluated.push({
        metricKey: 'pbr',
        selfValue: selfMetrics.pbr,
        benchValue: im.metrics.pbr,
        gap,
        direction: 'strength',
        threshold: strengthThreshold,
        passed,
      });

      if (passed) {
        candidates.push({
          title: '市場評価（PBR）が業界水準を上回っている',
          description:
            `自社のPBRは${selfMetrics.pbr.toFixed(2)}倍で、` +
            `業界中央値（${im.metrics.pbr.toFixed(2)}倍）を${gap.toFixed(2)}倍 上回っています。` +
            `市場から高く評価されている（成長性、収益性、資本効率、ガバナンス等）ことを示しており、この評価を維持・強化する必要があります。`,
          linkedMetrics: ['pbr'],
          scope: 'company',
          metricKey: 'pbr',
          gap,
          evidence: {
            benchmarkId: 'industryMedian',
            metricKey: 'pbr',
            selfValue: selfMetrics.pbr,
            benchValue: im.metrics.pbr,
            gap,
            period: im.period,
            quality: im.quality,
          },
        });
      }
    }
  }

  // ========== 結果を集約 ==========
  // 差分が大きい順（負のほうが大きい = 課題が大きい）で sort
  candidates.sort((a, b) => a.gap - b.gap);

  // 結果フォーマット（既存の IssueBlock 型に合わせる）
  const resultCandidates = candidates.slice(0, maxItems).map((cand) => ({
    title: cand.title,
    description: cand.description,
    linkedMetrics: cand.linkedMetrics,
    scope: cand.scope,
  }));

  return { candidates: resultCandidates, debug };
}
