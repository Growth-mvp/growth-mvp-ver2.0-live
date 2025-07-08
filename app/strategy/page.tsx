// ✅ /app/strategy/page.tsx
'use client';

import { useState } from 'react';
import Step1BasicInfo from '../../components/steps/Step1BasicInfo';
import Step2SWOT from '../../components/steps/Step2SWOT';
import Step3FinanceUpload from '../../components/steps/Step3FinanceUpload';
import Step4MVV from '../../components/steps/Step4MVV';

export default function StrategyPage() {
  const [step, setStep] = useState(1);

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">経営情報の入力</h1>

      {step === 1 && <Step1BasicInfo />}
      {step === 2 && <Step2SWOT />}
      {step === 3 && <Step3FinanceUpload />}
      {step === 4 && <Step4MVV />}

      <div className="mt-6 flex justify-between">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          className="px-4 py-2 bg-gray-200 rounded"
          disabled={step === 1}
        >
          戻る
        </button>
        <span>Step {step} / 4</span>
        <button
          onClick={() => setStep((s) => Math.min(4, s + 1))}
          className="px-4 py-2 bg-blue-600 text-white rounded"
          disabled={step === 4}
        >
          次へ
        </button>
      </div>
    </main>
  );
}
