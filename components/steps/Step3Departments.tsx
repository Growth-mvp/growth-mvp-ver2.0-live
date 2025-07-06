"use client";

import { useStrategyStore } from "@/store/strategyStore";

export default function Step3Departments() {
  const { departments, setDepartments } = useStrategyStore();

  const handleChange = (index: number, value: string) => {
    const updated = [...departments];
    updated[index] = {
      ...updated[index],
      name: value,
      // 他のプロパティは変更しない
    };
    setDepartments(updated);
  };

  const handleAdd = () => {
    if (departments.length < 10) {
      // 正しい Department 型（projects のみ）
      setDepartments([...departments, { name: "", projects: [] }]);
    }
  };

  const handleRemove = (index: number) => {
    if (departments.length > 1) {
      const updated = departments.filter((_, i) => i !== index);
      setDepartments(updated);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 mb-2">
        戦略カスケードのために、社内の主な部門を最大10個まで入力してください。
      </p>
      {departments.map((dept, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="text"
            value={dept.name}
            onChange={(e) => handleChange(index, e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder={`部門名 ${index + 1}（例：営業部、製造部）`}
          />
          {departments.length > 1 && (
            <button
              type="button"
              onClick={() => handleRemove(index)}
              className="text-red-500 text-xs"
            >
              削除
            </button>
          )}
        </div>
      ))}
      {departments.length < 10 && (
        <button
          type="button"
          onClick={handleAdd}
          className="text-blue-600 text-sm mt-2 underline"
        >
          ＋ 部門を追加
        </button>
      )}
    </div>
  );
}
