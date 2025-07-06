"use client";

import { useEffect, useState } from "react";
import { useStrategyStore } from "@/store/strategyStore";

interface Node {
  id: string;
  label: string;
  level: number;
  parentId?: string;
}

export default function CascadePage() {
  const {
    strategy,
    departments,
    thought,
    industry,
    revenue,
    employees,
    revenueRange,
    employeeRange,
    mission,
    visionStatement,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    setStrategy,
    setDepartments,
    saveToSupabase,
    loadLatestFromSupabase,
    deleteAllFromSupabase,
  } = useStrategyStore();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [selected, setSelected] = useState<Node | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ノード生成
  useEffect(() => {
    const generatedNodes: Node[] = [];

    generatedNodes.push({
      id: "strategy",
      label: strategy.summary || "（経営戦略未入力）",
      level: 0,
    });

    departments.forEach((dept, i) => {
      const deptId = `dept-${i}`;
      generatedNodes.push({
        id: deptId,
        label: dept.name || "（部門名未入力）",
        level: 1,
        parentId: "strategy",
      });

      dept.projects?.forEach((proj, j) => {
        const projId = `proj-${i}-${j}`;
        generatedNodes.push({
          id: projId,
          label: proj.name || "（プロジェクト名未入力）",
          level: 2,
          parentId: deptId,
        });

        proj.okrs?.forEach((okr, k) => {
          const okrId = `okr-${i}-${j}-${k}`;
          generatedNodes.push({
            id: okrId,
            label: okr.objective || "（Objective未入力）",
            level: 3,
            parentId: projId,
          });
        });
      });
    });

    setNodes(generatedNodes);
  }, [strategy, departments]);

  const handleClick = (node: Node) => setSelected(node);

  const handleGenerateCascade = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/generate-cascade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vision: visionStatement,
          industry,
          revenue,
          employees,
          strength,
          weakness,
          opportunity,
          threat,
          story: thought,
          departments, // ← 手入力の部門を送る（AIが変えないように）
        }),
      });

      if (!res.ok) throw new Error("生成に失敗しました");

      const data = await res.json();
      setStrategy(data.strategy);
      setDepartments(data.departments);
      await saveToSupabase();
    } catch (err) {
      setError("戦略カスケードの生成に失敗しました。もう一度お試しください。");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">戦略カスケード：ピラミッド表示</h1>
        <button
          onClick={handleGenerateCascade}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
          disabled={loading}
        >
          {loading ? "生成中…" : "AIで生成する"}
        </button>
      </div>

      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

      <div className="flex flex-col items-center space-y-6">
        {[0, 1, 2, 3].map((level) => (
          <div key={level} className="flex flex-wrap justify-center gap-4">
            {nodes
              .filter((n) => n.level === level)
              .map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleClick(node)}
                  className="bg-blue-100 hover:bg-blue-200 rounded-xl px-4 py-2 shadow text-sm"
                >
                  {node.label || "(未入力)"}
                </button>
              ))}
          </div>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[90%] max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-2">詳細</h2>
            <p className="text-sm text-gray-700 whitespace-pre-line">{selected.label}</p>
            <button
              onClick={() => setSelected(null)}
              className="mt-4 text-blue-600 text-sm underline"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
