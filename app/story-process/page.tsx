"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { saveStrategyData } from '@/utils/supabase';
import Button from '@/components/ui/button';
import QuestionStepper from '@/components/guide/QuestionStepper';
import { AnswerStep, StrategyData, ChapterStory } from '@/types/strategy';

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
    companyName,
    foundationYear,
    location,
    businessContent,
    customerSegment,
    csvFinanceData,
    strategySummary,
    editableCascadeResult,
    notification,
    role,
  } = useStrategyStore();

  const [loadingType, setLoadingType] = useState<"story" | "question" | null>(null);
  const [error, setError] = useState('');
  const [visibleChapters, setVisibleChapters] = useState(0);
  const [initialGenerated, setInitialGenerated] = useState(false);

  let storyChapters: ChapterStory[] = [];
  try {
    if (typeof story === 'string') {
      const parsed = JSON.parse(story);
      if (Array.isArray(parsed) && parsed[0]?.title && parsed[0]?.body) {
        storyChapters = parsed.slice(0, 4);
      } else {
        storyChapters = story
          .split("\u25a0")
          .filter((s) => s.trim() !== '')
          .slice(0, 4)
          .map((section, i) => {
            const [titleLine, ...bodyLines] = section.trim().split('\n');
            return {
              title: titleLine?.trim() || `第${i + 1}章`,
              body: bodyLines.join('\n').trim(),
            };
          });
      }
    } else if (Array.isArray(story)) {
      storyChapters = story.slice(0, 4);
    }
  } catch (e) {
    console.error("❌ ストーリーパースエラー:", e);
  }

  useEffect(() => {
    if (!user) router.push("/login");
  }, [user]);

  useEffect(() => {
    if (!initialGenerated && storyChapters.length > 0 && answers2.length === 0) {
      generateInitialQuestions();
    }
  }, [storyChapters, answers2]);

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
        console.error("❌ 質問生成エラー:", result?.error);
        newAnswers[i] = {
          chapterIndex: i,
          chapterTitle: storyChapters[i].title,
          steps: [],
        };
      }
    }

    setAnswers2(newAnswers);
    setVisibleChapters(1);
    setInitialGenerated(true);
    setLoadingType(null);
  };

  const handleAnswerUpdate = async (chapterIdx: number, stepIdx: number, answer: string) => {
    const updated = [...answers2];

    if (!updated[chapterIdx]) {
      updated[chapterIdx] = {
        chapterIndex: chapterIdx,
        chapterTitle: storyChapters[chapterIdx]?.title || '',
        steps: [],
      };
    }

    if (!updated[chapterIdx].steps[stepIdx]) {
      updated[chapterIdx].steps[stepIdx] = {
        stepNumber: stepIdx + 1,
        question: '',
        reason: '',
        answer: '',
      };
    }

    updated[chapterIdx].steps[stepIdx].answer = answer;
    setAnswers2(updated);

    if (!user?.id) return;

    const dataToSave: StrategyData = {
      story,
      finalStory,
      answers2: updated,
      answers,
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
      companyName,
      foundationYear,
      location,
      businessContent,
      customerSegment,
      csvFinanceData,
      strategySummary,
      editableCascadeResult,
      notification: '',
      role: role as 'admin' | 'manager' | 'member',
      questions: [],
      reasons: [],
      questions2: [],
      reasons2: [],
    };

    await saveStrategyData(dataToSave, user.id);
  };

  const handleChapterComplete = (chapterIndex: number) => {
    setVisibleChapters((prev) => Math.max(prev, chapterIndex + 2));
  };

  const handleGenerateFinalStory = async () => {
    setLoadingType("story");
    setError("");

    try {
      const res = await fetch("/api/generate-story-draft", {
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
          csvFinanceData,
        }),
      });

      const data = await res.json();
      console.log("✅ API呼び出し成功: /api/generate-story-draft");
      console.log("📦 APIから受け取ったdata:", data);

      if (res.ok && Array.isArray(data?.story)) {
        console.log("✅ 最終ストーリー構造チェックOK、セット処理へ進行");
        setFinalStory(data.story);
        setStrategySummary("（要約が未返却）");
        setNotification("✅ 最終ストーリーを生成しました");
      } else {
        console.error("❌ レスポンス内容に異常:", data);
        setError(data?.error || "ストーリー生成に失敗しました");
      }
    } catch (err) {
      console.error("❌ ストーリー生成中の例外発生:", err);
      setError("通信エラーが発生しました");
    } finally {
      setLoadingType(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">戦略ストーリー生成プロセス</h1>

      <section className="mb-6">
        <h2 className="text-xl font-semibold text-indigo-700 mb-2">📝 たたき台ストーリー</h2>
        {storyChapters.map((chapter, idx) => (
          <div key={idx} className="mb-4 p-4 bg-gray-50 border rounded">
            <h3 className="font-semibold text-gray-700 mb-1">{chapter.title}</h3>
            <p className="text-gray-800 whitespace-pre-line">{chapter.body}</p>
          </div>
        ))}
      </section>

      {!initialGenerated && (
        <div className="mb-8 text-center">
          <Button onClick={generateInitialQuestions} disabled={!!loadingType}>
            {loadingType === "question" ? "生成中..." : "🧠 質問を生成する"}
          </Button>
        </div>
      )}

      <section className="space-y-6">
        {storyChapters.map((chapter, chapterIdx) => {
          const steps = answers2.find((a) => a.chapterIndex === chapterIdx)?.steps || [];

          return (
            <div key={chapterIdx}>
              {chapterIdx < visibleChapters && (
                <QuestionStepper
                  questions={steps}
                  chapterTitle={chapter.title}
                  chapterBody={chapter.body}
                  chapterIndex={chapterIdx}
                  onUpdateAnswer={handleAnswerUpdate}
                  onComplete={() => handleChapterComplete(chapterIdx)}
                />
              )}
            </div>
          );
        })}
      </section>

      {visibleChapters >= storyChapters.length && (
        <div className="mt-8 text-center">
          <Button onClick={handleGenerateFinalStory} disabled={!!loadingType}>
            {loadingType === "story" ? "生成中..." : "🎉 最終ストーリーを生成する"}
          </Button>
        </div>
      )}

      {/* ✅ 最終ストーリー表示ブロック */}
      {finalStory && Array.isArray(finalStory) && finalStory.length > 0 && (
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-green-700 mb-2">✅ 最終ストーリー</h2>
          {finalStory.map((chapter, idx) => (
            <div key={idx} className="mb-4 p-4 bg-green-50 border border-green-200 rounded">
              <h3 className="font-semibold text-green-700 mb-1">{chapter.title}</h3>
              <p className="text-gray-800 whitespace-pre-line">{chapter.body}</p>
            </div>
          ))}
        </section>
      )}

      {error && <p className="text-red-500 text-sm mt-4">⚠️ {error}</p>}
    </div>
  );
}
