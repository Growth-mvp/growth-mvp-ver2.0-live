'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Step1BasicInfo from '@/components/steps/Step1BasicInfo';
import Step2SWOT from '@/components/steps/Step2SWOT';
import Step3FinanceUpload from '@/components/steps/Step3FinanceUpload';
import Step4MVV from '@/components/steps/Step4MVV';
import Step5Confirm from '@/components/steps/Step5Confirm';
import { useStrategyStore } from '@/store/strategyStore';

export default function StrategyPage() {
  const [step, setStep] = useState(1);
  const totalSteps = 5;
  const router = useRouter();

  const {
    thought,
    vision,
    mission,
    value,
    industry,
    revenue,
    employees,
    strength,
    weakness,
    opportunity,
    threat,
    csvFinanceData,
    setStory,
  } = useStrategyStore();

  const goNext = async () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else if (step === totalSteps) {
      try {
        const res = await fetch('/api/generate-story-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            thought,
            vision,
            mission,
            value,
            industry,
            revenue,
            employees,
            strength,
            weakness,
            opportunity,
            threat,
            csvFinanceData,
          }),
        });

        if (!res.ok) {
          console.error('❌ ストーリーたたき台生成失敗');
          return;
        }

        const data = await res.json();
        if (data.story) {
          setStory(data.story); // ✅ Zustandに保存

          // ✅ 反映待ち後に遷移
          setTimeout(() => {
            router.push('/story-process');
          }, 100);
        } else {
          console.error('⚠️ ストーリーが空です');
        }
      } catch (err) {
        console.error('❌ API呼び出しエラー:', err);
      }
    }
  };

  const goBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return <Step1BasicInfo />;
      case 2:
        return <Step2SWOT />;
      case 3:
        return <Step3FinanceUpload />;
      case 4:
        return <Step4MVV />;
      case 5:
        return <Step5Confirm />;
      default:
        return null;
    }
  };

  return (
    <main className="max-w-4xl mx-auto p-6 bg-white rounded shadow space-y-6">
      <div className="text-center">
        <p className="text-sm text-gray-500">
          STEP {step} / {totalSteps}
        </p>
        <h1 className="text-2xl font-bold text-gray-800">
          {step === totalSteps ? '最終確認' : '経営情報入力'}
        </h1>
      </div>

      {renderStepContent()}

      <div className="flex justify-between mt-6">
        <button
          onClick={goBack}
          disabled={step === 1}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          ← 戻る
        </button>

        <button
          onClick={goNext}
          className={`px-4 py-2 rounded text-white ${
            step === totalSteps
              ? 'bg-indigo-600 hover:bg-indigo-700'
              : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          {step === totalSteps ? '✅ ストーリーを生成 →' : '次へ →'}
        </button>
      </div>
    </main>
  );
}
