// components/stage4/DiffViewer.tsx
import React from 'react';
import { PlusCircle, MinusCircle, Edit3 } from 'lucide-react';
import type { Stage4Baseline, Stage4Current } from '@/types/strategy';

type DiffViewerProps = {
  baseline: Stage4Baseline;
  current: Stage4Current;
};

type DiffResult = {
  added: Array<{ type: string; title: string; detail?: string }>;
  removed: Array<{ type: string; title: string; detail?: string }>;
  changed: Array<{ type: string; title: string; detail?: string }>;
};

function computeDiff(baseline: Stage4Baseline, current: Stage4Current): DiffResult {
  const result: DiffResult = { added: [], removed: [], changed: [] };

  // プロジェクトタイトルでマッチング
  const baseProjects = new Map(baseline.projects.map((p) => [p.title, p]));
  const currProjects = new Map(current.projects.map((p) => [p.title, p]));

  // Added projects
  for (const [title] of currProjects) {
    if (!baseProjects.has(title)) {
      result.added.push({ type: 'プロジェクト', title });
    }
  }

  // Removed projects
  for (const [title] of baseProjects) {
    if (!currProjects.has(title)) {
      result.removed.push({ type: 'プロジェクト', title });
    }
  }

  // Changed projects (KPI/スキル/投資)
  for (const [title, currProj] of currProjects) {
    const baseProj = baseProjects.get(title);
    if (!baseProj) continue;

    // KPIターゲット比較
    const baseKpis = baseProj.kpiTargets || {};
    const currKpis = currProj.kpiTargets || {};
    const allKpiKeys = new Set([...Object.keys(baseKpis), ...Object.keys(currKpis)]);

    for (const key of allKpiKeys) {
      const baseVal = baseKpis[key];
      const currVal = currKpis[key];
      if (baseVal !== currVal) {
        result.changed.push({
          type: 'KPI',
          title: `${title} - ${key}`,
          detail: `${baseVal ?? '未設定'} → ${currVal ?? '削除'}`,
        });
      }
    }

    // スキル要件比較
    const baseSkills = [
      ...(baseProj.skillRequirements?.roleSkills ?? []),
      ...(baseProj.skillRequirements?.executionSkills ?? []),
    ];
    const currSkills = [
      ...(currProj.skillRequirements?.roleSkills ?? []),
      ...(currProj.skillRequirements?.executionSkills ?? []),
    ];

    const baseSkillSet = new Set(baseSkills);
    const currSkillSet = new Set(currSkills);

    for (const skill of currSkills) {
      if (!baseSkillSet.has(skill)) {
        result.added.push({ type: 'スキル', title: `${title} - ${skill}` });
      }
    }

    for (const skill of baseSkills) {
      if (!currSkillSet.has(skill)) {
        result.removed.push({ type: 'スキル', title: `${title} - ${skill}` });
      }
    }

    // 人的投資比較
    const baseInvestments = baseProj.humanInvestments ?? [];
    const currInvestments = currProj.humanInvestments ?? [];

    const baseInvTitles = new Set(baseInvestments.map((inv) => inv.title));
    const currInvTitles = new Set(currInvestments.map((inv) => inv.title));

    for (const inv of currInvestments) {
      if (!baseInvTitles.has(inv.title)) {
        result.added.push({ type: '人的投資', title: `${title} - ${inv.title}` });
      }
    }

    for (const inv of baseInvestments) {
      if (!currInvTitles.has(inv.title)) {
        result.removed.push({ type: '人的投資', title: `${title} - ${inv.title}` });
      }
    }
  }

  return result;
}

export function DiffViewer({ baseline, current }: DiffViewerProps) {
  const diff = computeDiff(baseline, current);

  const totalChanges = diff.added.length + diff.removed.length + diff.changed.length;

  if (totalChanges === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-600">
        変更なし（STAGE3のベースラインと同じ）
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* サマリー */}
      <div className="flex items-center gap-4 text-sm">
        {diff.added.length > 0 && (
          <span className="flex items-center gap-1.5 text-green-700">
            <PlusCircle className="w-4 h-4" />
            追加: {diff.added.length}件
          </span>
        )}
        {diff.removed.length > 0 && (
          <span className="flex items-center gap-1.5 text-red-700">
            <MinusCircle className="w-4 h-4" />
            削除: {diff.removed.length}件
          </span>
        )}
        {diff.changed.length > 0 && (
          <span className="flex items-center gap-1.5 text-blue-700">
            <Edit3 className="w-4 h-4" />
            変更: {diff.changed.length}件
          </span>
        )}
      </div>

      {/* 詳細リスト */}
      <div className="space-y-2">
        {diff.added.map((item, idx) => (
          <div key={`add-${idx}`} className="flex items-start gap-2 text-sm bg-green-50 p-2 rounded border border-green-200">
            <PlusCircle className="w-4 h-4 text-green-700 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-green-900">[{item.type}]</span>{' '}
              <span className="text-green-800">{item.title}</span>
            </div>
          </div>
        ))}

        {diff.removed.map((item, idx) => (
          <div key={`rem-${idx}`} className="flex items-start gap-2 text-sm bg-red-50 p-2 rounded border border-red-200">
            <MinusCircle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-red-900">[{item.type}]</span>{' '}
              <span className="text-red-800">{item.title}</span>
            </div>
          </div>
        ))}

        {diff.changed.map((item, idx) => (
          <div key={`chg-${idx}`} className="flex items-start gap-2 text-sm bg-blue-50 p-2 rounded border border-blue-200">
            <Edit3 className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-blue-900">[{item.type}]</span>{' '}
              <span className="text-blue-800">{item.title}</span>
              {item.detail && <div className="text-xs text-blue-600 mt-0.5">{item.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
