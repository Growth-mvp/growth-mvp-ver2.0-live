// /components/steps/Step1BasicInfo.tsx
'use client';

import { useEffect, useId, useMemo, useRef, useState, ChangeEvent } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';
import { industryOptions } from '@/utils/industryTemplates';

/* ---------------- UI atoms（Apple風 + IMEヒント） ---------------- */

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

const baseInputClass = [
  'w-full h-11 rounded-xl px-3.5',
  'bg-white text-neutral-900 placeholder:text-neutral-400',
  'ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none',
  'transition shadow-[0_1px_0_rgba(0,0,0,0.02)]',
].join(' ');

const baseTextAreaClass = [
  'w-full rounded-xl px-3.5 py-3',
  'bg-white text-neutral-900 placeholder:text-neutral-400',
  'ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none',
  'transition shadow-[0_1px_0_rgba(0,0,0,0.02)]',
].join(' ');

const baseSelectClass = [
  'w-full h-11 rounded-xl px-3.5',
  'bg-white text-neutral-900',
  'ring-1 ring-neutral-300 focus:ring-2 focus:ring-neutral-900/90 focus:outline-none',
  'transition appearance-none pr-9',
].join(' ');

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

/** 半角数字のみを許可し、store には「文字列」で保存（イベント改ざんしない版） */
function InputNumString({
  onChange, // 互換維持のため残す（イベントはそのまま）
  value,
  onValueChange, // 推奨：数値文字列だけを渡す
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  onValueChange?: (digits: string) => void;
}) {
  return (
    <input
      {...rest}
      inputMode="numeric"
      pattern="[0-9]*"
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete={rest.autoComplete ?? 'off'}
      className={[baseInputClass, rest.className || ''].join(' ')}
      value={value as string | number | undefined}
      style={{ ...(rest.style || {}), imeMode: 'inactive' as any }}
      onChange={(e) => {
        const raw = e.target.value ?? '';
        // 全角数字→半角
        const half = raw.replace(/[０-９]/g, (s) =>
          String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
        );
        // 数字以外除去
        const digits = half.replace(/[^0-9]/g, '');
        onValueChange?.(digits);
        // 互換のため元の onChange も呼ぶ（ただしイベントは改ざんしない）
        onChange?.(e);
      }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[baseSelectClass, props.className || ''].join(' ')}
    />
  );
}

/* --------------- ユーティリティ --------------- */
const isBlank = (v: any) => v == null || (typeof v === 'string' && v.trim() === '');

/* ---------------------- 本体 ---------------------- */
export default function Step1BasicInfo() {
  // ✅ storeから必要なセッターを取得
  const setProfile = useStrategyStore((s) => s.setProfile);
  const setMVV = useStrategyStore((s) => s.setMVV);

  // ✅ 値は StrategyState に合わせて「すべて文字列」で保持
  const companyName = useStrategyStore((s) => s.companyName ?? '');
  const foundationYear = useStrategyStore((s) => s.foundationYear ?? '');
  const location = useStrategyStore((s) => s.location ?? '');
  const industry = useStrategyStore((s) => s.industry ?? '');
  const revenue = useStrategyStore((s) => s.revenue ?? '');
  const employees = useStrategyStore((s) => s.employees ?? '');
  const businessContent = useStrategyStore((s) => s.businessContent ?? '');
  const customerSegment = useStrategyStore((s) => s.customerSegment ?? '');
  const thoughtRaw = useStrategyStore((s) => s.thought ?? '');
  const enhanceEmotion = useStrategyStore((s: any) => s.enhanceEmotion ?? true);
  const aiSuggestedBasicInfo = useStrategyStore((s: any) => s.aiSuggestedBasicInfo ?? null);

  const THOUGHT_MAX = 1000;
  const [thoughtLocal, setThoughtLocal] = useState<string>(
    typeof thoughtRaw === 'string' ? thoughtRaw.slice(0, THOUGHT_MAX) : ''
  );
  const thoughtCount = useMemo(() => thoughtLocal.length, [thoughtLocal]);

  // store → local
  useEffect(() => {
    const v = typeof thoughtRaw === 'string' ? thoughtRaw.slice(0, THOUGHT_MAX) : '';
    setThoughtLocal(v);
  }, [thoughtRaw]);

  // local → store（公式セッター setMVV 経由）
  useEffect(() => {
    const trimmed = (thoughtLocal || '').replace(/\s+$/g, '').slice(0, THOUGHT_MAX);
    setMVV({ thought: trimmed });
  }, [thoughtLocal, setMVV]);

  // AI提案：空欄のみ補完（一度きり）
  const appliedAISuggestRef = useRef(false);
  useEffect(() => {
    if (!aiSuggestedBasicInfo || appliedAISuggestRef.current) return;

    const pick = (k: string) => aiSuggestedBasicInfo?.[k];

    // thought は setMVV による公式経路で
    if (isBlank(thoughtRaw) && pick('thought')) {
      setMVV({ thought: String(pick('thought')).slice(0, THOUGHT_MAX) });
    }

    const patch: Parameters<typeof setProfile>[0] = {};
    if (isBlank(companyName) && pick('companyName')) patch.companyName = String(pick('companyName'));
    if (isBlank(foundationYear) && pick('foundationYear') != null) patch.foundationYear = String(pick('foundationYear') ?? '');
    if (isBlank(location) && pick('location')) patch.location = String(pick('location'));
    if (isBlank(industry) && pick('industry')) patch.industry = String(pick('industry'));
    if (isBlank(revenue) && pick('revenue') != null) patch.revenue = String(pick('revenue') ?? '');
    if (isBlank(employees) && pick('employees') != null) patch.employees = String(pick('employees') ?? '');
    if (isBlank(businessContent) && pick('businessContent')) patch.businessContent = String(pick('businessContent'));
    if (isBlank(customerSegment) && pick('customerSegment')) patch.customerSegment = String(pick('customerSegment'));

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
            <TextAreaJa
              id={`${idPrefix}-thought`}
              rows={4}
              value={thoughtLocal}
              onChange={(e) => setThoughtLocal((e.target.value ?? '').slice(0, THOUGHT_MAX))}
              placeholder="例：社員が胸を張れる会社にする。日本の製造業の価値を再定義する。そのために、守りの効率化と攻めの価値創造を同時にやり切る。"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-[13px] text-neutral-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900/80"
                  checked={!!enhanceEmotion}
                  onChange={(e) => {
                    // セッター未提供のため局所フォールバック（安全）
                    (useStrategyStore as any).setState({ enhanceEmotion: e.target.checked });
                  }}
                />
                魂の補正（文章の熱量強化）を有効化
              </label>
              <span className="text-[12px] text-neutral-400">
                ※ 有効時は生成後に「経営者の語り口」へ自動エディット（既定ON）
              </span>
            </div>
          </Field>
        </div>

        {/* 2カラムフォーム */}
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
              <TextAreaJa
                id={`${idPrefix}-business`}
                rows={3}
                value={businessContent}
                onChange={(e) => setProfile({ businessContent: e.target.value })}
                placeholder="例：自動車部品の設計・製造・販売"
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="主要な顧客層">
              <TextAreaJa
                id={`${idPrefix}-customer`}
                rows={3}
                value={customerSegment}
                onChange={(e) => setProfile({ customerSegment: e.target.value })}
                placeholder="例：国内外の完成車メーカー、部品メーカー"
              />
            </Field>
          </div>
        </div>
      </div>
    </StepLayout>
  );
}
