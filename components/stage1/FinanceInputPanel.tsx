// /components/stage1/FinanceInputPanel.tsx
'use client';

import Step3FinanceUpload from '@/components/steps/Step3FinanceUpload';

export default function FinanceInputPanel() {
  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">② 財務データ入力</h2>
      <Step3FinanceUpload />
    </section>
  );
}
