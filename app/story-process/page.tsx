"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase';
import Button from '@/components/ui/button';
import QuestionStepper from '@/components/guide/QuestionStepper';
import { AnswerStep } from '@/types/strategy';

export default function StoryProcessPage() {
  const router = useRouter();
  const { user } = useUserStore();
  const {
    story,
    finalStory,
    setFinalStory,
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

  const [loadingType, setLoadingType] = useState<"story" | "question" | null>(null);
  const [error, setError] = useState('');
  const [visibleChapters, setVisibleChapters] = useState(1);

  const storyChapters = Array.isArray(story)
    ? story.slice(0, 4)
    : typeof story === 'string'
    ? story
        .split("■")
        .filter((s) => s.trim() !== "")
        .slice(0, 4)
        .map((section) => {
          const [titleLine, ...bodyLines] = section.trim().split('\n');
          return {
            title: titleLine?.trim() || '無題',
            body: bodyLines.join('\n').trim(),
          };
        })
    : [];

  useEffect(() => {
    if (!user) router.push("/login");
  }, [user]);

  const generateInitialQuestions = async () => {
    if (!storyChapters.length) return;
    setLoadingType("question");

    const newAnswers = [...answers2];

    for (let i = 0; i < storyChapters.length; i++) {
      if (newAnswers[i]?.steps?.length > 0) continue;

      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterIndex: i,
          chapterTitle: storyChapters[i].title,
          chapterBody: storyChapters[i].body,
          stepNumber: 1,
          previousAnswer: "",
        }),
      });

      const result = await res.json();

      if (res.ok && result.step) {
        newAnswers[i] = {
          chapterIndex: i,
          chapterTitle: storyChapters[i].title,
          steps: [result.step as AnswerStep],
        };
      } else {
        console.error("質問生成エラー:", result?.error);
        newAnswers[i] = {
          chapterIndex: i,
          chapterTitle: storyChapters[i].title,
          steps: [],
        };
      }
    }

    setAnswers2(newAnswers);
    setLoadingType(null);
  };

  const handleGenerateFinalStory = async () => {
    if (!user?.id) {
      setError("⚠️ ログインが必要です");
      return;
    }

    setLoadingType("story");
    setError("");

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
      if (!response.ok || !result.story) {
        throw new Error(result.error || "ストーリー生成に失敗しました");
      }

      const parsedStory = typeof result.story === 'string'
        ? result.story
            .split("■")
            .filter((s: string) => s.trim() !== "")
            .slice(0, 4)
            .map((section: string) => {
              const [titleLine, ...bodyLines] = section.trim().split('\n');
              return {
                title: titleLine?.trim() || '無題',
                body: bodyLines.join('\n').trim(),
              };
            })
        : result.story.slice(0, 4);

      setStory(parsedStory);
      setFinalStory(parsedStory);
      setStrategySummary(result.summary);
      setNotification("✅ 最終ストーリーを生成しました");

      const { error: saveError } = await saveStrategyData(useStrategyStore.getState(), user.id);
      if (saveError) {
        console.error("❌ Supabase保存エラー:", saveError);
        setNotification("⚠️ ストーリー保存に失敗しました");
      } else {
        setNotification("💾 最終ストーリーを保存しました");
      }
    } catch (err: any) {
      console.error(err);
      setError("ストーリー生成中にエラーが発生しました");
    } finally {
      setLoadingType(null);
    }
  };

  const handleAnswerUpdate = async (chapterIdx: number, stepIdx: number, answer: string) => {
    const updated = [...answers2];
    if (!updated[chapterIdx]) {
      console.error(`❌ chapterIdx ${chapterIdx} が存在しません`);
      return;
    }
    if (!updated[chapterIdx].steps[stepIdx]) {
      console.error(`❌ stepIdx ${stepIdx} が chapter ${chapterIdx} に存在しません`);
      return;
    }
    updated[chapterIdx].steps[stepIdx].answer = answer;
    setAnswers2(updated);

    if (!user?.id) return;

    const { error: saveError } = await saveStrategyData(
      { ...useStrategyStore.getState(), answers2: updated },
      user.id
    );
    if (saveError) console.error("❌ 自動保存エラー:", saveError);
  };

  const handleChapterComplete = (chapterIdx: number) => {
    if (chapterIdx + 1 >= visibleChapters) {
      setVisibleChapters((prev) => prev + 1);
    }
  };

  return (
    <main className="p-6 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <h1 className="text-2xl font-bold text-center mb-6">📖 ストーリー生成プロセス</h1>

      {storyChapters.length > 0 ? (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-2">✍️ ストーリーたたき台</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {storyChapters.map((chapter, index) => (
              <div key={index} className="p-4 bg-white border rounded shadow-sm">
                <h3 className="text-sm text-gray-500 mb-1">{chapter.title}</h3>
                <p className="text-gray-800 whitespace-pre-wrap text-sm">{chapter.body}</p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-red-600 text-sm mb-6">
          ※ ストーリーが未生成です。先にたたき台を生成してください。
        </p>
      )}

      {answers2.length === 0 && (
        <div className="text-center mb-12">
          <Button onClick={generateInitialQuestions} disabled={loadingType === "question"}>
            {loadingType === "question" ? "質問生成中..." : "💬 質問を生成する"}
          </Button>
        </div>
      )}

      {answers2.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-3">🧠 掘り下げ質問と回答</h2>
          {answers2.slice(0, visibleChapters).map((chapterAnswer, idx) => (
            <div key={`chapter-${idx}`} className="mb-12">
              <h3 className="text-gray-600 font-bold mb-4 text-lg border-b pb-1">
                {chapterAnswer.chapterTitle}
              </h3>
              <QuestionStepper
                chapterIndex={chapterAnswer.chapterIndex ?? idx}
                chapterTitle={chapterAnswer.chapterTitle}
                chapterBody={storyChapters?.[idx]?.body ?? ''}
                questions={chapterAnswer.steps}
                onUpdateAnswer={handleAnswerUpdate}
                onComplete={() => handleChapterComplete(idx)}
              />
            </div>
          ))}
        </section>
      )}

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-2">🎮 最終ストーリー生成</h2>
        <Button onClick={handleGenerateFinalStory} disabled={loadingType !== null}>
          {loadingType === "story" ? "ストーリーを生成中..." : "ストーリーを完成させる"}
        </Button>
        {error && <p className="text-red-600 mt-2">{error}</p>}
      </section>

      {finalStory.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-3 text-green-700">✅ 最終ストーリー</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {finalStory.map((chapter, idx) => (
              <div
                key={`final-${idx}`}
                className="p-4 bg-green-50 border border-green-200 rounded shadow-sm"
              >
                <h3 className="text-sm text-green-600 mb-1">{chapter.title}</h3>
                <p className="text-gray-800 whitespace-pre-wrap text-sm">{chapter.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="text-center mt-10">
        <Button
          onClick={() => router.push("/cascade")}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          👉 戦略カスケードへ進む
        </Button>
      </div>
    </main>
  );
}