'use client';

import { ensureArray } from '@/app/okr/_lib/okrModels';

interface ProjectListHeaderProps {
  departments: any[];
}

export function ProjectListHeader({ departments }: ProjectListHeaderProps) {
  const totalProjects = (Array.isArray(departments) ? departments : []).reduce(
    (n, d) => n + ensureArray(d.projects).length,
    0
  );

  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="text-[13px] font-semibold text-zinc-900">プロジェクト一覧</div>
      <div className="text-[11px] text-zinc-500">{totalProjects}件</div>
    </div>
  );
}
