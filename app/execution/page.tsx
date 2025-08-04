'use client';

import { useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import ProjectCard from '@/components/execution/ProjectCard';
import OKRModal from '@/components/execution/OKRModal';
import { Department } from '@/types/strategy';

interface SelectedOKR {
  department: Department;
  projectIndex: number;
  okrIndex: number;
}

export default function ExecutionPage() {
  const { editableCascadeResult } = useStrategyStore();
  const [selected, setSelected] = useState<SelectedOKR | null>(null);

  return (
    <main className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-6">📊 OKR実行支援</h1>

      {/* 横並びピラミッド構造 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {editableCascadeResult.map((dept, deptIndex) =>
          dept.projects?.map((proj, projIndex) =>
            proj.okrs?.map((okr, okrIndex) => (
              <ProjectCard
                key={`${dept.name}-${proj.title}-${okrIndex}`}
                deptName={dept.name}
                project={proj}
                onClick={() =>
                  setSelected({
                    department: dept,
                    projectIndex: projIndex,
                    okrIndex,
                  })
                }
              />
            ))
          )
        )}
      </div>

      {/* モーダル展開 */}
      {selected && (
        <OKRModal
          department={selected.department}
          projectIndex={selected.projectIndex}
          okrIndex={selected.okrIndex}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
