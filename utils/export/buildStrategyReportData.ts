/**
 * /utils/export/buildStrategyReportData.ts
 *
 * 目的：
 * - StrategyStore のデータから、統合レポート用のデータを構築
 * - STAGE1〜4の要約をすべて取得
 * - 読み取り専用（データの変更は一切しない）
 * - 不足データは graceful に処理（未入力表記）
 * - 内部情報（fact-seg, fact-cust, DEBUG等）をフィルタリング
 *
 * 使用箇所：
 * - StrategyReportView.tsx で呼び出し
 * - API の saveStrategyData, useAutoSave とは無関係
 */

import type { StrategyState } from '@/store/strategyStore';
import type {
  Department,
  Project,
  OKR,
  ChapterAnswers,
  HumanInvestment,
} from '@/types/strategy';

/**
 * レポート用の正規化されたデータ型
 */
export interface ReportData {
  // 基本情報
  companyName: string;
  reportGeneratedAt: string; // ISO 8601
  reportType: string; // 常に "戦略実行レポート"

  // STAGE1：企業価値分析
  stage1: {
    industry: string;
    revenue: string;
    employees: string;
    businessContent: string;
    businessSegments: Array<{ name: string }>;
    swot: {
      strength: string[];
      weakness: string[];
      opportunity: string[];
      threat: string[];
    };
  };

  // STAGE2：経営戦略
  stage2: {
    mvv: {
      mission: string;
      vision: string;
      value: string;
    };
    ceoThought: string;
    storyChapters: Array<{
      index: number;
      title: string;
      content: string;
    }>;
    winPatterns: {
      primary?: string;
      secondary?: string;
    };
  };

  // STAGE3：部門戦略
  stage3: {
    departments: Array<{
      name: string;
      mission: string;
      missionDescription: string;
      projects: Array<{
        title: string;
        hypothesis: string;
        kpiTargets: string[];
        expectedImpactYen?: number;
        probability?: number;
      }>;
    }>;
  };

  // STAGE4：OKR実行計画
  stage4: {
    okrs: Array<{
      departmentName: string;
      projectName: string;
      objective: string;
      keyResults: Array<{
        statement: string;
        owner?: string;
      }>;
    }>;
  };

  // 実行上の論点
  executionNotes: {
    crossDepartmentalIssues?: string[];
    risks?: string[];
  };
}

/**
 * StrategyStore から ReportData を構築
 * - ブラウザ側 useStrategyStore.getState() の結果を渡す
 * - STAGE1〜4の全データを統合
 */
export function buildStrategyReportData(state: StrategyState): ReportData {
  const now = new Date();
  const reportGeneratedAt = now.toISOString();
  const companyName = state.companyName || '（会社名未入力）';

  return {
    companyName,
    reportGeneratedAt,
    reportType: '戦略実行レポート',

    // STAGE1：企業価値分析
    stage1: extractStage1Data(state),

    // STAGE2：経営戦略
    stage2: extractStage2Data(state),

    // STAGE3：部門戦略
    stage3: extractStage3Data(state),

    // STAGE4：OKR実行計画
    stage4: extractStage4Data(state),

    // 実行上の論点
    executionNotes: extractExecutionNotes(state),
  };
}

/**
 * STAGE1 データを抽出
 */
function extractStage1Data(state: StrategyState) {
  const businessSegments = state.businessSegments || [];
  const swotArray = (term: string): string[] => {
    const value = (state as any)?.[term];
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((v: any) => v && typeof v === 'string').map(sanitizeText);
    if (typeof value === 'string') return value.trim() ? [sanitizeText(value)] : [];
    return [];
  };

  return {
    industry: sanitizeText(state.industry || '（未入力）'),
    revenue: sanitizeText(state.revenue || '（未入力）'),
    employees: sanitizeText(state.employees || '（未入力）'),
    businessContent: sanitizeText(state.businessContent || '（未入力）'),
    businessSegments: businessSegments
      .filter((seg: any) => seg?.name)
      .map((seg: any) => ({ name: sanitizeText(seg.name) })),
    swot: {
      strength: swotArray('strength'),
      weakness: swotArray('weakness'),
      opportunity: swotArray('opportunity'),
      threat: swotArray('threat'),
    },
  };
}

/**
 * STAGE2 データを抽出
 */
function extractStage2Data(state: StrategyState) {
  return {
    mvv: {
      mission: sanitizeText(state.mission || '（未入力）'),
      vision: sanitizeText(state.vision || '（未入力）'),
      value: sanitizeText(state.value || '（未入力）'),
    },
    ceoThought: sanitizeText(state.thought || '（未入力）'),
    storyChapters: extractStoryChapters(state),
    winPatterns: {
      primary: sanitizeText((state as any)?.winPatternPrimary || undefined),
      secondary: sanitizeText((state as any)?.winPatternSecondary || undefined),
    },
  };
}

/**
 * STAGE3 データを抽出
 */
function extractStage3Data(state: StrategyState) {
  const deptList = state.departments || [];
  return {
    departments: deptList.map((dept: Department) => ({
      name: sanitizeText(dept.name || '（部門名未入力）'),
      mission: sanitizeText(dept.mission || '（ミッション未入力）'),
      missionDescription: sanitizeText(extractMissionDescription(dept) || '（説明未入力）'),
      projects: extractProjects(dept),
    })),
  };
}

/**
 * STAGE4 データを抽出
 * ★ 修正：departments[].projects[].okrs から正しく取得
 */
function extractStage4Data(state: StrategyState) {
  const departments = state.departments || [];
  const okrs: ReportData['stage4']['okrs'] = [];

  for (const dept of departments) {
    const projects = dept.projects || [];
    for (const proj of projects) {
      const projOkrs = (proj as any)?.okrs;
      if (!Array.isArray(projOkrs)) continue;

      for (const okr of projOkrs) {
        if (!okr?.objective) continue;

        const keyResults = Array.isArray(okr.keyResults)
          ? okr.keyResults.map((kr: any) => {
              const statement =
                typeof kr === 'string'
                  ? kr
                  : typeof kr === 'object'
                    ? kr?.statement || kr?.label || kr?.title || '（KR未入力）'
                    : '（KR未入力）';
              return {
                statement: sanitizeText(statement),
                owner: sanitizeText(okr.owner || undefined),
              };
            })
          : [];

        okrs.push({
          departmentName: sanitizeText(dept.name || '（部門名未入力）'),
          projectName: sanitizeText(proj.title || '（プロジェクト名未入力）'),
          objective: sanitizeText(okr.objective),
          keyResults,
        });
      }
    }
  }

  return { okrs };
}

/**
 * ストーリーの4章を抽出（storyChapters or story）
 */
function extractStoryChapters(
  state: StrategyState,
): Array<{ index: number; title: string; content: string }> {
  // storyChapters が配列ならそれを利用
  const chapters = (state as any)?.storyChapters;
  if (Array.isArray(chapters)) {
    return chapters
      .map((ch: any, idx: number) => ({
        index: idx + 1,
        title: sanitizeText(ch?.title || `第${idx + 1}章`),
        content: sanitizeText(ch?.content || '（未入力）'),
      }))
      .slice(0, 4); // 最大4章
  }

  // story フィールドが文字列ならそれを1つの章として
  if (typeof state.story === 'string' && state.story.trim()) {
    return [
      {
        index: 1,
        title: '戦略ストーリー',
        content: sanitizeText(state.story),
      },
    ];
  }

  // finalStory もチェック
  if (typeof (state as any)?.finalStory === 'string') {
    return [
      {
        index: 1,
        title: '戦略ストーリー',
        content: sanitizeText((state as any).finalStory),
      },
    ];
  }

  return [];
}

/**
 * 部門のミッション説明を抽出（answers2, 再考ポイントなど）
 */
function extractMissionDescription(dept: Department): string {
  // answers2 から最初のテキストを探す
  if (Array.isArray((dept as any)?.answers2)) {
    const answers = (dept as any).answers2 as ChapterAnswers[];
    for (const ans of answers) {
      if (ans?.content && typeof ans.content === 'string') {
        return ans.content.substring(0, 200); // 最初の200文字
      }
    }
  }

  // strategy フィールド
  if (typeof (dept as any)?.strategy === 'string') {
    return (dept as any).strategy;
  }

  return '';
}

/**
 * 部門のプロジェクトを抽出
 */
function extractProjects(
  dept: Department,
): ReportData['stage3']['departments'][0]['projects'] {
  const projects = dept.projects || [];
  return projects.map((proj: Project) => ({
    title: sanitizeText(proj.title || '（プロジェクト名未入力）'),
    hypothesis: sanitizeText(
      typeof proj.hypothesis === 'string'
        ? proj.hypothesis
        : typeof proj.hypothesis === 'object'
          ? (proj.hypothesis as any)?.statement || '（仮説未入力）'
          : '（仮説未入力）',
    ),
    kpiTargets: extractKpiTargets(proj),
    expectedImpactYen: (proj as any)?.expectedImpactYen,
    probability: (proj as any)?.probability,
  }));
}

/**
 * プロジェクトのKPI案を抽出
 */
function extractKpiTargets(proj: Project): string[] {
  const targets: string[] = [];

  // OKRから KPI名を抽出
  if (Array.isArray(proj.okrs)) {
    const okrs = proj.okrs as OKR[];
    okrs.forEach((okr) => {
      if (okr.objective) {
        targets.push(sanitizeText(okr.objective));
      }
      if (Array.isArray(okr.keyResults)) {
        okr.keyResults.forEach((kr: any) => {
          const text =
            typeof kr === 'string'
              ? kr
              : typeof kr === 'object'
                ? kr?.statement || kr?.label || kr?.title || ''
                : '';
          if (text) {
            targets.push(sanitizeText(text));
          }
        });
      }
    });
  }

  return targets.slice(0, 5); // 最大5件
}

/**
 * 実行上の論点を抽出
 */
function extractExecutionNotes(
  state: StrategyState,
): ReportData['executionNotes'] {
  const notes: ReportData['executionNotes'] = {};

  // cross-departmental issues（複数部門の答えがあれば）
  const departments = state.departments || [];
  const crossDeptIssues: string[] = [];
  for (const dept of departments) {
    if (Array.isArray((dept as any)?.answers2)) {
      const answers = (dept as any).answers2 as ChapterAnswers[];
      for (const ans of answers) {
        if (ans?.content && ans.content.includes('協力')) {
          const sanitized = sanitizeText(ans.content.substring(0, 100));
          if (sanitized) crossDeptIssues.push(sanitized);
        }
      }
    }
  }
  if (crossDeptIssues.length > 0) {
    notes.crossDepartmentalIssues = crossDeptIssues.slice(0, 3);
  }

  // risks（threat フィールドから抽出）
  const risks: string[] = [];
  if (typeof state.threat === 'string' && state.threat.trim()) {
    const sanitized = sanitizeText(state.threat);
    if (sanitized) risks.push(sanitized);
  }
  if (risks.length > 0) {
    notes.risks = risks;
  }

  return notes;
}

/**
 * テキストをサニタイズ：内部情報（fact-seg, fact-cust, DEBUG等）を除去
 */
export function sanitizeText(text: string | undefined | null): string {
  if (!text) return '';

  let sanitized = String(text)
    // 内部ID・ファクト情報を除去
    .replace(/\bfact-seg-\d+\b/gi, '')
    .replace(/\bfact-cust-\d+\b/gi, '')
    .replace(/\bfact-\w+\b/gi, '')
    // DEBUG関連を除去
    .replace(/\【DEBUG\】/g, '')
    .replace(/\[DEBUG\]/gi, '')
    .replace(/DEBUG[:\s]*\S*/gi, '')
    // 複数の空白を1つに
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized;
}

/**
 * ISO 日時をローカライズ（日本語表記）
 */
export function formatReportDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}
