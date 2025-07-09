'use client';

import { useStrategyStore } from '@/store/strategyStore';
import EditableProjectCard from '@/components/EditableProjectCard';
import AddProjectForm from '@/components/AddProjectForm';

export default function CascadeEditorPage() {
  const {
    editableCascadeResult,
    updateDepartmentStrategy,
    updateProject,
    addProject,
  } = useStrategyStore();

  return (
    <main className="p-8 space-y-8">
      <h1 className="text-2xl font-bold mb-4">戦略カスケード編集ページ</h1>

      {editableCascadeResult.length === 0 && (
        <p className="text-gray-600">カスケードデータがありません。AI生成後に編集が可能です。</p>
      )}

      {editableCascadeResult.map((dept, deptIndex) => (
        <section
          key={deptIndex}
          className="p-6 border border-gray-300 rounded bg-white shadow space-y-4"
        >
          <h2 className="text-xl font-semibold text-blue-800">{dept.name}</h2>

          <div>
            <label className="text-sm font-medium text-gray-600">部門戦略</label>
            <input
              type="text"
              value={dept.strategy}
              onChange={(e) =>
                updateDepartmentStrategy(dept.name, e.target.value)
              }
              className="w-full mt-1 border border-gray-300 rounded px-3 py-2"
              placeholder="部門の戦略を編集"
            />
          </div>

          <div className="space-y-4">
            {dept.projects.map((proj, projIndex) => (
              <EditableProjectCard
                key={projIndex}
                department={dept.name}
                index={projIndex}
                project={proj}
                updateProject={updateProject}
              />
            ))}
          </div>

          <AddProjectForm deptName={dept.name} onAdd={addProject} />
        </section>
      ))}
    </main>
  );
}
