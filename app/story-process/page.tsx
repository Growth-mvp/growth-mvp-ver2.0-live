"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStrategyStore } from "@/store/strategyStore";
import { useUserStore } from "@/store/userStore";
import Button from "@/components/ui/button";
import QuestionStepper from "@/components/QuestionStepper";

export default function StoryProcessPage() {
  const router = useRouter();
  const { user } = useUserStore();

  const {
    story,
    answers2,
    setAnswers2,
    industry,
    revenue,
    employees,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    answers,
    setStory,
    setStrategySummary,
    setNotification,
  } = useStrategyStore();

  const [loadingType, setLoadingType] = useState<"questions" | "story" | null>(null);
  const [error, setError] = useState("");

  const storyParts = story?.split("■").filter((s) => s.trim().length > 0) || [];

  const handleGenerateQuestions = async () => {
    if (!story || story.length < 10) {
      setError("⚠️ ストーリーが未生成です");
      return;
    }

    setLoadingType("questions");
    setError("");

    try {
      const res = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story }),
      });

      const data = await res.json();
      if (!res.ok || !data.answers2 || !Array.isArray(data.answers2)) {
        throw new Error(data.error || "質問の生成に失敗しました");
      }

      setAnswers2(data.answers2);
      setNotification("✅ 掘り下げ質問を生成しました");
    } catch (err: any) {
      console.error("❌ 質問生成エラー:", err);
      setError(err.message || "不明なエラーが発生しました");
    } finally {
      setLoadingType(null);
    }
  };

  const handleGenerateFinalStory = async () => {
    if (!user) {
      setError("⚠️ ログインが必要です");
      return;
    }

    setLoadingType("story");
    try {
      const response = await fetch("/api/generate-final-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry,
          revenue,
          employees,
          thought,
          mission,
          vision,
          value,
          strength,
          weakness,
          opportunity,
          threat,
          answers,
          answers2,
        }),
      });

      const result = await response.json();
      if (response.ok && result.story) {
        setStory(result.story);
        setStrategySummary(result.summary);
        setNotification("✅ 最終ストーリーを生成しました");
      } else {
        setError(result.error || "ストーリー生成に失敗しました");
      }
    } catch (err) {
      console.error(err);
      setError("ストーリー生成中にエラーが発生しました");
    } finally {
      setLoadingType(null);
    }
  };

  useEffect(() => {
    if (!user) router.push("/login");
  }, [user]);

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-2xl font-bold text-center mb-6">📖 ストーリー生成プロセス</h1>

      {story && storyParts.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-2">📝 ストーリーたたき台</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {storyParts.map((section, index) => (
              <div key={index} className="p-4 bg-white border rounded shadow-sm">
                <h3 className="text-sm text-gray-500 mb-1">第{index + 1}章</h3>
                <p className="text-gray-800 whitespace-pre-wrap text-sm">{section.trim()}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {story && storyParts.length === 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-2">🎉 最終ストーリー</h2>
          <div className="p-4 bg-white border rounded shadow-sm whitespace-pre-wrap text-gray-800 text-sm">
            {story}
          </div>
        </section>
      )}

      {!story && (
        <p className="text-red-600 text-sm mb-6">※ ストーリーが未生成です。先にたたき台を生成してください。</p>
      )}

      <div className="mb-8">
        <Button onClick={handleGenerateQuestions} disabled={loadingType !== null}>
          {loadingType === "questions" ? "掘り下げ質問を生成中..." : "🔍 掘り下げ質問を生成"}
        </Button>
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </div>

      {Array.isArray(answers2) && answers2.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-3">🧠 掘り下げ質問と回答</h2>
          {answers2.map((chapterAnswer, idx) => (
            <div key={`${chapterAnswer.chapterTitle}-${idx}`} className="mb-12">
              <h3 className="text-gray-600 font-bold mb-4 text-lg border-b pb-1">
                第{idx + 1}章：{chapterAnswer.chapterTitle}
              </h3>
              <QuestionStepper
                chapterTitle={chapterAnswer.chapterTitle}
                questions={chapterAnswer.steps}
                onUpdateAnswer={(qIdx, answer) => {
                  const updated = [...answers2];
                  updated[idx].steps[qIdx].answer = answer;
                  setAnswers2(updated);
                }}
              />
            </div>
          ))}
        </section>
      )}

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-2">🎬 最終ストーリー生成</h2>
        <Button onClick={handleGenerateFinalStory} disabled={loadingType !== null}>
          {loadingType === "story" ? "ストーリーを生成中..." : "ストーリーを完成させる"}
        </Button>
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </section>

      <div className="text-center mt-10">
        <Button onClick={() => router.push("/cascade")} className="bg-blue-600 text-white hover:bg-blue-700">
          👉 戦略カスケードへ進む
        </Button>
      </div>
    </main>
  );
}
