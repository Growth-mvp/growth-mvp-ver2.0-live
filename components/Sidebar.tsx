"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStrategyStore } from "@/store/strategyStore";

const navItems = [
  { label: "経営情報入力", path: "/strategy" },
  { label: "戦略ストーリー", path: "/story" },
  { label: "戦略カスケード表示", path: "/cascade" }
];

export default function Sidebar() {
  const pathname = usePathname();
  const { saveToSupabase, loadLatestFromSupabase, deleteAllFromSupabase } = useStrategyStore();

  return (
    <div className="w-64 bg-gray-900 text-white min-h-screen fixed flex flex-col justify-between">
      <div>
        <div className="p-6 text-xl font-bold border-b border-gray-700">GROWTH</div>
        <nav className="mt-6 flex flex-col gap-2 px-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={`px-4 py-2 rounded hover:bg-gray-700 transition ${
                pathname === item.path ? "bg-gray-700" : ""
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* ✅ Supabase操作ボタン：サイドバー下部に追加 */}
      <div className="px-4 py-6 space-y-2 border-t border-gray-700">
        <button
          onClick={saveToSupabase}
          className="w-full bg-green-600 hover:bg-green-700 text-white text-sm py-2 rounded"
        >
          💾 保存
        </button>
        <button
          onClick={loadLatestFromSupabase}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 rounded"
        >
          🔄 復元
        </button>
        <button
          onClick={deleteAllFromSupabase}
          className="w-full bg-red-600 hover:bg-red-700 text-white text-sm py-2 rounded"
        >
          🗑 全削除
        </button>
      </div>
    </div>
  );
}
