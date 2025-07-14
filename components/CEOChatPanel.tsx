"use client";

import { useState } from "react";
import { useStrategyStore } from "@/store/strategyStore";
import { Department, Project } from "@/types/strategy";


export default function CEOChatPanel() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const {
    vision,
    industry,
    revenue,
    employees,
    mission,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    editableCascadeResult
  } = useStrategyStore();

  const departmentInfo = (editableCascadeResult || []).map((dept: Department) => {
    const projectTitles = (dept.projects || []).map((proj: Project) => `  - ${proj.title}`).join("\n");
    return `● ${dept.name}: ${dept.goal}\n${projectTitles}`;
  }).join("\n\n");

  const context = `【経営戦略情報】
- 経営者の思い: ${vision}
- 業種: ${industry}
- 売上: ${revenue}
- 社員数: ${employees}
- SWOT:
  S: ${strength}
  W: ${weakness}
  O: ${opportunity}
  T: ${threat}
- ミッション: ${mission}
- ビジョン: ${vision}
- バリュー: ${value}

【部門戦略とプロジェクト】
${departmentInfo}
  `;

  const handleSend = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setMessages((prev) => [...prev, `あなた：${input}`]);
    setError("");

    try {
      const res = await fetch("/api/ask-ceo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input, context })
      });
      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, `CEO：${data.reply}`]);
      } else {
        setError("CEOからの回答が取得できませんでした。");
      }
    } catch (e) {
      setError("通信エラーが発生しました。");
    }
    setInput("");
    setLoading(false);
  };

  return (
    <div className="w-full h-screen flex flex-col border-l border-gray-300 shadow-inner bg-white">
      {/* ヘッダー */}
      <div className="p-4 border-b font-semibold text-lg bg-gradient-to-r from-blue-100 to-blue-50 text-gray-800">
        経営者AIチャット
      </div>

      {/* メッセージ一覧 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm bg-gray-50">
        {messages.map((msg, i) => (
          <div key={i} className="bg-white shadow p-3 rounded whitespace-pre-wrap border border-gray-200">
            {msg}
          </div>
        ))}
        {loading && <div className="text-blue-600">CEOが考え中...</div>}
        {error && <div className="text-red-500">{error}</div>}
      </div>

      {/* 入力欄 */}
      <div className="p-3 border-t flex gap-2 bg-white">
        <input
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="経営の方向性や整合性について質問してください"
        />
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
          onClick={handleSend}
          disabled={loading}
        >
          送信
        </button>
      </div>
    </div>
  );
}
