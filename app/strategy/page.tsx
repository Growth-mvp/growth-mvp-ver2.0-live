'use client';

import { useState } from 'react';
import Step1BasicInfo from '../../components/steps/Step1BasicInfo';
import Step2SWOT from '../../components/steps/Step2SWOT';
import Step3FinanceUpload from '../../components/steps/Step3FinanceUpload';
import Step4MVV from '../../components/steps/Step4MVV';
import { useRouter } from 'next/navigation';

export default function StrategyInputPage() {
  const [step, setStep] = useState(1);
  const router = useRouter();

  const handleNext = () => {
    if (step < 4) {
      setStep(step + 1);
    } else {
      router.push('/story'); // STEP4の次は戦略ストーリーへ
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">経営情報入力</h1>

      {/* ステップごとの表示 */}
      <div className="mb-8">
        {step === 1 && <Step1BasicInfo />}
        {step === 2 && <Step2SWOT />}
        {step === 3 && <Step3FinanceUpload />}
        {step === 4 && <Step4MVV />}
      </div>

      {/* ナビゲーションボタン */}
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
          {step < 4 ? '次へ' : '戦略ストーリーへ'}
        </button>
      </div>
    </main>
  );
}
