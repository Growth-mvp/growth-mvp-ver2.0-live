'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import Step1BasicInfo from '@/components/steps/Step1BasicInfo';
import Step2SWOT from '@/components/steps/Step2SWOT';
import Step3Departments from '@/components/steps/Step3Departments';
import Step4Finance from '@/components/steps/Step4Finance';
import Step5MissionVision from '@/components/steps/Step5MissionVision';

export default function StrategyPage() {
  const router = useRouter();
  const {
    mission,
    visionStatement,
    value,
    setMission,
    setVisionStatement,
    setValue,
    setStrategy,
  } = useStrategyStore();

  const [step, setStep] = useState(1);

  const handleNext = () => {
    if (step === 5) {
      // 最終ステップで戦略要約を仮に作成して格納（実際はAI生成へ）
      const summary = `私たちは「${mission}」という使命のもと、「${visionStatement}」を目指します。そのために、「${value}」を価値観として行動します。`;
      setStrategy({ summary });

      // プレビュー画面に遷移
      router.push('/strategy-preview');
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">経営戦略 入力ステップ</h1>

      <div className="mb-8">
        {step === 1 && <Step1BasicInfo />}
        {step === 2 && <Step2SWOT />}
        {step === 3 && <Step3Departments />}
        {step === 4 && <Step4Finance />}
        {step === 5 && <Step5MissionVision />}
      </div>

      <div className="flex justify-between">
        <button
          onClick={handleBack}
          disabled={step === 1}
          className="px-4 py-2 bg-gray-300 text-gray-700 rounded disabled:opacity-50"
        >
          戻る
        </button>
        <button
          onClick={handleNext}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {step === 5 ? '戦略を確認する' : '次へ'}
        </button>
      </div>
    </div>
  );
}
