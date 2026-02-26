/**
 * STAGE6 AUTO推定紐づけロジック
 *
 * - AUTO推定用：手動入力がなくても UI が空にならない
 * - マージ戦略：manual（or locked）は絶対に上書きしない
 * - 単位処理：normalizeValueToUnit を活用
 */

import type {
  ProjectTargetImpact,
  ProjectIssueLink,
  CompanyTarget,
  BridgeKR,
} from '@/types/strategy';
import type { IssueBlock } from '@/types/strategy';
import { normalizeValueToUnit } from './compute';

/**
 * ★単位統一ヘルパー：任意の単位を JPY（円）に変換
 * - 百万円 → * 1e6（100万 = 1,000,000 yen）
 * - 万円 → * 1e4
 * - 円 / yen → そのまま
 */
function toYen(value: number, unit: string): number {
  if (!Number.isFinite(value)) return 0;

  const u = (unit ?? '').toLowerCase();
  if (u.includes('百万') || u.includes('million')) return value * 1_000_000;
  if (u.includes('万')) return value * 10_000;
  // 円 / yen / 空文字 → そのまま
  return value;
}

/**
 * ★単位統一ヘルパー：JPY（円）から任意の単位に変換
 */
function fromYen(valueYen: number, unit: string): number {
  if (!Number.isFinite(valueYen)) return 0;

  const u = (unit ?? '').toLowerCase();
  if (u.includes('百万') || u.includes('million')) return valueYen / 1_000_000;
  if (u.includes('万')) return valueYen / 10_000;
  // 円 / yen / 空文字 → そのまま
  return valueYen;
}

/**
 * ターゲット分類（ラベルのキーワードから推定）
 */
function classifyTarget(label: string): 'revenue' | 'opIncome' | 'roic' | 'pbr' | 'other' {
  const lower = (label ?? '').toLowerCase();
  if (lower.includes('売上') && !lower.includes('成長')) return 'revenue';
  if (lower.includes('営業利益') && !lower.includes('率')) return 'opIncome';
  if (lower.includes('roic')) return 'roic';
  if (lower.includes('pbr')) return 'pbr';
  return 'other';
}

/**
 * BridgeKR の kind から target分類への関連スコア（0..1）を算出
 */
function getKRRelevanceScore(
  krKind: string,
  targetCategory: 'revenue' | 'opIncome' | 'roic' | 'pbr' | 'other'
): number {
  if (targetCategory === 'revenue') {
    // 売上に直結するもの
    if (krKind === 'REVENUE') return 1.0;
    if (krKind === 'ACQ') return 0.8; // 新規獲得
    if (krKind === 'ARPU') return 0.8; // 単価
    if (krKind === 'CHURN') return 0.6; // 解約抑制は間接的
    if (krKind === 'SYNERGY') return 0.5;
    return 0.1;
  }

  if (targetCategory === 'opIncome') {
    // 営業利益に効く
    if (krKind === 'REVENUE') return 0.7; // 売上増加は営利増加に寄与
    if (krKind === 'COST_FIXED') return 0.9; // 固定費削減
    if (krKind === 'COST_VARIABLE') return 0.85; // 変動費削減
    if (krKind === 'PERSONNEL') return 0.8; // 人件費
    if (krKind === 'ACQ') return 0.5;
    if (krKind === 'INVEST') return -0.3; // 投資は短期利益を圧迫（逆相関）
    return 0.1;
  }

  if (targetCategory === 'roic') {
    // ROIC = NOPAT / 投下資本
    if (krKind === 'REVENUE') return 0.6;
    if (krKind === 'COST_FIXED') return 0.7;
    if (krKind === 'COST_VARIABLE') return 0.6;
    if (krKind === 'INVEST') return -0.5; // 投下資本増加は ROIC を下げる
    return 0.1;
  }

  if (targetCategory === 'pbr') {
    // PBR = 時価総額 / 純資産 （指標的関連度が低いため全て低め）
    if (krKind === 'REVENUE') return 0.4;
    if (krKind === 'INVEST') return -0.3;
    return 0.1;
  }

  // other
  return 0.05;
}

/**
 * inferAutoProjectTargetImpacts: AUTO推定の生成
 *
 * 方針：
 * 1. target ごとに category を分類
 * 2. projectKey ごとに関連スコアを集計（KR単位で加重平均）
 * 3. target の gap = scenarioValue - base を計算
 * 4. 関連スコアで按分して projectDelta を算出
 * 5. executionWeights で補正（0.7..1.2にclip）
 */
export function inferAutoProjectTargetImpacts(args: {
  companyTargets: CompanyTarget[];
  projectKeys: string[];
  projectKrsMap: Map<string, BridgeKR[]>;
  executionWeightsMap: Map<string, { weight: number }>;
  scenarioKey: 'low' | 'base' | 'high';
}): ProjectTargetImpact[] {
  const {
    companyTargets,
    projectKeys,
    projectKrsMap,
    executionWeightsMap,
    scenarioKey,
  } = args;

  const DEBUG = process.env.NODE_ENV === 'development' && !!process.env.NEXT_PUBLIC_DEBUG_STAGE6;

  // ★Early return logs
  if (!companyTargets || companyTargets.length === 0) {
    if (DEBUG) console.log('[autoLinking] skip: companyTargets empty');
    return [];
  }
  if (!projectKeys || projectKeys.length === 0) {
    if (DEBUG) console.log('[autoLinking] skip: projectKeys empty');
    return [];
  }
  if (!projectKrsMap || projectKrsMap.size === 0) {
    if (DEBUG) console.log('[autoLinking] skip: projectKrsMap empty');
    return [];
  }

  const results: ProjectTargetImpact[] = [];

  companyTargets.forEach((target) => {
    if (!target.base) {
      // base がなければスキップ
      return;
    }

    // target の scenario 値を取得
    const scenarioValue =
      scenarioKey === 'low' ? target.low : scenarioKey === 'high' ? target.high : target.base;

    if (scenarioValue === undefined) {
      return; // scenario値がなければスキップ
    }

    // ★修正：gap計算を yen に統一
    const scenarioYen = toYen(scenarioValue, target.unit);
    const baseYen = toYen(target.base, target.unit);
    let gapYen = scenarioYen - baseYen;

    // ★修正：NaN/Infinity のときは gapYen=0 で続行（スキップしない）
    let gapFinite = Number.isFinite(gapYen);
    if (!gapFinite) {
      gapYen = 0;
      if (DEBUG) {
        console.log(`[autoLinking] gap NaN->0: target=${target.id}, scenarioYen=${scenarioYen}, baseYen=${baseYen}`);
      }
    }

    if (Math.abs(gapYen) < 0.01) {
      // gap がほぼ 0 なら寄与がない
      return;
    }

    const targetCategory = classifyTarget(target.label);

    // プロジェクトごとの関連スコアを計算
    const projectRelevances = new Map<string, number>();
    let maxRelevance = 0;

    projectKeys.forEach((projKey) => {
      const krs = projectKrsMap.get(projKey) ?? [];
      if (krs.length === 0) {
        projectRelevances.set(projKey, 0);
        return;
      }

      // KR ごとのスコアを加重平均
      let totalScore = 0;
      let totalWeight = 0;

      krs.forEach((kr) => {
        const score = getKRRelevanceScore(kr.kind, targetCategory);
        const weight = kr.weight ?? 1; // weight がなければ 1
        totalScore += score * weight;
        totalWeight += weight;
      });

      const avgRelevance = totalWeight > 0 ? totalScore / totalWeight : 0;
      projectRelevances.set(projKey, avgRelevance);
      maxRelevance = Math.max(maxRelevance, avgRelevance);
    });

    // ★フォールバック：関連スコアが全て 0 でも均等按分（必ず出力）
    let fallbackUsed = false;
    if (maxRelevance < 0.01) {
      fallbackUsed = true;
      // すべてのプロジェクトに均等配賦
      if (DEBUG) {
        console.log(`[autoLinking][target] maxRelevance=0 fallback for ${target.id}, 均等按分で出力`);
      }

      projectKeys.forEach((projKey) => {
        const share = 1 / projectKeys.length;
        let projectDeltaYen = gapYen * share;

        // ★修正：NaN でも続行
        if (!Number.isFinite(projectDeltaYen)) {
          projectDeltaYen = 0;
        }

        const execWeight = executionWeightsMap.get(projKey)?.weight ?? 1.0;
        const clippedExecWeight = Math.max(0.7, Math.min(1.2, execWeight));
        projectDeltaYen *= clippedExecWeight;

        const confidence = clippedExecWeight / 1.2; // 0.7..1

        // ★修正：delta は target.unit に戻す
        const delta = fromYen(projectDeltaYen, target.unit);

        results.push({
          projectId: projKey,
          targetId: target.id,
          delta,
          notes: `[AUTO-FALLBACK] 均等按分 (relevance=0), execWeight=${clippedExecWeight.toFixed(2)}`,
          source: 'auto',
          locked: false,
          confidence: Math.max(0, Math.min(1, confidence)),
        });
      });

      // ログ出力（target単位）
      if (DEBUG) {
        console.log(`[autoLinking][target] ${target.id} ${target.label}: gapYen=${gapYen}, fallback=${fallbackUsed}`);
      }

      return; // 次の target へ
    }

    // 関連スコアで gapYen を按分
    projectKeys.forEach((projKey) => {
      const relevance = projectRelevances.get(projKey) ?? 0;
      if (relevance < 0.01) {
        return; // relevance が低すぎればスキップ
      }

      // 按分比 = relevance / Σ(relevance)
      const totalRelevance = Array.from(projectRelevances.values()).reduce((s, r) => s + r, 0);
      const share = totalRelevance > 0 ? relevance / totalRelevance : 0;

      // プロジェクト単位の delta （yen）
      let projectDeltaYen = gapYen * share;

      // ★修正：NaN/Infinity のときは 0 で続行（スキップしない）
      let deltaFinite = Number.isFinite(projectDeltaYen);
      if (!deltaFinite) {
        projectDeltaYen = 0;
      }

      // executionWeight で補正（0.7..1.2 に clip）
      const execWeight = executionWeightsMap.get(projKey)?.weight ?? 1.0;
      const clippedExecWeight = Math.max(0.7, Math.min(1.2, execWeight));
      projectDeltaYen *= clippedExecWeight;

      // 信頼度：relevance と execWeight に基づいて算出
      let confidence = (relevance * 0.6 + clippedExecWeight * 0.4) / 1.8; // 0..1 に正規化

      // NaN だった場合は confidence を低め（0.1）に
      if (!deltaFinite) {
        confidence = 0.1;
      }

      // ★修正：delta は target.unit に戻す
      const delta = fromYen(projectDeltaYen, target.unit);

      const notesSuffix = deltaFinite ? '' : ' [AUTO-NaN->0]';
      results.push({
        projectId: projKey,
        targetId: target.id,
        delta,
        notes: `[AUTO] relevance=${relevance.toFixed(2)}, share=${share.toFixed(2)}, execWeight=${clippedExecWeight.toFixed(2)}${notesSuffix}`,
        source: 'auto',
        locked: false,
        confidence: Math.max(0, Math.min(1, confidence)),
      });
    });

    // ログ出力（target単位）
    if (DEBUG) {
      console.log(`[autoLinking][target] ${target.id} ${target.label}: gapYen=${gapYen}, gapFinite=${gapFinite}, fallback=${fallbackUsed}`);
    }
  });

  // ★修正：最後の保険（results.length===0 の場合）
  if (results.length === 0 && companyTargets.length > 0 && projectKeys.length > 0) {
    if (DEBUG) {
      console.log('[autoLinking] EMPTY-SAFEGUARD: results=0, generating delta=0 for first project per target');
    }

    companyTargets.forEach((target) => {
      if (!projectKeys[0]) return; // projectKeys が空ならスキップ

      results.push({
        projectId: projectKeys[0],
        targetId: target.id,
        delta: 0,
        notes: `[AUTO-EMPTY-SAFEGUARD] 生成ロジック全failure時の保険`,
        source: 'auto',
        locked: false,
        confidence: 0,
      });
    });

    if (DEBUG) {
      console.log(`[autoLinking] SAFEGUARD generated ${results.length} impacts`);
    }
  }

  // ★最終ログ（必ず N > 0 を確認）
  if (DEBUG) {
    console.log(`[STAGE6] AUTO targetImpacts: ${results.length}件生成（${results.length > 0 ? '✓' : '✗'}）`);
  }

  return results;
}

/**
 * mergeImpacts: manual と auto をマージ
 *
 * ルール：
 * 1. manual（or locked）があれば採用
 * 2. 無ければ auto を採用
 * 3. locked===true は上書き禁止
 */
export function mergeImpacts(args: {
  manual: ProjectTargetImpact[];
  auto: ProjectTargetImpact[];
}): ProjectTargetImpact[] {
  const { manual, auto } = args;

  // manual/auto を projectId+targetId キーで Map 化
  const manualMap = new Map<string, ProjectTargetImpact>();
  manual.forEach((m) => {
    const key = `${m.projectId}/${m.targetId}`;
    manualMap.set(key, m);
  });

  const autoMap = new Map<string, ProjectTargetImpact>();
  auto.forEach((a) => {
    const key = `${a.projectId}/${a.targetId}`;
    autoMap.set(key, a);
  });

  // merge ロジック
  const result = new Map<string, ProjectTargetImpact>();

  // manual を優先採用
  manualMap.forEach((m, key) => {
    result.set(key, m);
  });

  // auto は manual になければ採用
  autoMap.forEach((a, key) => {
    if (!result.has(key)) {
      result.set(key, a);
    }
  });

  return Array.from(result.values());
}

/**
 * inferAutoProjectIssueLinks: AUTO推定の生成（タブ3用）
 *
 * 方針：
 * 1. CompanyTarget.linkedIssueIds を優先候補として抽出
 * 2. projectText = project title + KR label +（可能なら）ログ要約
 * 3. issueText = issue title + description + linkedMetrics
 * 4. 単純一致（contains）でスコアリング → strength(1/2/3)に離散化
 * 5. STAGE5補正：progress/★/最新ログあり なら strength を +1（上限3）
 */
export function inferAutoProjectIssueLinks(args: {
  stage1Issues: IssueBlock[];
  companyTargets: CompanyTarget[];
  projectKeys: string[];
  projectKrsMap: Map<string, BridgeKR[]>;
  progressLogs?: any[];
  executionWeightsMap: Map<string, { weight: number }>;
  projectDeptMap?: Map<string, { dept: string; proj: string }>;
}): ProjectIssueLink[] {
  const {
    stage1Issues,
    companyTargets,
    projectKeys,
    projectKrsMap,
    progressLogs,
    executionWeightsMap,
    projectDeptMap,
  } = args;

  const DEBUG = process.env.NODE_ENV === 'development' && !!process.env.NEXT_PUBLIC_DEBUG_STAGE6;

  // ★Early return logs
  if (!stage1Issues || stage1Issues.length === 0) {
    if (DEBUG) console.log('[autoLinking] skip: stage1Issues empty');
    return [];
  }
  if (!projectKeys || projectKeys.length === 0) {
    if (DEBUG) console.log('[autoLinking] skip: projectKeys empty (issue links)');
    return [];
  }
  if (!projectKrsMap || projectKrsMap.size === 0) {
    if (DEBUG) console.log('[autoLinking] skip: projectKrsMap empty (issue links)');
    return [];
  }

  const results: ProjectIssueLink[] = [];

  // CompanyTarget.linkedIssueIds から「重要論点」を抽出
  const importantIssueIds = new Set<string>();
  companyTargets.forEach((t) => {
    if (t.linkedIssueIds && Array.isArray(t.linkedIssueIds)) {
      t.linkedIssueIds.forEach((id) => importantIssueIds.add(id));
    }
  });

  // progressLogs で projectId 別に最新★数を集計
  const projectStarMap = new Map<string, { count: number; latest?: string }>();
  if (progressLogs && Array.isArray(progressLogs)) {
    progressLogs.forEach((log) => {
      // log.project から projectId を推定（簡易版：projectTitle で照合）
      // または log 内に projectKey が直接入っていると想定
      if (log.project || log.projectKey || log.projectId) {
        const projId = log.projectKey ?? log.projectId ?? log.project;
        if (projId && typeof projId === 'string') {
          const stars = (log.rating ?? 0) > 2.5 ? 1 : 0; // ★を 3点以上で count
          const current = projectStarMap.get(projId) ?? { count: 0 };
          projectStarMap.set(projId, {
            count: current.count + stars,
            latest: log.updated_at ?? current.latest,
          });
        }
      }
    });
  }

  // projectKey ごとに issue との関連度を計算
  projectKeys.forEach((projKey) => {
    const krs = projectKrsMap.get(projKey) ?? [];

    // project テキスト構築
    const projMeta = projectDeptMap?.get(projKey) ?? { dept: '', proj: '' };
    const krLabels = krs.map((kr) => kr.label).join(' | ');
    const projectText = `${projMeta.proj} ${krLabels} ${projMeta.dept}`.toLowerCase();

    stage1Issues.forEach((issue) => {
      // issue テキスト構築
      const issueText = `${issue.title} ${issue.description} ${(issue.linkedMetrics ?? []).join(' ')}`.toLowerCase();

      // 単純一致スコア（キーワードの含有度）
      const issueKeywords = issue.title.toLowerCase().split(/\s+/);
      let matchCount = 0;

      issueKeywords.forEach((keyword) => {
        if (keyword.length > 2 && projectText.includes(keyword)) {
          matchCount += 1;
        }
      });

      // 重要論点かどうかで加点
      const isImportant = importantIssueIds.has(issue.title);
      if (isImportant) {
        matchCount += 2; // ボーナス
      }

      if (matchCount === 0) {
        return; // スコア 0 なら関連なし
      }

      // strength に離散化（1..3）
      let strength: 1 | 2 | 3 = 1; // デフォルト：弱
      if (matchCount >= 3) {
        strength = 3; // 強
      } else if (matchCount >= 2) {
        strength = 2; // 中
      }

      // STAGE5補正：ログに進捗/★があれば strength を +1（上限3）
      const projLog = projectStarMap.get(projKey);
      if (projLog && projLog.count > 0) {
        strength = Math.min(3, (strength + 1) as 1 | 2 | 3);
      }

      // 信頼度：matchCount と executionWeight に基づく
      const execWeight = executionWeightsMap.get(projKey)?.weight ?? 1.0;
      const clippedExecWeight = Math.max(0.7, Math.min(1.2, execWeight));
      const confidence = Math.min(1, (matchCount * 0.15 + clippedExecWeight * 0.5) / 1.0);

      results.push({
        projectId: projKey,
        issueId: issue.title,
        strength,
        notes: `[AUTO] matchCount=${matchCount}, important=${isImportant}, stars=${projLog?.count ?? 0}`,
        source: 'auto',
        locked: false,
        confidence: Math.max(0, Math.min(1, confidence)),
      });
    });
  });

  // ★修正：最後の保険（results.length===0 の場合）
  if (results.length === 0 && stage1Issues.length > 0 && projectKeys.length > 0) {
    if (DEBUG) {
      console.log('[autoLinking-ISSUE] EMPTY-SAFEGUARD: results=0, generating strength=1 for first project per issue');
    }

    stage1Issues.forEach((issue) => {
      if (!projectKeys[0]) return; // projectKeys が空ならスキップ

      results.push({
        projectId: projectKeys[0],
        issueId: issue.title,
        strength: 1, // 弱
        notes: `[AUTO-EMPTY-SAFEGUARD-ISSUE] 生成ロジック全failure時の保険`,
        source: 'auto',
        locked: false,
        confidence: 0,
      });
    });

    if (DEBUG) {
      console.log(`[autoLinking-ISSUE] SAFEGUARD generated ${results.length} issue links`);
    }
  }

  // ★最終ログ（必ず N > 0 を確認）
  if (DEBUG) {
    console.log(`[STAGE6] AUTO issueLinks: ${results.length}件生成（${results.length > 0 ? '✓' : '✗'}）`);
  }

  return results;
}

/**
 * mergeLinks: manual と auto をマージ（IssueLinks版）
 */
export function mergeLinks(args: {
  manual: ProjectIssueLink[];
  auto: ProjectIssueLink[];
}): ProjectIssueLink[] {
  const { manual, auto } = args;

  const manualMap = new Map<string, ProjectIssueLink>();
  manual.forEach((m) => {
    const key = `${m.projectId}/${m.issueId}`;
    manualMap.set(key, m);
  });

  const autoMap = new Map<string, ProjectIssueLink>();
  auto.forEach((a) => {
    const key = `${a.projectId}/${a.issueId}`;
    autoMap.set(key, a);
  });

  const result = new Map<string, ProjectIssueLink>();

  // manual を優先採用
  manualMap.forEach((m, key) => {
    result.set(key, m);
  });

  // auto は manual になければ採用
  autoMap.forEach((a, key) => {
    if (!result.has(key)) {
      result.set(key, a);
    }
  });

  return Array.from(result.values());
}
