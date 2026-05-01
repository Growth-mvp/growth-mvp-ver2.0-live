/**
 * /utils/export/buildStage3ReportData.ts
 *
 * 目的：
 * - STAGE3 部門戦略レポート用データの構築
 * - 読み取り専用、網羅的情報取得
 */

import type { StrategyState } from '@/store/strategyStore';
import type { Department, Project, ChapterAnswers, AnswerStep } from '@/types/strategy';

export interface Stage3ReportData {
  companyName: string;
  generatedDate: string;

  // 経営戦略サマリー
  storyChapters: Array<{
    index: number;
    title: string;
    content: string;
  }>;

  // 勝ち筋
  winPatternPrimary?: string;
  winPatternSecondary?: string;

  // 部門別詳細
  departments: Array<{
    name: string;

    // STEP1: たたき台
    step1: {
      missionDraft: string;
      missionDescription: string;
      generationMeta?: {
        existingCount?: number;
        newCount?: number;
        intraCollabCount?: number;
        interCollabCount?: number;
        collabCount?: number;
        totalCount?: number;
      };
      existingProjects: Array<{
        title: string;
        hypothesis: string;
        kpiTargets: string[];
      }>;
      newProjects: Array<{
        title: string;
        hypothesis: string;
        kpiTargets: string[];
      }>;
      intraDeptCollab: string[];
      interDeptCollab: string[];
    };

    // STEP2: 6テーマ議論
    step2: {
      answers: Array<{
        stepNumber: number;
        question: string;
        answer: string;
        reason?: string;
      }>;
      discussionNotes?: string;
    };

    // STEP3: 再生成結果
    step3: {
      missionAfterRegen: string;
      projectsAfterRegen: Array<{
        title: string;
        hypothesis: string;
        kpiTargets: string[];
      }>;
      correctedItems: string[];
      reconsiderationPoints: string[];
      riskNotes: string[];
      stopList: string[];
      first90Days: string[];
    };

    // STEP4: 最終調整
    step4: {
      finalMission: string;
      finalStrategy: string;
      finalProjects: Array<{
        title: string;
        hypothesis: string;
        kpiTargets: string[];
      }>;
    };
  }>;

  // 部門横断的事項
  crossDepartmentIssues: string[];
}

/**
 * STAGE3 レポートデータを構築
 */
export function buildStage3ReportData(state: StrategyState): Stage3ReportData {
  const now = new Date();
  const generatedDate = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const winPatterns = extractWinPatterns(state);

  return {
    companyName: state.companyName || '（会社名未入力）',
    generatedDate,
    storyChapters: extractStoryChapters(state),
    winPatternPrimary: winPatterns.primary,
    winPatternSecondary: winPatterns.secondary,
    departments: extractDepartments(state),
    crossDepartmentIssues: extractCrossDepartmentIssues(state),
  };
}

/**
 * 勝ち筋を抽出
 */
function extractWinPatterns(state: StrategyState): {
  primary?: string;
  secondary?: string;
} {
  return {
    primary: (state as any)?.winPatternPrimary,
    secondary: (state as any)?.winPatternSecondary,
  };
}

/**
 * ストーリーの4章を抽出（finalStory優先）
 */
function extractStoryChapters(
  state: StrategyState,
): Stage3ReportData['storyChapters'] {
  // ★ finalStory > finalStoryEdited > finalStoryDraft > storyChapters の順で優先度あり
  const finalStoryFinal = (state as any)?.finalStoryFinal;
  const finalStoryEdited = (state as any)?.finalStoryEdited;
  const finalStoryDraft = (state as any)?.finalStoryDraft;
  const finalStory = (state as any)?.finalStory;

  const storyToUse = finalStoryFinal || finalStoryEdited || finalStoryDraft || finalStory;

  if (Array.isArray(storyToUse)) {
    return storyToUse
      .map((ch: any, idx: number) => ({
        index: idx + 1,
        title: ch?.title || `第${idx + 1}章`,
        content: ch?.body || ch?.content || '（未入力）',
      }))
      .slice(0, 4);
  }

  return [];
}

/**
 * 部門戦略を抽出（STEP1-4全段階）
 */
function extractDepartments(state: StrategyState): Stage3ReportData['departments'] {
  const deptList = state.departments || [];
  return deptList.map((dept: Department) => ({
    name: dept.name || '（部門名未入力）',
    step1: extractStep1(dept),
    step2: extractStep2(dept),
    step3: extractStep3(dept),
    step4: extractStep4(dept),
  }));
}

/**
 * STEP1: たたき台
 */
function extractStep1(dept: Department) {
  const allProjects = dept.projects || [];

  // 既存進化 vs 新規探索プロジェクト
  const existingProjects = extractProjectList(dept.lanes?.existing?.projects || []);
  const newProjects = extractProjectList(dept.lanes?.new?.projects || []);

  // lanes がない場合は全プロジェクトを既存として扱う
  const fallbackExisting = existingProjects.length + newProjects.length === 0 ? extractProjectList(allProjects) : [];

  return {
    missionDraft: dept.mission || '（ミッション未入力）',
    missionDescription: (dept as any)?.missionDescription || '（説明未入力）',
    generationMeta: (dept as any)?.generationMeta,
    existingProjects: existingProjects.length > 0 ? existingProjects : fallbackExisting,
    newProjects,
    intraDeptCollab: ensureArray((dept as any)?.intraDeptCollab),
    interDeptCollab: ensureArray((dept as any)?.interDeptCollab),
  };
}

/**
 * STEP2: 6テーマ議論
 */
function extractStep2(dept: Department) {
  const answers2 = (dept as any)?.answers2 as ChapterAnswers[] | undefined;

  // answers2[0].steps から AnswerStep[] を取得
  const steps = answers2?.[0]?.steps as AnswerStep[] | undefined;

  return {
    answers: ensureArray(steps)
      .map((step: AnswerStep) => ({
        stepNumber: step.stepNumber,
        question: step.question,
        answer: step.answer,
        reason: step.reason,
      }))
      .slice(0, 6),
    discussionNotes: (dept as any)?.discussionNotes,
  };
}

/**
 * STEP3: 再生成結果
 */
function extractStep3(dept: Department) {
  const reviewSummary = (dept as any)?.reviewSummary as
    | { correctedItems?: string[]; reconsiderationPoints?: string[] }
    | undefined;

  return {
    missionAfterRegen: dept.mission || '（再生成後ミッション未入力）',
    projectsAfterRegen: extractProjectList(dept.projects || []),
    correctedItems: ensureArray(reviewSummary?.correctedItems),
    reconsiderationPoints: ensureArray(reviewSummary?.reconsiderationPoints),
    riskNotes: ensureArray((dept as any)?.riskNotes),
    stopList: ensureArray((dept as any)?.stopList),
    first90Days: ensureArray((dept as any)?.first90Days),
  };
}

/**
 * STEP4: 最終調整
 */
function extractStep4(dept: Department) {
  return {
    finalMission: dept.mission || '（最終ミッション未入力）',
    finalStrategy: (dept as any)?.strategy || '（最終戦略未入力）',
    finalProjects: extractProjectList(dept.projects || []),
  };
}

/**
 * プロジェクトリストを抽出
 */
function extractProjectList(
  projects: Project[],
): Array<{
  title: string;
  hypothesis: string;
  kpiTargets: string[];
}> {
  return projects
    .filter((proj) => proj && proj.title)
    .map((proj: Project) => ({
      title: proj.title || '（プロジェクト名未入力）',
      hypothesis:
        typeof proj.hypothesis === 'string'
          ? proj.hypothesis
          : typeof proj.hypothesis === 'object'
            ? (proj.hypothesis as any)?.statement || '（仮説未入力）'
            : '（仮説未入力）',
      kpiTargets: extractKpiTargets(proj),
    }));
}


/**
 * KPI を抽出
 */
function extractKpiTargets(proj: Project): string[] {
  const targets: string[] = [];

  if (Array.isArray(proj.okrs)) {
    proj.okrs.forEach((okr: any) => {
      if (okr.objective) {
        targets.push(okr.objective);
      }
      if (Array.isArray(okr.keyResults)) {
        okr.keyResults.forEach((kr: any) => {
          if (typeof kr === 'string') {
            targets.push(kr);
          } else if (typeof kr === 'object' && kr?.statement) {
            targets.push(kr.statement);
          }
        });
      }
    });
  }

  return targets.slice(0, 5);
}


/**
 * 部門横断の課題を抽出（interDeptCollab から）
 */
function extractCrossDepartmentIssues(state: StrategyState): string[] {
  const issues: string[] = [];

  const deptList = state.departments || [];
  for (const dept of deptList) {
    const interCollab = ensureArray((dept as any)?.interDeptCollab);
    interCollab.forEach((item: string) => {
      if (item && item.trim()) {
        issues.push(`[${dept.name}] ${item}`);
      }
    });
  }

  return issues.slice(0, 10);
}

/**
 * 配列チェックヘルパー
 */
function ensureArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}
