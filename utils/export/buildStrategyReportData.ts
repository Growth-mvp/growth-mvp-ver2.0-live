/**
 * /utils/export/buildStrategyReportData.ts
 *
 * 目的：
 * - StrategyStore のデータから、レポート出力用のデータを構築
 * - 読み取り専用（データの変更は一切しない）
 * - 不足データは graceful に処理（未入力表記）
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

  // 経営戦略サマリー
  mvv: {
    mission: string;
    vision: string;
    value: string;
  };

  mainIssues: string[]; // 主要課題（ボード上で抽出）
  strategyDirection: string; // 戦略方針

  // ストーリー
  storyChapters: Array<{
    index: number;
    title: string;
    content: string;
  }>;

  // 勝ち筋
  winPatterns: {
    primary?: string;
    secondary?: string;
  };

  // 部門戦略
  departments: Array<{
    name: string;
    mission: string;
    missionDescription: string; // 再考ポイント等
    projects: Array<{
      title: string;
      hypothesis: string;
      kpiTargets: string[];
      expectedImpactYen?: number;
      probability?: number;
    }>;
  }>;

  // OKR実行計画
  okrs: Array<{
    departmentName: string;
    objective: string;
    keyResults: Array<{
      statement: string;
      owner?: string;
      targetValue?: string;
    }>;
  }>;

  // 実行上の論点
  executionNotes: {
    crossDepartmentalIssues?: string[];
    risks?: string[];
    cooperationRequests?: string[];
  };
}

/**
 * StrategyStore から ReportData を構築
 * - ブラウザ側 useStrategyStore.getState() の結果を渡す
 */
export function buildStrategyReportData(state: StrategyState): ReportData {
  const now = new Date();
  const reportGeneratedAt = now.toISOString();

  // ===== 基本情報 =====
  const companyName = state.companyName || '（会社名未入力）';

  // ===== MVV =====
  const mvv = {
    mission: state.mission || '（ミッション未入力）',
    vision: state.vision || '（ビジョン未入力）',
    value: state.value || '（バリュー未入力）',
  };

  // ===== 主要課題・戦略方針 =====
  const mainIssues = extractMainIssues(state);
  const strategyDirection = state.thought || '（戦略方針未入力）';

  // ===== ストーリー（STAGE2） =====
  const storyChapters = extractStoryChapters(state);

  // ===== 勝ち筋 =====
  const winPatterns = {
    primary: (state as any)?.winPatternPrimary || undefined,
    secondary: (state as any)?.winPatternSecondary || undefined,
  };

  // ===== 部門戦略 =====
  const departments = extractDepartments(state);

  // ===== OKR実行計画 =====
  const okrs = extractOkrs(state);

  // ===== 実行上の論点 =====
  const executionNotes = extractExecutionNotes(state);

  return {
    companyName,
    reportGeneratedAt,
    reportType: '戦略実行レポート',
    mvv,
    mainIssues,
    strategyDirection,
    storyChapters,
    winPatterns,
    departments,
    okrs,
    executionNotes,
  };
}

/**
 * 主要課題を抽出（board, thought など）
 */
function extractMainIssues(state: StrategyState): string[] {
  // state に board フィールドがあれば利用
  const board = (state as any)?.board;
  if (Array.isArray(board) && board.length > 0) {
    return board
      .filter((b: any) => b?.content)
      .map((b: any) => b.content)
      .slice(0, 5); // 最大5件
  }
  return [];
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
        title: ch?.title || `第${idx + 1}章`,
        content: ch?.content || '（未入力）',
      }))
      .slice(0, 4); // 最大4章
  }

  // story フィールドが文字列ならそれを1つの章として
  if (typeof state.story === 'string' && state.story.trim()) {
    return [
      {
        index: 1,
        title: 'ストーリー',
        content: state.story,
      },
    ];
  }

  // finalStory もチェック
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
function extractDepartments(state: StrategyState): ReportData['departments'] {
  const deptList = state.departments || [];
  return deptList.map((dept: Department) => ({
    name: dept.name || '（部門名未入力）',
    mission: dept.mission || '（ミッション未入力）',
    missionDescription:
      extractMissionDescription(dept) || '（説明未入力）',
    projects: extractProjects(dept),
  }));
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
): ReportData['departments'][0]['projects'] {
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

  return targets.slice(0, 5); // 最大5件
}

/**
 * OKR実行計画を抽出（STAGE4）
 */
function extractOkrs(state: StrategyState): ReportData['okrs'] {
  const stage4Plans = (state as any)?.stage4Plans;
  const departments = state.departments || [];

  if (!Array.isArray(stage4Plans) || stage4Plans.length === 0) {
    return [];
  }

  const result: ReportData['okrs'] = [];

  for (const plan of stage4Plans) {
    const departmentName = findDepartmentNameById(
      plan.departmentId,
      departments,
    );

    const keyResults = (plan.keyResults || []).map((kr: any) => ({
      statement:
        typeof kr === 'string'
          ? kr
          : typeof kr === 'object'
            ? kr?.statement || kr?.title || '（KR未入力）'
            : '（KR未入力）',
      owner: plan.owner || undefined,
      targetValue: undefined,
    }));

    result.push({
      departmentName,
      objective: plan.objective || '（Objective未入力）',
      keyResults,
    });
  }

  return result;
}

/**
 * 部門IDから部門名を取得
 */
function findDepartmentNameById(
  deptId: string,
  departments: Department[],
): string {
  const dept = departments.find(
    (d) => (d.id || d.name) === deptId || d.name === deptId,
  );
  return dept?.name || '（部門名不明）';
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
          crossDeptIssues.push(ans.content.substring(0, 100));
        }
      }
    }
  }
  if (crossDeptIssues.length > 0) {
    notes.crossDepartmentalIssues = crossDeptIssues.slice(0, 3);
  }

  // risks（strategy フィールドから抽出）
  const risks: string[] = [];
  if (typeof state.threat === 'string' && state.threat.trim()) {
    risks.push(state.threat);
  }
  if (risks.length > 0) {
    notes.risks = risks;
  }

  return notes;
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
