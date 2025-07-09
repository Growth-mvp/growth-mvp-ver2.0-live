'use client';

import { Project } from '@/store/strategyStore';

interface EditableProjectCardProps {
  department: string;
  index: number;
  project: Project;
  updateProject: (deptName: string, projIndex: number, newProject: Project) => void;
}

export default function EditableProjectCard({
  department,
  index,
  project,
  updateProject,
}: EditableProjectCardProps) {
  const handleObjectiveChange = (okrIndex: number, value: string) => {
    const updatedOKRs = [...project.okrs];
    updatedOKRs[okrIndex].objective = value;
    updateProject(department, index, { ...project, okrs: updatedOKRs });
  };

  const handleKeyResultChange = (okrIndex: number, krIndex: number, value: string) => {
    const updatedOKRs = [...project.okrs];
    const updatedKRs = [...updatedOKRs[okrIndex].keyResults];
    updatedKRs[krIndex] = value;
    updatedOKRs[okrIndex].keyResults = updatedKRs;
    updateProject(department, index, { ...project, okrs: updatedOKRs });
  };

  const handleProjectNameChange = (value: string) => {
    updateProject(department, index, { ...project, name: value });
  };

  return (
    <div className="border border-gray-300 p-4 rounded bg-gray-50 shadow-inner mb-4">
      <input
        type="text"
        value={project.name}
        onChange={(e) => handleProjectNameChange(e.target.value)}
        className="font-semibold text-base border-b border-gray-400 mb-3 w-full px-2 py-1"
        placeholder="プロジェクト名を入力"
      />

      {project.okrs.map((okr, okrIndex) => (
        <div key={okrIndex} className="mb-4 pl-2">
          <label className="text-sm font-medium text-gray-600">Objective {okrIndex + 1}</label>
          <input
            type="text"
            value={okr.objective}
            onChange={(e) => handleObjectiveChange(okrIndex, e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 mb-2 mt-1"
            placeholder="目的を入力"
          />

          <label className="text-sm font-medium text-gray-600 ml-1">Key Results</label>
          {okr.keyResults.map((kr, krIndex) => (
            <input
              key={krIndex}
              type="text"
              value={kr}
              onChange={(e) => handleKeyResultChange(okrIndex, krIndex, e.target.value)}
              className="w-full ml-4 border border-gray-300 rounded px-2 py-1 mb-1"
              placeholder={`KR${krIndex + 1}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
