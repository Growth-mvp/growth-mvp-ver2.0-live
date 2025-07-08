'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '../../store/strategyStore';

interface OKR {
  objective: string;
  keyResults: string[];
}

interface Project {
  name: string;
  description?: string;
  okrs: OKR[];
}

interface Department {
  name: string;
  strategy?: string;
  projects: Project[];
}

interface CascadeResult {
  strategy: {
    summary: string;
  };
  departments: Department[];
}

interface Node {
  id: string;
  label: string;
  level: number;
  parent?: string;
}

export default function CascadePage() {
  const { cascadeResult } = useStrategyStore();
  const [generatedNodes, setGeneratedNodes] = useState<Node[]>([]);

  useEffect(() => {
    const nodes: Node[] = [];

    if (cascadeResult) {
      const strategy = cascadeResult.strategy;

      // 経営戦略ノード
      nodes.push({
        id: 'strategy',
        label: strategy?.summary || '（経営戦略未入力）',
        level: 0,
      });

      cascadeResult.departments?.forEach((dept: Department, i: number) => {
        const deptId = `dept-${i}`;
        nodes.push({
          id: deptId,
          label: dept.name || `部門 ${i + 1}`,
          level: 1,
          parent: 'strategy',
        });

        dept.projects?.forEach((proj: Project, j: number) => {
          const projId = `proj-${i}-${j}`;
          nodes.push({
            id: projId,
            label: proj.name || `プロジェクト ${j + 1}`,
            level: 2,
            parent: deptId,
          });

          proj.okrs?.forEach((okr: OKR, k: number) => {
            const okrId = `okr-${i}-${j}-${k}`;
            nodes.push({
              id: okrId,
              label: okr.objective || `Objective ${k + 1}`,
              level: 3,
              parent: projId,
            });
          });
        });
      });

      setGeneratedNodes(nodes);
    }
  }, [cascadeResult]);

  const getIndentStyle = (level: number) => {
    return `pl-${level * 4}`;
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">カスケード構造の表示</h1>
      {generatedNodes.length === 0 ? (
        <p className="text-gray-500">カスケードデータがまだ生成されていません。</p>
      ) : (
        <ul className="space-y-2">
          {generatedNodes.map((node) => (
            <li key={node.id} className={`text-sm ${getIndentStyle(node.level)}`}>
              ▸ {node.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
