'use client';

import { useState } from 'react';
import Step1BasicInfo from '@/components/steps/Step1BasicInfo';
import Step2SWOT from '@/components/steps/Step2SWOT';
import Step3FinanceUpload from '@/components/steps/Step3FinanceUpload';
import Step4MVV from '@/components/steps/Step4MVV';
import Step5Confirm from '@/components/steps/Step5Confirm';
import StepLayout from '@/components/StepLayout';
import { useStrategyStore } from '@/store/strategyStore';

export default function StrategyPage() {
  const [step, setStep] = useState(1);
  const totalSteps = 5;

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

  const goBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const goNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    }
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
    <StepLayout
      step={step}
      totalSteps={totalSteps}
      title="第1章：この会社は何者か？"
      subtitle="自分たちの原点を明確にする"
    >
      <div className="space-y-6">
        {renderStepContent()}

        {/* ナビゲーションボタン：最終確認以外では表示 */}
        {step < totalSteps && (
          <div className="flex justify-between">
            <button
              onClick={goBack}
              disabled={step === 1}
              className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
            >
              ← 戻る
            </button>
            <button
              onClick={goNext}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
            >
              次へ →
            </button>
          </div>
        )}
      </div>
    </StepLayout>
  );
}
