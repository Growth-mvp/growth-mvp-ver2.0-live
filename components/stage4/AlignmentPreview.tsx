// components/stage4/AlignmentPreview.tsx
import React from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Stage4Current } from '@/types/strategy';

type AlignmentPreviewProps = {
  current: Stage4Current;
  valueDriverKPIs?: Array<{ id: string; label: string }>;
  targetRanges?: {
    low?: Record<string, number>;
    base?: Record<string, number>;
    high?: Record<string, number>;
  };
};

type AlignmentIssue = {
  type: 'unmapped' | 'warning' | 'ok';
  projectTitle: string;
  message: string;
};

function checkAlignment(
  current: Stage4Current,
  valueDriverKPIs?: Array<{ id: string; label: string }>,
  targetRanges?: { low?: Record<string, number>; base?: Record<string, number>; high?: Record<string, number> }
): AlignmentIssue[] {
  const issues: AlignmentIssue[] = [];

  if (!valueDriverKPIs || valueDriverKPIs.length === 0) {
    issues.push({
      type: 'warning',
      projectTitle: '全体',
      message: 'STAGE2の価値指標（Value Driver KPIs）が未設定です',
    });
    return issues;
  }

  const kpiIds = new Set(valueDriverKPIs.map((k) => k.id));

  for (const proj of current.projects) {
    const linkedKpis = proj.valueDriverLinks ?? [];

    if (linkedKpis.length === 0) {
      issues.push({
        type: 'unmapped',
        projectTitle: proj.title,
        message: '価値指標へのリンクが未設定です',
      });
      continue;
    }

    // マッチできない指標をチェック
    const unmapped = linkedKpis.filter((id) => !kpiIds.has(id));
    if (unmapped.length > 0) {
      issues.push({
        type: 'warning',
        projectTitle: proj.title,
        message: `リンク先の指標が見つかりません: ${unmapped.join(', ')}`,
      });
    }

    // 目標レンジとのマッチング簡易チェック
    const kpiTargets = proj.kpiTargets || {};
    if (targetRanges && Object.keys(kpiTargets).length > 0) {
      const baseRange = targetRanges.base || {};
      let hasOutOfRange = false;

      for (const [kpiKey, target] of Object.entries(kpiTargets)) {
        const rangeValue = baseRange[kpiKey];
        if (rangeValue !== undefined && typeof target === 'number') {
          // 簡易チェック：基準値の±50%範囲を超えていたら警告
          const lowerBound = rangeValue * 0.5;
          const upperBound = rangeValue * 1.5;
          if (target < lowerBound || target > upperBound) {
            hasOutOfRange = true;
          }
        }
      }

      if (hasOutOfRange) {
        issues.push({
          type: 'warning',
          projectTitle: proj.title,
          message: '一部のKPIターゲットがSTAGE2の目標レンジから大きく外れています',
        });
      }
    }
  }

  // 問題がなければOKメッセージ
  if (issues.length === 0) {
    issues.push({
      type: 'ok',
      projectTitle: '全体',
      message: 'すべてのプロジェクトがSTAGE2の価値指標にマッピングされています',
    });
  }

  return issues;
}

export function AlignmentPreview({ current, valueDriverKPIs, targetRanges }: AlignmentPreviewProps) {
  const issues = checkAlignment(current, valueDriverKPIs, targetRanges);

  const unmappedCount = issues.filter((i) => i.type === 'unmapped').length;
  const warningCount = issues.filter((i) => i.type === 'warning').length;
  const okCount = issues.filter((i) => i.type === 'ok').length;

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-gray-700">整合性チェック（STAGE2連携）</div>

      {/* サマリー */}
      <div className="flex items-center gap-4 text-sm">
        {okCount > 0 && (
          <span className="flex items-center gap-1.5 text-green-700">
            <CheckCircle2 className="w-4 h-4" />
            整合OK
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1.5 text-yellow-700">
            <AlertTriangle className="w-4 h-4" />
            警告: {warningCount}件
          </span>
        )}
        {unmappedCount > 0 && (
          <span className="flex items-center gap-1.5 text-red-700">
            <AlertTriangle className="w-4 h-4" />
            未マッピング: {unmappedCount}件
          </span>
        )}
      </div>

      {/* 詳細リスト */}
      <div className="space-y-2">
        {issues.map((issue, idx) => {
          const config =
            issue.type === 'ok'
              ? { icon: <CheckCircle2 className="w-4 h-4" />, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800' }
              : issue.type === 'warning'
                ? { icon: <AlertTriangle className="w-4 h-4" />, bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800' }
                : { icon: <Info className="w-4 h-4" />, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800' };

          return (
            <div key={idx} className={`flex items-start gap-2 text-sm ${config.bg} p-2 rounded border ${config.border}`}>
              <div className={`mt-0.5 shrink-0 ${config.text}`}>{config.icon}</div>
              <div className={config.text}>
                {issue.projectTitle !== '全体' && <span className="font-medium">[{issue.projectTitle}]</span>}{' '}
                {issue.message}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
