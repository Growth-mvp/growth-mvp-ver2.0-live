// /components/execution/ProjectCard.tsx
'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Project } from '@/types/strategy';
import { motion } from 'framer-motion';

interface Props {
  deptName: string;
  project: Project;
  onClick: () => void;
  /** ページ側から幅を上書きしたいときに使う（任意） */
  className?: string;
}

export default function ProjectCard({
  deptName,
  project,
  onClick,
  className = '',
}: Props) {
  // 1) 従来OKR（最優先）
  const okr = Array.isArray(project?.okrs) ? project.okrs[0] : undefined;

  // 2) 構造化KR（okrsV2）からプレビュー合成（従来OKRが無い場合に使用）
  const okrsV2: any[] = Array.isArray((project as any)?.okrsV2) ? ((project as any).okrsV2 as any[]) : [];
  const v2Labels = okrsV2.map(k => (k?.label ? String(k.label) : '')).filter(Boolean);
  const synthesizedObjective = okr
    ? undefined
    : (v2Labels.length > 0 ? `構造化KR ${v2Labels.length}件（自動）` : undefined);

  // 表示内容を決定
  const displayObjective =
    okr?.objective?.trim() ||
    synthesizedObjective ||
    '未設定のObjective';

  const displayKRs: string[] = okr?.keyResults && Array.isArray(okr.keyResults)
    ? okr.keyResults.map(k => (typeof k === 'string' ? k : String(k)))
    : v2Labels;

  // 長すぎるときは3件まで + 残数表示
  const MAX_KR = 3;
  const krHead = displayKRs.slice(0, MAX_KR);
  const krRest = Math.max(0, displayKRs.length - krHead.length);

  // 所有者（従来OKRにある場合のみ表示）
  const owner = okr?.owner && String(okr.owner);

  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      className={`cursor-pointer ${className}`}
      onClick={onClick}
      role="button"
      aria-label={`${deptName} ${project.title}`}
    >
      {/* 横いっぱいに広げるため w-full / max-w-none を明示 */}
      <Card className="w-full max-w-none p-4 shadow-xl border border-blue-200 bg-white hover:shadow-2xl transition-all rounded-2xl">
        <h2 className="text-md text-blue-800 font-semibold mb-2">{deptName}</h2>
        <h3 className="text-xl font-bold text-gray-800">{project.title}</h3>

        <div className="mt-2">
          <p className="text-sm text-gray-600 line-clamp-2">
            {displayObjective}
          </p>

          {krHead.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-gray-500 text-sm space-y-1">
              {krHead.map((kr, i) => (
                <li key={i}>{kr}</li>
              ))}
              {krRest > 0 && (
                <li className="text-gray-400">+{krRest}件</li>
              )}
            </ul>
          )}
        </div>

        {/* 従来OKRのownerのみ表示（構造化のみの場合は省略） */}
        {owner && (
          <Badge className="mt-4" variant="default">
            {owner}
          </Badge>
        )}
      </Card>
    </motion.div>
  );
}
