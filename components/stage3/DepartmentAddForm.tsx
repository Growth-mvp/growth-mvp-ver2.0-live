'use client';

import { Button } from '@/components/ui/button';

interface DepartmentAddFormProps {
  showForm: boolean;
  canEditCompany: boolean;
  isHydrating: boolean;
  deptName: string;
  setDeptName: (value: string) => void;
  deptMission: string;
  setDeptMission: (value: string) => void;
  setShowForm: (value: boolean | ((prev: boolean) => boolean)) => void;
  onAddDepartment: () => Promise<void>;
}

export function DepartmentAddForm({
  showForm,
  canEditCompany,
  isHydrating,
  deptName,
  setDeptName,
  deptMission,
  setDeptMission,
  setShowForm,
  onAddDepartment,
}: DepartmentAddFormProps) {
  if (!showForm || !canEditCompany || isHydrating) {
    return null;
  }

  return (
    <div className="p-6 border rounded-3xl bg-white/70 mb-8">
      <div className="grid md:grid-cols-2 gap-4">
        <input
          value={deptName}
          onChange={(e) => setDeptName(e.target.value)}
          placeholder="部門名（例：営業部、人事部、生産本部など）"
          className="border rounded-xl px-3 py-2 text-sm"
        />
        <input
          value={deptMission}
          onChange={(e) => setDeptMission(e.target.value)}
          placeholder="（任意）ミッションのメモ"
          className="border rounded-xl px-3 py-2 text-sm"
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setShowForm(false)} className="rounded-full h-9 px-4">
          キャンセル
        </Button>
        <Button
          onClick={onAddDepartment}
          className="rounded-full h-9 px-4"
        >
          追加
        </Button>
      </div>
    </div>
  );
}
