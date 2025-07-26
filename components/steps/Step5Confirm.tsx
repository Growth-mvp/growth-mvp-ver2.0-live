'use client';

import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';

export default function Step5Confirm() {
  const {
    companyName,
    foundationYear,
    location,
    industry,
    revenue,
    employees,
    businessContent,
    customerSegment,
    thought,
    strength,
    weakness,
    opportunity,
    threat,
    mission,
    vision,
    value,
  } = useStrategyStore();

  return (
    <StepLayout step={5} totalSteps={5} title="入力内容の最終確認">
      <div className="space-y-6 text-sm text-gray-800">
        <Section title="🧾 会社情報">
          <Info label="会社名" value={companyName} />
          <Info label="設立年" value={foundationYear} />
          <Info label="所在地" value={location} />
          <Info label="業種" value={industry} />
          <Info label="売上" value={`${revenue} 億円`} />
          <Info label="従業員数" value={`${employees} 人`} />
        </Section>

        <Section title="🏢 事業情報">
          <Info label="主な事業内容" value={businessContent} />
          <Info label="主要な顧客層" value={customerSegment} />
        </Section>

        <Section title="🧠 経営者の思いとMVV">
          <Info label="経営者の思い" value={thought} />
          <Info label="Mission" value={mission} />
          <Info label="Vision" value={vision} />
          <Info label="Value" value={value} />
        </Section>

        <Section title="📊 SWOT分析">
          <ul className="ml-4 list-disc text-gray-700 space-y-1">
            <li><strong>Strength（強み）:</strong> {strength}</li>
            <li><strong>Weakness（弱み）:</strong> {weakness}</li>
            <li><strong>Opportunity（機会）:</strong> {opportunity}</li>
            <li><strong>Threat（脅威）:</strong> {threat}</li>
          </ul>
        </Section>

        <div className="text-center text-sm text-gray-500 mt-8">
          👉「次へ →」を押すと、AIがたたき台ストーリーを生成します。
        </div>
      </div>
    </StepLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-md p-4 shadow-sm bg-gray-50">
      <h3 className="font-semibold text-gray-700 mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <strong>{label}：</strong>
      <span>{value || '（未入力）'}</span>
    </p>
  );
}
