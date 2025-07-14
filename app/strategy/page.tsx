'use client';

import { useState } from 'react';
import Step1BasicInfo from '@/components/steps/Step1BasicInfo';
import Step2SWOT from '@/components/steps/Step2SWOT';
import Step3FinanceUpload from '@/components/steps/Step3FinanceUpload';
import Step4MVV from '@/components/steps/Step4MVV';
import Step5Confirm from '@/components/steps/Step5Confirm';

export default function StrategyPage() {
  const [step, setStep] = useState(1);
  const totalSteps = 5;

  const goNext = () => {
    if (step < totalSteps) setStep(step + 1);
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
    <div className="max-w-4xl mx-auto p-6 bg-white rounded shadow space-y-6">
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
          disabled={step === totalSteps}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          次へ →
        </button>
      </div>
    </div>
  );
}
