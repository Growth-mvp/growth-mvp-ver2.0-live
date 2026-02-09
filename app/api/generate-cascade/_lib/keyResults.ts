/**
 * _lib/keyResults.ts
 * Key Results / OKR generation and management
 * Includes: normalizeKeyResults, ensureKeyResults, deriveKrsByContext, ensureOkrs, ensureOkrsForAllDepts
 */

import { ProjectType } from './types';
import { classifyProjectType } from './projectType';
import { validateKRs } from './validation';
import { generateKeyResultsByLLM } from './model';

/**
 * ★ TASK A: KR正規化関数（汎用版）
 * 入力形式を広く受け取り、常に標準OKR形式に統一
 */
export function normalizeKeyResults(raw: any): {
  normalized: Array<{ label: string; current: null; target: null; unit: null; due: null }>;
  rawType: string;
  rawLen: number;
} {
  // Step 1: 入力形式を判定 & 配列を抽出
  let arr: any[] = [];
  let rawType = 'unknown';
  let rawLen = 0;

  if (!raw) {
    // null/undefined → 空
    rawType = 'null';
    rawLen = 0;
  } else if (Array.isArray(raw)) {
    // raw 自体が配列 → そのまま使用
    arr = raw;
    rawType = 'array<string|object>';
    rawLen = raw.length;
  } else if (typeof raw === 'object') {
    // オブジェクト → フィールドから配列を抽出
    const candidate =
      Array.isArray(raw?.keyResults) ? { arr: raw.keyResults, type: 'object.keyResults' } :
      Array.isArray(raw?.krs) ? { arr: raw.krs, type: 'object.krs' } :
      Array.isArray(raw?.key_results) ? { arr: raw.key_results, type: 'object.key_results' } :
      Array.isArray(raw?.kpis) ? { arr: raw.kpis, type: 'object.kpis' } :
      Array.isArray(raw?.metrics) ? { arr: raw.metrics, type: 'object.metrics' } :
      Array.isArray(raw?.measures) ? { arr: raw.measures, type: 'object.measures' } :
      Array.isArray(raw?.values) ? { arr: raw.values, type: 'object.values' } :
      Array.isArray(raw?.outcomes) ? { arr: raw.outcomes, type: 'object.outcomes' } :
      null;

    if (candidate) {
      arr = candidate.arr;
      rawType = candidate.type;
      rawLen = arr.length;
    } else {
      rawType = 'object<no-array-fields>';
      rawLen = 0;
    }
  }

  // Step 2: 配列の各要素を正規化
  const normalized = arr
    .map((x: any) => {
      // 文字列の場合、label にする
      if (typeof x === 'string') {
        return { label: x.trim(), current: null, target: null, unit: null, due: null };
      }
      // オブジェクトの場合、フィールド別名に対応して正規化
      const label = (x?.label ?? x?.title ?? x?.name ?? x?.metric ?? x?.kpi ?? x?.measure ?? x?.outcome ?? '').toString().trim();
      if (!label) return null; // label なしは skip

      return {
        label,
        current: x?.current ?? x?.baseline ?? x?.from ?? null,
        target: x?.target ?? x?.goal ?? x?.to ?? x?.destination ?? null,
        unit: x?.unit ?? x?.uom ?? x?.metric_unit ?? null,
        due: x?.due ?? x?.deadline ?? x?.dueDate ?? null,
      };
    })
    .filter((x: any): x is { label: string; current: null; target: null; unit: null; due: null } => x !== null);

  return { normalized, rawType, rawLen };
}

/**
 * ★ TASK 4: ensureKeyResults を修正（AI→リトライ→テンプレの順）
 */
export async function ensureKeyResults(
  okr: any,
  projectTitle: string,
  deptName?: string,
  laneType?: 'existing' | 'new'
): Promise<any> {
  // Step 1: raw candidates を広く拾う
  const rawKrs =
    okr?.keyResults ??
    okr?.krs ??
    okr?.key_results ??
    okr?.metrics ??
    null;

  // Step 2: 正規化（rawType/rawLen も取得）
  const { normalized, rawType, rawLen } = normalizeKeyResults(rawKrs);

  // Step 3: ai_called の判定（rawが「存在」したか）
  const ai_called = rawKrs != null && rawLen > 0;

  // Step 4: AI採用（LLMから返ってきたデータ）
  if (normalized.length > 0) {
    const labels = normalized.map((kr: any) => (kr.label ?? '').substring(0, 30)).join(' | ');
    console.log(
      `[cascade][kpi][llm-label-check] dept="${deptName ?? 'unknown'}" project="${projectTitle}" rawType="${rawType}" labels="${labels}"`
    );

    return {
      ...okr,
      keyResults: normalized,
      _aiCalled: ai_called,
      _krSource: 'AI',
      _krReason: 'llm_returned',
      _krSourceDetail: 'ai:gpt',
      _rawType: rawType,
      _rawLen: rawLen,
      _aiAttempts: 0,
    };
  }

  // Step 5: projectType を分類
  const projectType = classifyProjectType(projectTitle, deptName, laneType);
  console.log(
    `[cascade][kpi][classify] dept="${deptName}" project="${projectTitle}" projectType="${projectType}"`
  );

  // Step 5.5: rawが空の場合、AI生成を試す（最大2回）
  let aiGenResult = null;
  let lastErrorCode: string | undefined = undefined;
  let aiAttempts = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    aiAttempts = attempt;
    const result = await generateKeyResultsByLLM({
      deptName: deptName ?? '未設定',
      projectTitle,
      mainLever: (okr as any)?.mainLever,
      kind: (okr as any)?.kind,
      objective: (okr as any)?.objective,
      laneType,
      projectType,
      attempt,
    });

    if (result.keyResults.length === 3) {
      const aiKrs = result.keyResults.map((kr: any) => ({
        label: kr.label,
        current: null,
        target: null,
        unit: kr.unit ?? null,
        due: null,
      }));

      const labels = aiKrs.map((kr: any) => (kr.label ?? '').substring(0, 30)).join(' | ');
      console.log(
        `[cascade][kpi][ai-label-check] dept="${deptName ?? 'unknown'}" project="${projectTitle}" labels="${labels}"`
      );

      const validation = validateKRs(projectType, aiKrs, projectTitle);
      const validationStatus = validation.ok ? 'pass' : 'fail';
      console.log(
        `[cascade][kpi][validate] dept="${deptName}" project="${projectTitle}" attempt=${attempt} status="${validationStatus}" reasons="${validation.reasons.join('|')}"`
      );

      const kpiNames = aiKrs.map((kr: any) => {
        let name = (kr.label ?? '').replace(projectTitle, '').replace(/^：/, '').trim();
        return name;
      });
      console.log(
        `[cascade][kpi][ai-kpi-name] dept="${deptName}" project="${projectTitle}" names="${kpiNames.join(' | ')}"`
      );

      if (validation.ok) {
        aiGenResult = result;
        break;
      } else if (attempt < 2) {
        console.log(
          `[cascade][kpi][validate-retry] dept="${deptName}" project="${projectTitle}" attempt=${attempt} will_retry=true reasons="${validation.reasons.join('|')}"`
        );
        continue;
      } else {
        lastErrorCode = 'ai_error_validation';
        console.log(
          `[cascade][kpi][validate-fail] dept="${deptName}" project="${projectTitle}" attempt=${attempt} reasons="${validation.reasons.join('|')}"`
        );
        break;
      }
    }

    lastErrorCode = result.errorCode;
    console.log(
      `[cascade][kpi][retry] dept="${deptName}" project="${projectTitle}" attempt=${attempt} failed errorCode=${result.errorCode}`
    );
  }

  // Step 6: AI生成成功 → 結果を返す
  if (aiGenResult && aiGenResult.keyResults.length === 3) {
    const aiKrs = aiGenResult.keyResults.map((kr: any) => ({
      label: kr.label,
      current: null,
      target: null,
      unit: kr.unit ?? null,
      due: null,
    }));

    return {
      ...okr,
      keyResults: aiKrs,
      _aiCalled: true,
      _krSource: 'AI',
      _krReason: 'ai_generated_after_retry',
      _krSourceDetail: 'ai:gpt',
      _rawType: rawType,
      _rawLen: rawLen,
      _aiAttempts: aiAttempts,
    };
  }

  // Step 7: AI生成失敗 → テンプレをやむを得ず使用
  const reason_detail = lastErrorCode
    ? `ai_failed_after_retry(${lastErrorCode})`
    : 'ai_empty';

  console.log(
    `[cascade][kpi][template-fallback] dept="${deptName}" project="${projectTitle}" reason="${reason_detail}"`
  );

  const result = deriveKrsByContext(projectTitle, deptName, laneType);
  const fallbackKrs = result.krs;
  const sourceDetail = result.sourceDetail;

  return {
    ...okr,
    keyResults: fallbackKrs.map((label: string) => ({
      label,
      current: null,
      target: null,
      unit: null,
      due: null,
    })),
    _aiCalled: false,
    _krSource: 'TEMPLATE',
    _krReason: reason_detail,
    _krSourceDetail: sourceDetail,
    _rawType: rawType,
    _rawLen: rawLen,
    _aiAttempts: aiAttempts,
  };
}

/**
 * ★ TASK 4-2: プロジェクトコンテキストに応じた KR を生成（複数バリエーション対応）
 */
export function deriveKrsByContext(
  projectTitle: string,
  deptMission?: string,
  laneType?: 'existing' | 'new',
  projectTags?: string[],
  variant: 0 | 1 | 2 = 0
): { krs: string[]; sourceDetail: string } {
  const title = String(projectTitle).toLowerCase();
  const tags = (projectTags ?? []).map((t) => String(t).toLowerCase());
  let sourceDetail = 'template:default';

  const hasKeyword = (keywords: string[]) =>
    keywords.some((kw) => title.includes(kw) || tags.some((t) => t.includes(kw)));

  // ★ 分岐ルール 1: 品質 / 不良 / クレーム / 保証 / 検査 / 監査
  if (hasKeyword(['品質', '不良', 'クレーム', '保証', '検査', '監査', '信頼性'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：不良率低減（ppm）`,
          `${projectTitle}：クレーム件数削減（件/月）`,
          `${projectTitle}：審査/監査合格率（%）`,
        ],
        sourceDetail: 'template:quality_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：検査工数削減（h/ロット）`,
          `${projectTitle}：再加工率低減（%）`,
          `${projectTitle}：初回良品率（%）`,
        ],
        sourceDetail: 'template:quality_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：工程内流出率低減（ppm）`,
          `${projectTitle}：保証費削減（%）`,
          `${projectTitle}：返品率低減（%）`,
        ],
        sourceDetail: 'template:quality_v2',
      };
    }
  }

  // ★ 分岐ルール 2: 受注 / 見積 / 営業 / 案件 / 納期 / リードタイム
  if (hasKeyword(['受注', '見積', '営業', '案件', '納期', 'リード', 'lead time'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：見積リードタイム短縮（営業日）`,
          `${projectTitle}：受注率改善（%）`,
          `${projectTitle}：納期遵守率（%）`,
        ],
        sourceDetail: 'template:sales_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：仕掛け期間削減（日）`,
          `${projectTitle}：提案件数増加（件/月）`,
          `${projectTitle}：受注規模拡大（平均金額）`,
        ],
        sourceDetail: 'template:sales_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：見積回答時間短縮（時間）`,
          `${projectTitle}：商談成功率（%）`,
          `${projectTitle}：販売テコ比改善（%）`,
        ],
        sourceDetail: 'template:sales_v2',
      };
    }
  }

  // ★ 分岐ルール 3: コスト / 原価 / 工数 / 効率 / 自動化 / 省力
  if (hasKeyword(['コスト', '原価', '工数', '効率', '自動化', '省力', 'automation'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：単位原価削減（%）`,
          `${projectTitle}：作業工数削減（h/月）`,
          `${projectTitle}：段取り時間短縮（分）`,
        ],
        sourceDetail: 'template:cost_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：歩留改善（%）`,
          `${projectTitle}：材料ロス削減（%）`,
          `${projectTitle}：稼働率向上（%pt）`,
        ],
        sourceDetail: 'template:cost_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：加工時間短縮（分/個）`,
          `${projectTitle}：人件費削減（%）`,
          `${projectTitle}：設備稼働率（%）`,
        ],
        sourceDetail: 'template:cost_v2',
      };
    }
  }

  // ★ 分岐ルール 4: 新規 / 開発 / 軽量 / 耐久 / 設計
  if (hasKeyword(['新規', '開発', '軽量', '耐久', '設計', 'design', 'development'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：試作回数削減（回）`,
          `${projectTitle}：試験合格率（%）`,
          `${projectTitle}：開発リードタイム短縮（月）`,
        ],
        sourceDetail: 'template:newbiz_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：量産時期達成率（%）`,
          `${projectTitle}：目標仕様達成率（%）`,
          `${projectTitle}：原価低減達成率（%）`,
        ],
        sourceDetail: 'template:newbiz_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：設計段階での課題検出数（件）`,
          `${projectTitle}：手戻り削減（%）`,
          `${projectTitle}：部品共通化率（%）`,
        ],
        sourceDetail: 'template:newbiz_v2',
      };
    }
  }

  // ★ 分岐ルール 5: 市場 / 開拓 / 仮説 / 検証 / PoC
  if (hasKeyword(['市場', '開拓', '仮説', '検証', 'poc', 'パイロット', 'prototype', 'validation'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：商談件数増加（件/月）`,
          `${projectTitle}：PoC件数（件）`,
          `${projectTitle}：検証→受注転換率（%）`,
        ],
        sourceDetail: 'template:market_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：顧客ヒアリング数（社）`,
          `${projectTitle}：見込み案件数（件）`,
          `${projectTitle}：パイロット参加企業数（社）`,
        ],
        sourceDetail: 'template:market_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：市場反応度調査（回答率%）`,
          `${projectTitle}：早期顧客数（社）`,
          `${projectTitle}：実装案件化率（%）`,
        ],
        sourceDetail: 'template:market_v2',
      };
    }
  }

  // ★ 分岐ルール 6: スマート / IoT / データ / DX / AI / 分析
  if (hasKeyword(['smart', 'iot', 'データ', 'dx', 'ai', '分析', 'analytics', 'digital'])) {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：データ取得率（%）`,
          `${projectTitle}：予兆検知精度（感度%）`,
          `${projectTitle}：稼働率改善（%pt）`,
        ],
        sourceDetail: 'template:dx_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：データ活用範囲（システム数）`,
          `${projectTitle}：自動化カバー率（%）`,
          `${projectTitle}：異常検知検出精度（%）`,
        ],
        sourceDetail: 'template:dx_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：停止時間削減（h/月）`,
          `${projectTitle}：予測精度（%）`,
          `${projectTitle}：データ品質スコア（1-10）`,
        ],
        sourceDetail: 'template:dx_v2',
      };
    }
  }

  // ★ デフォルト: 汎用 KR（レーン種別で少し調整）
  if (laneType === 'new') {
    if (variant === 0) {
      return {
        krs: [
          `${projectTitle}：実現可能性検証度（%）`,
          `${projectTitle}：学習・獲得知見数（件）`,
          `${projectTitle}：スケーラビリティスコア（1-10）`,
        ],
        sourceDetail: 'template:newlane_v0',
      };
    } else if (variant === 1) {
      return {
        krs: [
          `${projectTitle}：実装体制構築度（%）`,
          `${projectTitle}：リスク認識件数（件）`,
          `${projectTitle}：プロトタイプ完成度（%）`,
        ],
        sourceDetail: 'template:newlane_v1',
      };
    } else {
      return {
        krs: [
          `${projectTitle}：市場受容度調査（回答率%）`,
          `${projectTitle}：提携先候補数（社）`,
          `${projectTitle}：導入可能性評価スコア（1-10）`,
        ],
        sourceDetail: 'template:newlane_v2',
      };
    }
  }

  // laneType === 'existing' または デフォルト
  if (variant === 0) {
    return {
      krs: [
        `${projectTitle}：生産性向上（%）`,
        `${projectTitle}：顧客満足度（NPS）`,
        `${projectTitle}：プロセス改善スコア（1-10）`,
      ],
      sourceDetail: 'template:default_v0',
    };
  } else if (variant === 1) {
    return {
      krs: [
        `${projectTitle}：売上向上（%）`,
        `${projectTitle}：リード獲得数（件/月）`,
        `${projectTitle}：顧客保持率（%）`,
      ],
      sourceDetail: 'template:default_v1',
    };
  } else {
    return {
      krs: [
        `${projectTitle}：利益率向上（%pt）`,
        `${projectTitle}：顧客単価向上（%）`,
        `${projectTitle}：プロセス効率化度（%）`,
      ],
      sourceDetail: 'template:default_v2',
    };
  }
}

/**
 * ★ TASK 2-2: 各プロジェクトに必ず okrs があることを保証（LLMの生成漏れ対策）
 */
export async function ensureOkrs(
  project: any,
  laneType?: 'existing' | 'new',
  deptName?: string
): Promise<any> {
  if (!project) return project;

  const projectTitle = String(project?.title ?? project?.name ?? 'プロジェクト').trim();
  const deptLabel = deptName ? `dept="${deptName}"` : '';
  let fallbackUsed = false;

  // 既に okrs があればそれを使用（ただし keyResults も正規化）
  if (Array.isArray(project?.okrs) && project.okrs.length > 0) {
    project.okrs = await Promise.all(
      project.okrs.map(async (o: any) => {
        const normalized = await ensureKeyResults(o, projectTitle, deptName, laneType);
        return {
          ...normalized,
          objective: String(normalized?.objective ?? normalized?.goal ?? normalized?.outcome ?? projectTitle).trim() || projectTitle,
          _krSource: (normalized as any)?._krSource,
          _krReason: (normalized as any)?._krReason,
          _krSourceDetail: (normalized as any)?._krSourceDetail,
          _rawType: (normalized as any)?._rawType,
          _rawLen: (normalized as any)?._rawLen,
          _aiCalled: (normalized as any)?._aiCalled,
        };
      })
    );

    const okrs0 = project.okrs[0];
    const rawKrLen = (okrs0 as any)?._rawLen ?? 'unknown';
    const rawKrType = (okrs0 as any)?._rawType ?? 'object.okrs';
    console.log(
      `[cascade][kpi][raw] project="${projectTitle}" ${deptLabel} ` +
      `rawType="${rawKrType}" rawLen=${rawKrLen} ai_called=true`
    );

    project._krSource = (okrs0 as any)?._krSource ?? 'AI';
    project._krReason = (okrs0 as any)?._krReason ?? 'llm_returned';
    project._krSourceDetail = (okrs0 as any)?._krSourceDetail ?? 'ai:gpt';

    const finalKrLen = project.okrs[0]?.keyResults?.length ?? 0;
    console.log(
      `[cascade][kpi][final] project="${projectTitle}" ${deptLabel} ` +
      `krSource="${project._krSource}" reason="${project._krReason}" ` +
      `sourceDetail="${project._krSourceDetail}" finalLen=${finalKrLen}`
    );

    return project;
  }

  // objective / keyResults が別の名前で来ていないか確認
  const objective =
    project?.objective ??
    project?.goal ??
    project?.outcome ??
    projectTitle ??
    '';

  const keyResults =
    (Array.isArray(project?.keyResults) && project.keyResults.length > 0 ? project.keyResults : null) ||
    (Array.isArray(project?.kpis) && project.kpis.length > 0 ? project.kpis : null) ||
    (Array.isArray(project?.metrics) && project.metrics.length > 0 ? project.metrics : null) ||
    (Array.isArray(project?.measures) && project.measures.length > 0 ? project.measures : null) ||
    [];

  const okrObj = {
    objective: String(objective ?? '').trim() || projectTitle,
    keyResults: keyResults,
  };

  fallbackUsed = !Array.isArray(keyResults) || keyResults.length === 0;

  const rawKrLen_pre = Array.isArray(keyResults) ? keyResults.length : 0;
  const rawKrType_pre = Array.isArray(keyResults) ? 'array' : typeof keyResults;
  console.log(
    `[cascade][kpi][raw] project="${projectTitle}" ${deptLabel} ` +
    `rawType="${rawKrType_pre}" rawLen=${rawKrLen_pre} ai_called=${rawKrLen_pre > 0}`
  );

  const okrWithKR = await ensureKeyResults(okrObj, projectTitle, deptName, laneType);

  project.okrs = [{
    ...okrWithKR,
    _krSource: (okrWithKR as any)?._krSource,
    _krReason: (okrWithKR as any)?._krReason,
    _krSourceDetail: (okrWithKR as any)?._krSourceDetail,
    _rawType: (okrWithKR as any)?._rawType,
    _rawLen: (okrWithKR as any)?._rawLen,
    _aiCalled: (okrWithKR as any)?._aiCalled,
    _aiAttempts: (okrWithKR as any)?._aiAttempts,
  }];

  project._krSource = (okrWithKR as any)?._krSource ?? 'unknown';
  project._krReason = (okrWithKR as any)?._krReason ?? 'unknown';
  project._krSourceDetail = (okrWithKR as any)?._krSourceDetail ?? 'unknown';

  const finalKrLen = okrWithKR?.keyResults?.length ?? 0;
  console.log(
    `[cascade][kpi][final] project="${projectTitle}" ${deptLabel} ` +
    `krSource="${project._krSource}" reason="${project._krReason}" ` +
    `sourceDetail="${project._krSourceDetail}" finalLen=${finalKrLen}`
  );

  const okr0 = project.okrs?.[0];
  console.log('[cascade][kpi][meta]', {
    dept: deptName ?? 'unknown',
    project: projectTitle,
    krSource: (project as any)._krSource ?? (okr0 as any)?._krSource,
    reason: (project as any)._krReason ?? (okr0 as any)?._krReason,
    sourceDetail: (project as any)._krSourceDetail ?? (okr0 as any)?._krSourceDetail,
    rawType: (okr0 as any)?._rawType,
    rawLen: (okr0 as any)?._rawLen,
    ai_called: (okr0 as any)?._aiCalled,
  });

  return project;
}

/**
 * ★ TASK 2-2: 全部門の全 lane の全プロジェクトに okrs を保証する
 */
export async function ensureOkrsForAllDepts(depts: any[]): Promise<any[]> {
  if (!Array.isArray(depts)) return depts;

  return Promise.all(
    depts.map(async (dept: any) => {
      if (!dept) return dept;

      const usedKrSet = new Set<string>();

      const deduplicateAndReplaceKrs = (krs: any[], projectTitle: string, laneType?: 'existing' | 'new'): any[] => {
        const uniqueLabels = new Set<string>();
        const finalKrs: any[] = [];

        for (const kr of krs) {
          const krLabel = kr.label || String(kr);
          if (usedKrSet.has(krLabel)) {
            let replaced = false;
            for (let variant of [1, 2] as const) {
              const result = deriveKrsByContext(projectTitle, undefined, laneType, undefined, variant);
              const altKrs = result.krs;
              for (const altKr of altKrs) {
                if (!usedKrSet.has(altKr) && !uniqueLabels.has(altKr)) {
                  finalKrs.push({ ...kr, label: altKr });
                  uniqueLabels.add(altKr);
                  usedKrSet.add(altKr);
                  replaced = true;
                  break;
                }
              }
              if (replaced) break;
            }
            if (!replaced) {
              const shortTitle = projectTitle.substring(0, 8);
              const suffixKr = `${krLabel} - ${shortTitle}`;
              finalKrs.push({ ...kr, label: suffixKr });
              usedKrSet.add(suffixKr);
              uniqueLabels.add(suffixKr);
            }
          } else {
            finalKrs.push(kr);
            usedKrSet.add(krLabel);
            uniqueLabels.add(krLabel);
          }
        }
        return finalKrs;
      };

      const deptName = dept?.name ?? '';

      if (Array.isArray(dept?.lanes?.existing?.projects)) {
        dept.lanes.existing.projects = await Promise.all(
          dept.lanes.existing.projects.map(async (p: any) => {
            const processed = await ensureOkrs(p, 'existing', deptName);
            if (Array.isArray(processed?.okrs?.[0]?.keyResults)) {
              processed.okrs[0].keyResults = deduplicateAndReplaceKrs(
                processed.okrs[0].keyResults,
                p?.title,
                'existing'
              );
            }
            return processed;
          })
        );
      }

      if (Array.isArray(dept?.lanes?.new?.projects)) {
        dept.lanes.new.projects = await Promise.all(
          dept.lanes.new.projects.map(async (p: any) => {
            const processed = await ensureOkrs(p, 'new', deptName);
            if (Array.isArray(processed?.okrs?.[0]?.keyResults)) {
              processed.okrs[0].keyResults = deduplicateAndReplaceKrs(
                processed.okrs[0].keyResults,
                p?.title,
                'new'
              );
            }
            return processed;
          })
        );
      }

      if (Array.isArray(dept?.projects)) {
        dept.projects = await Promise.all(
          dept.projects.map(async (p: any) => {
            const processed = await ensureOkrs(p, undefined, deptName);
            if (Array.isArray(processed?.okrs?.[0]?.keyResults)) {
              processed.okrs[0].keyResults = deduplicateAndReplaceKrs(
                processed.okrs[0].keyResults,
                p?.title
              );
            }
            return processed;
          })
        );
      }

      return dept;
    })
  );
}
