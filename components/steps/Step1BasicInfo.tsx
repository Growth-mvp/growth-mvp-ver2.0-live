// /components/steps/Step1BasicInfo.tsx
'use client';

import { useEffect, useId } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';
import { industryOptions } from '@/utils/industryTemplates';

/* ---------------- UI atoms（Apple風） ---------------- */
function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-[13px] font-medium text-neutral-700">
          {label}{required && <span className="ml-1 text-rose-500">*</span>}
        </label>
        {hint && <span className="text-[12px] text-neutral-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        [
          "w-full h-11 rounded-xl px-3.5",
          "bg-white text-neutral-900 placeholder:text-neutral-400",
          "ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none",
          "transition shadow-[0_1px_0_rgba(0,0,0,0.02)]"
        ].join(' ')
      }
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={
        [
          "w-full rounded-xl px-3.5 py-3",
          "bg-white text-neutral-900 placeholder:text-neutral-400",
          "ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none",
          "transition shadow-[0_1px_0_rgba(0,0,0,0.02)]"
        ].join(' ')
      }
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={
        [
          "w-full h-11 rounded-xl px-3.5",
          "bg-white text-neutral-900",
          "ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none",
          "transition appearance-none pr-9"
        ].join(' ')
      }
    />
  );
}

/* --------------- セッター安全ラッパー --------------- */
function setFieldSafe(store: any, key: string, value: any) {
  const fnName = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
  const setter = store?.[fnName];
  if (typeof setter === 'function') {
    setter(value);
  } else if (typeof useStrategyStore?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

/* ---------------------- 本体 ---------------------- */
export default function Step1BasicInfo() {
  const st = useStrategyStore() as any;

  const companyName: string = st?.companyName ?? '';
  const foundationYear: string = st?.foundationYear ?? '';
  const location: string = st?.location ?? '';
  const industry: string = st?.industry ?? '';
  const revenue: string = st?.revenue ?? '';
  const employees: string = st?.employees ?? '';
  const businessContent: string = st?.businessContent ?? '';
  const customerSegment: string = st?.customerSegment ?? '';
  const thought: string = st?.thought ?? '';
  const aiSuggestedBasicInfo: any = st?.aiSuggestedBasicInfo ?? null;

  // AI提案の静かな自動反映（上書きではなく“初期値補完”の想定）
  useEffect(() => {
    if (!aiSuggestedBasicInfo) return;
    if (aiSuggestedBasicInfo.thought) setFieldSafe(st, 'thought', aiSuggestedBasicInfo.thought);
    if (aiSuggestedBasicInfo.companyName) setFieldSafe(st, 'companyName', aiSuggestedBasicInfo.companyName);
    if (aiSuggestedBasicInfo.foundationYear) setFieldSafe(st, 'foundationYear', aiSuggestedBasicInfo.foundationYear);
    if (aiSuggestedBasicInfo.location) setFieldSafe(st, 'location', aiSuggestedBasicInfo.location);
    if (aiSuggestedBasicInfo.industry) setFieldSafe(st, 'industry', aiSuggestedBasicInfo.industry);
    if (aiSuggestedBasicInfo.revenue) setFieldSafe(st, 'revenue', aiSuggestedBasicInfo.revenue);
    if (aiSuggestedBasicInfo.employees) setFieldSafe(st, 'employees', aiSuggestedBasicInfo.employees);
    if (aiSuggestedBasicInfo.businessContent) setFieldSafe(st, 'businessContent', aiSuggestedBasicInfo.businessContent);
    if (aiSuggestedBasicInfo.customerSegment) setFieldSafe(st, 'customerSegment', aiSuggestedBasicInfo.customerSegment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestedBasicInfo]);

  // アクセシビリティ用のID
  const idPrefix = useId();

  return (
    <StepLayout step={1} totalSteps={5} title="STEP 1：基本情報（会社プロフィール）">
      <div className="space-y-10">

        {/* 経営者の思い（Apple風アラートカード） */}
        <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 p-5 md:p-6">
          <Field label="経営者の思い" hint="3〜5行で端的に" required>
            <TextArea
              id={`${idPrefix}-thought`}
              rows={4}
              value={thought}
              onChange={(e) => setFieldSafe(st, 'thought', e.target.value)}
              placeholder="例：社員が誇れる会社にする。日本の製造業の未来をつくる。"
            />
          </Field>
        </div>

        {/* 2カラムフォーム */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field label="会社名" required>
            <Input
              id={`${idPrefix}-company`}
              value={companyName}
              onChange={(e) => setFieldSafe(st, 'companyName', e.target.value)}
              placeholder="例：株式会社○○"
            />
          </Field>

          <Field label="設立年">
            <Input
              id={`${idPrefix}-foundation`}
              value={foundationYear}
              onChange={(e) => setFieldSafe(st, 'foundationYear', e.target.value)}
              placeholder="例：2005"
              inputMode="numeric"
            />
          </Field>

          <Field label="所在地">
            <Input
              id={`${idPrefix}-location`}
              value={location}
              onChange={(e) => setFieldSafe(st, 'location', e.target.value)}
              placeholder="例：東京都港区"
            />
          </Field>

          <Field label="業種">
            <Select
              id={`${idPrefix}-industry`}
              value={industry}
              onChange={(e) => setFieldSafe(st, 'industry', e.target.value)}
            >
              <option value="">-- 選択してください --</option>
              {industryOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="売上（百万円）">
            <Input
              id={`${idPrefix}-revenue`}
              value={revenue}
              onChange={(e) => setFieldSafe(st, 'revenue', e.target.value)}
              placeholder="例：5000"
              inputMode="numeric"
            />
          </Field>

          <Field label="従業員数（人）">
            <Input
              id={`${idPrefix}-employees`}
              value={employees}
              onChange={(e) => setFieldSafe(st, 'employees', e.target.value)}
              placeholder="例：200"
              inputMode="numeric"
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="主な事業内容">
              <TextArea
                id={`${idPrefix}-business`}
                rows={3}
                value={businessContent}
                onChange={(e) => setFieldSafe(st, 'businessContent', e.target.value)}
                placeholder="例：自動車部品の設計・製造・販売"
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="主要な顧客層">
              <TextArea
                id={`${idPrefix}-customer`}
                rows={3}
                value={customerSegment}
                onChange={(e) => setFieldSafe(st, 'customerSegment', e.target.value)}
                placeholder="例：国内外の完成車メーカー、部品メーカー"
              />
            </Field>
          </div>
        </div>
      </div>
    </StepLayout>
  );
}
