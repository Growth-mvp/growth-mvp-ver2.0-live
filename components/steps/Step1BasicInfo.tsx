// /components/steps/Step1BasicInfo.tsx
'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  ReactNode,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  ChangeEvent,
} from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import StepLayout from '@/components/StepLayout';
import { industryOptions } from '@/utils/industryTemplates';

/* ---------------- UI atoms（Apple風 + IMEヒント） ---------------- */

// 基本のラベル付きフィールド
function Field({
  label,
  children,
  hint,
  required,
  right,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
  right?: ReactNode;
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

// 共通スタイル
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

/**
 * 日本語入力向け（かな入力を促す）
 */
function InputJa(props: InputHTMLAttributes<HTMLInputElement>) {
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

function TextAreaJa(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
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

/**
 * 数字専用（英数字のみ）
 * - 入力は数字のみ許可（全角→半角、非数字除去）
 * - ただし store へは number|null で保存する（型ゆらぎ防止）
 */
function InputNum({
  onChange,
  value,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
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
        const half = raw.replace(/[０-９]/g, (s) =>
          String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
        );
        const digits = half.replace(/[^0-9]/g, '');
        if (onChange) {
          onChange({
            ...e,
            target: { ...e.target, value: digits },
            currentTarget: { ...e.currentTarget, value: digits },
          } as any as ChangeEvent<HTMLInputElement>);
        }
      }}
    />
  );
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[baseSelectClass, props.className || ''].join(' ')}
    />
  );
}

/* --------------- ユーティリティ --------------- */
const toNumOrNull = (v: any): number | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const isBlank = (v: any) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '');

/* --------------- セッター安全ラッパー --------------- */
function setFieldSafe(store: any, key: string, value: any) {
  const fnName = 'set' + key.charAt(0).toUpperCase() + key.slice(1);
  const setter = store?.[fnName];
  if (typeof setter === 'function') {
    setter(value);
  } else if (typeof (useStrategyStore as any)?.setState === 'function') {
    (useStrategyStore as any).setState({ [key]: value });
  }
}

/* ---------------------- 本体 ---------------------- */
export default function Step1BasicInfo() {
  const st = useStrategyStore() as any;

  // store 値（再取得での更新もリアクティブに反映される）
  const companyName: string = st?.companyName ?? '';
  const foundationYear: number | null = st?.foundationYear ?? null;
  const location: string = st?.location ?? '';
  const industry: string = st?.industry ?? '';
  const revenue: number | null = st?.revenue ?? null;
  const employees: number | null = st?.employees ?? null;
  const businessContent: string = st?.businessContent ?? '';
  const customerSegment: string = st?.customerSegment ?? '';
  const thoughtRaw: string = st?.thought ?? '';
  const enhanceEmotion: boolean = st?.enhanceEmotion ?? true;
  const aiSuggestedBasicInfo: any = st?.aiSuggestedBasicInfo ?? null;

  // thought はAPI側の上限（1000字）に合わせて保持
  const THOUGHT_MAX = 1000;
  const [thoughtLocal, setThoughtLocal] = useState<string>(
    typeof thoughtRaw === 'string' ? thoughtRaw.slice(0, THOUGHT_MAX) : ''
  );
  const thoughtCount = useMemo(
    () => (thoughtLocal?.length ?? 0),
    [thoughtLocal]
  );

  // store → local（初期＆再取得時に同期）
  useEffect(() => {
    const v =
      typeof thoughtRaw === 'string'
        ? thoughtRaw.slice(0, THOUGHT_MAX)
        : '';
    setThoughtLocal(v);
  }, [thoughtRaw]);

  // local → store（即時反映）
  useEffect(() => {
    const trimmed = (thoughtLocal || '').replace(/\s+$/g, '').slice(0, THOUGHT_MAX);
    setFieldSafe(st, 'thought', trimmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thoughtLocal]);

  // ★ AI提案の「空欄のみ補完」＋「一度きり適用」ガード
  const appliedAISuggestRef = useRef(false);
  useEffect(() => {
    if (!aiSuggestedBasicInfo || appliedAISuggestRef.current) return;

    // 何かしら空欄があるときのみ補完
    const needs =
      isBlank(st?.companyName) ||
      st?.foundationYear == null ||
      isBlank(st?.location) ||
      isBlank(st?.industry) ||
      st?.revenue == null ||
      st?.employees == null ||
      isBlank(st?.businessContent) ||
      isBlank(st?.customerSegment) ||
      isBlank(st?.thought);

    if (!needs) return;

    const pick = (k: string) => aiSuggestedBasicInfo?.[k];

    // thought は上限付き
    if (isBlank(st?.thought) && pick('thought')) {
      setFieldSafe(st, 'thought', String(pick('thought')).slice(0, THOUGHT_MAX));
    }
    if (isBlank(st?.companyName) && pick('companyName')) {
      setFieldSafe(st, 'companyName', String(pick('companyName')));
    }
    if (st?.foundationYear == null && pick('foundationYear') != null) {
      setFieldSafe(st, 'foundationYear', toNumOrNull(pick('foundationYear')));
    }
    if (isBlank(st?.location) && pick('location')) {
      setFieldSafe(st, 'location', String(pick('location')));
    }
    if (isBlank(st?.industry) && pick('industry')) {
      setFieldSafe(st, 'industry', String(pick('industry')));
    }
    if (st?.revenue == null && pick('revenue') != null) {
      setFieldSafe(st, 'revenue', toNumOrNull(pick('revenue')));
    }
    if (st?.employees == null && pick('employees') != null) {
      setFieldSafe(st, 'employees', toNumOrNull(pick('employees')));
    }
    if (isBlank(st?.businessContent) && pick('businessContent')) {
      setFieldSafe(st, 'businessContent', String(pick('businessContent')));
    }
    if (isBlank(st?.customerSegment) && pick('customerSegment')) {
      setFieldSafe(st, 'customerSegment', String(pick('customerSegment')));
    }

    appliedAISuggestRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSuggestedBasicInfo, st?.companyName, st?.foundationYear, st?.location, st?.industry, st?.revenue, st?.employees, st?.businessContent, st?.customerSegment, st?.thought]);

  // アクセシビリティ用のID
  const idPrefix = useId();

  return (
    <StepLayout step={1} totalSteps={5} title="STEP 1：基本情報（会社プロフィール）">
      <div className="space-y-10">
        {/* 経営者の思い（日本語IMEを促す） */}
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
              onChange={(e) =>
                setThoughtLocal((e.target.value ?? '').slice(0, THOUGHT_MAX))
              }
              placeholder="例：社員が胸を張れる会社にする。日本の製造業の価値を再定義する。そのために、守りの効率化と攻めの価値創造を同時にやり切る。"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-[13px] text-neutral-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900/80"
                  checked={!!enhanceEmotion}
                  onChange={(e) => setFieldSafe(st, 'enhanceEmotion', e.target.checked)}
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
              onChange={(e) => setFieldSafe(st, 'companyName', e.target.value)}
              placeholder="例：株式会社○○"
            />
          </Field>

          <Field label="設立年">
            <InputNum
              id={`${idPrefix}-foundation`}
              value={foundationYear ?? ''}
              onChange={(e: any) =>
                setFieldSafe(st, 'foundationYear', toNumOrNull(e.target.value))
              }
              placeholder="例：2005"
            />
          </Field>

          <Field label="所在地">
            <InputJa
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
              {(industryOptions ?? []).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="売上（百万円）">
            <InputNum
              id={`${idPrefix}-revenue`}
              value={revenue ?? ''}
              onChange={(e: any) =>
                setFieldSafe(st, 'revenue', toNumOrNull(e.target.value))
              }
              placeholder="例：5000"
            />
          </Field>

          <Field label="従業員数（人）">
            <InputNum
              id={`${idPrefix}-employees`}
              value={employees ?? ''}
              onChange={(e: any) =>
                setFieldSafe(st, 'employees', toNumOrNull(e.target.value))
              }
              placeholder="例：200"
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="主な事業内容">
              <TextAreaJa
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
              <TextAreaJa
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
