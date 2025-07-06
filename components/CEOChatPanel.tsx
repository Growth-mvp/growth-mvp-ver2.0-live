// components/CEOChatPanel.tsx
"use client";

import { useState } from "react";
import { useStrategyStore } from "@/store/strategyStore";

export default function CEOChatPanel() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const {
    vision,
    industry,
    revenueRange,
    employeeRange,
    mission,
    visionStatement,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    departments
  } = useStrategyStore();

  const departmentInfo = (departments || []).map((dept) => {
    const projectTitles = (dept.projects || []).map((proj) => `    - ${proj.title}`).join("\n");
    return `● ${dept.name}: ${dept.goal}\n${projectTitles}`;
  }).join("\n\n");

  const context = `
【経営戦略情報】
- 経営者の思い: ${vision}
- 業種: ${industry}
- 売上規模: ${revenueRange}
- 社員数: ${employeeRange}
- SWOT:
  S: ${strength}
  W: ${weakness}
  O: ${opportunity}
  T: ${threat}
- ミッション: ${mission}
- ビジョン: ${visionStatement}
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
    <div className="w-full h-screen flex flex-col">
      <div className="p-4 border-b font-bold text-lg bg-gray-100">経営者AIチャット</div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm">
        {messages.map((msg, i) => (
          <div key={i} className="whitespace-pre-wrap">{msg}</div>
        ))}
        {loading && <div>CEOが考え中...</div>}
        {error && <div className="text-red-500">{error}</div>}
      </div>
      <div className="p-3 border-t flex gap-2">
        <input
          className="flex-1 border p-2 rounded text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="経営の方向性や整合性について質問してください"
        />
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded text-sm"
          onClick={handleSend}
          disabled={loading}
        >
          送信
        </button>
      </div>
    </div>
  );
}
