'use client';

import { useEffect, useState } from 'react';
import Step1BasicInfo from '@/components/steps/Step1BasicInfo';
import Step2SWOT from '@/components/steps/Step2SWOT';
import Step3FinanceUpload from '@/components/steps/Step3FinanceUpload';
import Step4MVV from '@/components/steps/Step4MVV';
import Step5Confirm from '@/components/steps/Step5Confirm';
import StepLayout from '@/components/StepLayout';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { loadStrategyData } from '@/utils/supabase';

export default function StrategyPage() {
  const [step, setStep] = useState(1);
  const totalSteps = 5;

  const { user } = useUserStore();
  const {
    strategyId,
    setStrategyId,
    setCompanyName,
    setFoundationYear,
    setLocation,
    setIndustry,
    setRevenue,
    setEmployees,
    setBusinessContent,
    setCustomerSegment,
    setThought,
    setStrength,
    setWeakness,
    setOpportunity,
    setThreat,
    setRole,
    setMission,
    setVision,
    setValue,
    setStrategySummary,
    setStory,
    setFinalStory,
    setAnswers,
    setAnswers2,
    setEditableCascadeResult,
    setCsvFinanceData,
  } = useStrategyStore();

  useEffect(() => {
    const load = async () => {
      if (!user?.id) return;
      const { data, error } = await loadStrategyData(user.id);
      if (error || !data) return;

      // ✅ Zustandストアに反映
      setStrategyId(data.id);
      setCompanyName(data.companyName);
      setFoundationYear(data.foundationYear);
      setLocation(data.location);
      setIndustry(data.industry);
      setRevenue(data.revenue);
      setEmployees(data.employees);
      setBusinessContent(data.businessContent);
      setCustomerSegment(data.customerSegment);
      setThought(data.thought);
      setStrength(data.strength);
      setWeakness(data.weakness);
      setOpportunity(data.opportunity);
      setThreat(data.threat);
      setRole(data.role);
      setMission(data.mission);
      setVision(data.vision);
      setValue(data.value);
      setStrategySummary(data.strategySummary);
      setStory(data.story);
      setFinalStory(data.finalStory);
      setAnswers(data.answers);
      setAnswers2(data.answers2);
      setEditableCascadeResult(data.editableCascadeResult);
      setCsvFinanceData(data.csvFinanceData);
    };

    load();
  }, [user?.id]);

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
    <StepLayout title="第1章：この会社は何者か？" subtitle="自分たちの原点を明確にする">
      <div className="space-y-6">
        {renderStepContent()}

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
