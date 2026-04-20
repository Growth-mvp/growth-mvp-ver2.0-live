'use client';

interface DepartmentListItemProps {
  deptName: string;
  projectCount: number;
}

export function DepartmentListItem({ deptName, projectCount }: DepartmentListItemProps) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] font-semibold text-zinc-900">{deptName}</div>
      <div className="text-[10px] text-zinc-500">{projectCount}件</div>
    </div>
  );
}
