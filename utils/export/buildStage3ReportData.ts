/**
 * /utils/export/buildStage3ReportData.ts
 *
 * 目的：
 * - STAGE3 部門戦略レポート用データの構築
 * - 読み取り専用
 */

import type { StrategyState } from '@/store/strategyStore';
import type { Department, Project, ChapterAnswers } from '@/types/strategy';

export interface Stage3ReportData {
  companyName: string;
  generatedDate: string;

  // 経営戦略サマリー
  storyChapters: Array<{
    index: number;
    title: string;
    content: string;
  }>;

  // 部門別詳細
  departments: Array<{
    name: string;
    mission: string;
    missionDescription: string;
    hypothesis: string;
    projects: Array<{
      title: string;
      hypothesis: string;
      kpiTargets: string[];
    }>;
    answers: Array<{
      questionIndex: number;
      question: string;
      answer: string;
    }>;
    reconsiderationPoints: string[];
  }>;

  // 部門横断的事項
  crossDepartmentIssues: string[];
  finalStrategy: string;
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

  return {
    companyName: state.companyName || '（会社名未入力）',
    generatedDate,
    storyChapters: extractStoryChapters(state),
    departments: extractDepartments(state),
    crossDepartmentIssues: extractCrossDepartmentIssues(state),
    finalStrategy: (state as any)?.thought || '（最終戦略未入力）',
  };
}

/**
 * ストーリーの4章を抽出
 */
function extractStoryChapters(
  state: StrategyState,
): Stage3ReportData['storyChapters'] {
  const chapters = (state as any)?.storyChapters;
  if (Array.isArray(chapters)) {
    return chapters
      .map((ch: any, idx: number) => ({
        index: idx + 1,
        title: ch?.title || `第${idx + 1}章`,
        content: ch?.content || '（未入力）',
      }))
      .slice(0, 4);
  }

  if (typeof state.story === 'string' && state.story.trim()) {
    return [
      {
        index: 1,
        title: 'ストーリー',
        content: state.story,
      },
    ];
  }

  if (typeof (state as any)?.finalStory === 'string') {
    return [
      {
        index: 1,
        title: 'ストーリー',
        content: (state as any).finalStory,
      },
    ];
  }

  return [];
}

/**
 * 部門戦略を抽出
 */
function extractDepartments(state: StrategyState): Stage3ReportData['departments'] {
  const deptList = state.departments || [];
  return deptList.map((dept: Department) => ({
    name: dept.name || '（部門名未入力）',
    mission: dept.mission || '（ミッション未入力）',
    missionDescription: extractMissionDescription(dept),
    hypothesis: extractDepartmentHypothesis(dept),
    projects: extractProjects(dept),
    answers: extractAnswers(dept),
    reconsiderationPoints: extractReconsiderationPoints(dept),
  }));
}

/**
 * 部門のミッション説明を抽出
 */
function extractMissionDescription(dept: Department): string {
  if (Array.isArray((dept as any)?.answers2)) {
    const answers = (dept as any).answers2 as ChapterAnswers[];
    for (const ans of answers) {
      if (ans?.content && typeof ans.content === 'string') {
        return ans.content.substring(0, 300);
      }
    }
  }

  if (typeof (dept as any)?.strategy === 'string') {
    return (dept as any).strategy;
  }

  return '（説明未入力）';
}

/**
 * 部門の仮説を抽出
 */
function extractDepartmentHypothesis(dept: Department): string {
  if (typeof (dept as any)?.hypothesis === 'string') {
    return (dept as any).hypothesis;
  }

  // プロジェクトから最初の仮説を取る
  const projects = dept.projects || [];
  for (const proj of projects) {
    if (typeof proj.hypothesis === 'string') {
      return proj.hypothesis;
    } else if (typeof proj.hypothesis === 'object' && (proj.hypothesis as any)?.statement) {
      return (proj.hypothesis as any).statement;
    }
  }

  return '（仮説未入力）';
}

/**
 * プロジェクトを抽出
 */
function extractProjects(
  dept: Department,
): Stage3ReportData['departments'][0]['projects'] {
  const projects = dept.projects || [];
  return projects.map((proj: Project) => ({
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
 * 6テーマの回答を抽出
 */
function extractAnswers(
  dept: Department,
): Stage3ReportData['departments'][0]['answers'] {
  const answers2 = (dept as any)?.answers2;
  if (!Array.isArray(answers2)) {
    return [];
  }

  return answers2
    .filter((a: ChapterAnswers) => a?.content)
    .map((a: ChapterAnswers, idx: number) => ({
      questionIndex: idx + 1,
      question: a.chapterTitle || `質問${idx + 1}`,
      answer: a.content || '（未入力）',
    }))
    .slice(0, 6);
}

/**
 * 再考ポイントを抽出
 */
function extractReconsiderationPoints(dept: Department): string[] {
  const points: string[] = [];

  // missionDraft, strategy 等から抽出
  if (typeof (dept as any)?.missionDraft === 'string') {
    points.push((dept as any).missionDraft);
  }

  if (typeof (dept as any)?.reconsiderationPoints === 'string') {
    points.push((dept as any).reconsiderationPoints);
  }

  // answers2 から「再考」キーワード含むものを抽出
  if (Array.isArray((dept as any)?.answers2)) {
    (dept as any).answers2.forEach((a: ChapterAnswers) => {
      if (a?.content && a.content.includes('再考')) {
        points.push(a.content);
      }
    });
  }

  return points.slice(0, 3);
}

/**
 * 部門横断の課題を抽出
 */
function extractCrossDepartmentIssues(state: StrategyState): string[] {
  const issues: string[] = [];

  const deptList = state.departments || [];
  for (const dept of deptList) {
    if (Array.isArray((dept as any)?.answers2)) {
      const answers = (dept as any).answers2 as ChapterAnswers[];
      for (const ans of answers) {
        if (ans?.content && (ans.content.includes('協力') || ans.content.includes('連携'))) {
          issues.push(`[${dept.name}] ${ans.content.substring(0, 100)}`);
        }
      }
    }
  }

  return issues.slice(0, 5);
}
