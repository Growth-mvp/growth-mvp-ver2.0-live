'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';
import { industryOptions } from '@/utils/industryTemplates';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';

/* ---------------- 共通UIコンポーネント ---------------- */

function Field({
  label,
  children,
  hint,
  required,
  right,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[13px] font-medium text-neutral-700">
          {label}
          {required && <span className="ml-1 text-rose-500">*</span>}
        </label>
        <div className="flex items-center gap-3">
          {hint && <span className="text-[12px] text-neutral-400">{hint}</span>}
          {right}
        </div>
      </div>
      {children}
    </div>
  );
}

const baseInputClass =
  'w-full h-11 rounded-xl px-3.5 bg-white text-neutral-900 placeholder:text-neutral-400 ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none transition shadow-[0_1px_0_rgba(0,0,0,0.02)]';

const baseTextAreaClass =
  'w-full rounded-xl px-3.5 py-3 bg-white text-neutral-900 placeholder:text-neutral-400 ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none transition shadow-[0_1px_0_rgba(0,0,0,0.02)]';

const baseSelectClass =
  'w-full h-11 rounded-xl px-3.5 bg-white text-neutral-900 ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none transition appearance-none pr-9';

function InputJa(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      lang="ja"
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete={props.autoComplete ?? 'off'}
      className={[baseInputClass, props.className || ''].join(' ')}
      style={{ ...(props.style || {}), imeMode: 'active' as any }}
    />
  );
}

function TextAreaJa(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      lang="ja"
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete={props.autoComplete ?? 'off'}
      className={[baseTextAreaClass, props.className || ''].join(' ')}
      style={{ ...(props.style || {}), imeMode: 'active' as any }}
    />
  );
}

function InputNumString({
  onChange,
  value,
  onValueChange,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  onValueChange?: (digits: string) => void;
}) {
  return (
    <input
      {...rest}
      inputMode="numeric"
      pattern="[0-9]*"
      className={[baseInputClass, rest.className || ''].join(' ')}
      value={value as string | number | undefined}
      style={{ ...(rest.style || {}), imeMode: 'inactive' as any }}
      onChange={(e) => {
        const raw = e.target.value ?? '';
        const half = raw.replace(/[０-９]/g, (s) =>
          String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
        );
        const digits = half.replace(/[^0-9]/g, '');
        onValueChange?.(digits);
        onChange?.(e);
      }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={[baseSelectClass, props.className || ''].join(' ')} />;
}

/* ---------------------- 本体 ---------------------- */

export default function Step1BasicInfo() {
  const setProfile = useStrategyStore((s: StrategyState) => s.setProfile);
  const setMVV = useStrategyStore((s: StrategyState) => s.setMVV);

  const companyName = useStrategyStore((s: StrategyState) => s.companyName ?? '');
  const foundationYear = useStrategyStore((s: StrategyState) => s.foundationYear ?? '');
  const location = useStrategyStore((s: StrategyState) => s.location ?? '');
  const industry = useStrategyStore((s: StrategyState) => s.industry ?? '');
  const revenue = useStrategyStore((s: StrategyState) => s.revenue ?? '');
  const employees = useStrategyStore((s: StrategyState) => s.employees ?? '');
  const businessContent = useStrategyStore((s: StrategyState) => s.businessContent ?? '');
  const customerSegment = useStrategyStore((s: StrategyState) => s.customerSegment ?? '');
  const thoughtRaw = useStrategyStore((s: StrategyState) => s.thought ?? '');
  const aiSuggestedBasicInfo = useStrategyStore((s: any) => s.aiSuggestedBasicInfo ?? null);

  const THOUGHT_MAX = 1000;
  const [thoughtLocal, setThoughtLocal] = useState(
    typeof thoughtRaw === 'string' ? thoughtRaw.slice(0, THOUGHT_MAX) : ''
  );
  const thoughtCount = useMemo(() => thoughtLocal.length, [thoughtLocal]);

  // store→local
  useEffect(() => {
    const v = typeof thoughtRaw === 'string' ? thoughtRaw.slice(0, THOUGHT_MAX) : '';
    setThoughtLocal(v);
  }, [thoughtRaw]);

  // local→store（魂の補正なしでそのまま保存）
  useEffect(() => {
    const trimmed = (thoughtLocal || '').replace(/\s+$/g, '').slice(0, THOUGHT_MAX);
    setMVV({ thought: trimmed });
  }, [thoughtLocal, setMVV]);

  // AI提案：空欄のみ補完
  const appliedAISuggestRef = useRef(false);
  useEffect(() => {
    if (!aiSuggestedBasicInfo || appliedAISuggestRef.current) return;

    const pick = (k: string) => aiSuggestedBasicInfo?.[k];
    const patch: Parameters<typeof setProfile>[0] = {};

    if ((thoughtRaw ?? '').trim() === '' && pick('thought')) {
      const seed = String(pick('thought')).slice(0, THOUGHT_MAX);
      setMVV({ thought: seed });
    }
    if ((companyName ?? '').trim() === '' && pick('companyName')) patch.companyName = String(pick('companyName'));
    if ((foundationYear ?? '').trim() === '' && pick('foundationYear')) patch.foundationYear = String(pick('foundationYear'));
    if ((location ?? '').trim() === '' && pick('location')) patch.location = String(pick('location'));
    if ((industry ?? '').trim() === '' && pick('industry')) patch.industry = String(pick('industry'));
    if ((revenue ?? '').trim() === '' && pick('revenue')) patch.revenue = String(pick('revenue'));
    if ((employees ?? '').trim() === '' && pick('employees')) patch.employees = String(pick('employees'));
    if ((businessContent ?? '').trim() === '' && pick('businessContent')) patch.businessContent = String(pick('businessContent'));
    if ((customerSegment ?? '').trim() === '' && pick('customerSegment')) patch.customerSegment = String(pick('customerSegment'));
    if (Object.keys(patch).length) setProfile(patch);

    appliedAISuggestRef.current = true;
  }, [
    aiSuggestedBasicInfo,
    setProfile,
    setMVV,
    thoughtRaw,
    companyName,
    foundationYear,
    location,
    industry,
    revenue,
    employees,
    businessContent,
    customerSegment,
  ]);

  const idPrefix = useId();

  return (
    <StepLayout step={1} totalSteps={5} title="STEP 1：基本情報（会社プロフィール）">
      <div className="space-y-10">
        {/* 経営者の思い */}
        <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 p-5 md:p-6">
          <Field
            label="経営者の思い"
            hint="3〜5行で端的に（最大1000字）"
            required
            right={
              <span className="text-[12px] tabular-nums text-neutral-400">
                {thoughtCount}/{THOUGHT_MAX}
              </span>
            }
          >
            <AutoResizeTextarea
              id={`${idPrefix}-thought`}
              minRows={3}
              maxRows={6}
              value={thoughtLocal}
              onChange={(e) => setThoughtLocal((e.target.value ?? '').slice(0, THOUGHT_MAX))}
              placeholder="例：社員が胸を張れる会社にする。そのために、守りの効率化と攻めの価値創造を同時にやり切る。"
              lang="ja"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              className="w-full rounded-xl px-3.5 py-3 bg-white text-neutral-900 placeholder:text-neutral-400 ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none transition shadow-[0_1px_0_rgba(0,0,0,0.02)]"
              style={{ imeMode: 'active' as any }}
            />
          </Field>
        </div>

        {/* 会社プロフィール */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field label="会社名" required>
            <InputJa
              id={`${idPrefix}-company`}
              value={companyName}
              onChange={(e) => setProfile({ companyName: e.target.value })}
              placeholder="例：株式会社○○"
            />
          </Field>
          <Field label="設立年">
            <InputNumString
              id={`${idPrefix}-foundation`}
              value={foundationYear}
              onValueChange={(digits) => setProfile({ foundationYear: digits })}
              placeholder="例：2005"
            />
          </Field>
          <Field label="所在地">
            <InputJa
              id={`${idPrefix}-location`}
              value={location}
              onChange={(e) => setProfile({ location: e.target.value })}
              placeholder="例：東京都港区"
            />
          </Field>
          <Field label="業種">
            <Select
              id={`${idPrefix}-industry`}
              value={industry}
              onChange={(e) => setProfile({ industry: e.currentTarget.value })}
            >
              <option value="">-- 選択してください --</option>
              {(industryOptions ?? []).map((item) => (
                <option key={String(item.value)} value={String(item.value)}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="売上（百万円）">
            <InputNumString
              id={`${idPrefix}-revenue`}
              value={revenue}
              onValueChange={(digits) => setProfile({ revenue: digits })}
              placeholder="例：5000"
            />
          </Field>
          <Field label="従業員数（人）">
            <InputNumString
              id={`${idPrefix}-employees`}
              value={employees}
              onValueChange={(digits) => setProfile({ employees: digits })}
              placeholder="例：200"
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="主な事業内容">
              <AutoResizeTextarea
                id={`${idPrefix}-business`}
                minRows={3}
                maxRows={6}
                value={businessContent}
                onChange={(e) => setProfile({ businessContent: e.target.value })}
                placeholder="例：自動車部品の設計・製造・販売"
                lang="ja"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                className="w-full rounded-xl px-3.5 py-3 bg-white text-neutral-900 placeholder:text-neutral-400 ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none transition shadow-[0_1px_0_rgba(0,0,0,0.02)]"
                style={{ imeMode: 'active' as any }}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="主要な顧客層">
              <AutoResizeTextarea
                id={`${idPrefix}-customer`}
                minRows={3}
                maxRows={6}
                value={customerSegment}
                onChange={(e) => setProfile({ customerSegment: e.target.value })}
                placeholder="例：国内外の完成車メーカー、部品メーカー"
                lang="ja"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                className="w-full rounded-xl px-3.5 py-3 bg-white text-neutral-900 placeholder:text-neutral-400 ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none transition shadow-[0_1px_0_rgba(0,0,0,0.02)]"
                style={{ imeMode: 'active' as any }}
              />
            </Field>
          </div>
        </div>
      </div>
    </StepLayout>
  );
}
