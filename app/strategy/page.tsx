// ✅ app/strategy/page.tsx — 経営情報入力の親コンポーネント

"use client";

import { useState } from "react";
import Step1BasicInfo from "@/components/steps/Step1BasicInfo";
import Step2SWOT from "@/components/steps/Step2SWOT";
import Step3Department from "@/components/steps/Step3Departments";
import Step4Finance from "@/components/steps/Step4Financials";
import Step5MissionVision from "@/components/steps/Step5MissionVision";

export default function StrategyPage() {
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);

  const handleNext = () => {
    setErrors([]); // エラークリア
    setStep((prev) => Math.min(prev + 1, 5));
  };

  const handleBack = () => {
    setErrors([]); // エラークリア
    setStep((prev) => Math.max(prev - 1, 1));
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-6">経営情報の入力（ステップ {step} / 5）</h1>

      {step === 1 && <Step1BasicInfo />}
      {step === 2 && <Step2SWOT />}
      {step === 3 && <Step3Department />}
      {step === 4 && <Step4Finance />}
      {step === 5 && <Step5MissionVision />}

      <div className="mt-6 flex justify-between">
        <button
          onClick={handleBack}
          disabled={step === 1}
          className="px-4 py-2 bg-gray-200 text-sm rounded disabled:opacity-50"
        >
          戻る
        </button>

        {step < 5 && (
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded"
          >
            次へ
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mt-4 text-red-600 text-sm">
          {errors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}
