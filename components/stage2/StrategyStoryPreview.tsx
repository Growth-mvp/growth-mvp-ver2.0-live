/**
 * /components/stage2/StrategyStoryPreview.tsx
 *
 * 全社戦略書。STAGE2の最終確定画面と全社戦略書PDFで同じ内容を描画する。
 * 閲覧時は空の項目を表示せず、編集時のみ入力欄を出す。
 */

import React, { useEffect, useState } from 'react';
import type { MidtermStrategy, StoryChapter } from '@/types/strategy';
import {
  buildStrategicAssumptions,
  resolveConclusion,
  resolveStrategicAssumptions,
  type FinancialTargetRow,
  type StrategicAssumptions,
} from '@/lib/stage2/finalDocument';

export type FinancialTargets = {
  revenue?: FinancialTargetRow;
  operatingProfit?: FinancialTargetRow;
};

interface StrategyStoryPreviewProps {
  story: StoryChapter[];
  finalized: boolean;
  companyName?: string;
  midtermStrategy?: MidtermStrategy;
  financialTargets?: FinancialTargets;
  swotSuggestions?: any;
  swotData?: any;
  mode?: 'screen' | 'pdf';

  /** 保存済みの結論・前提の編集値（未編集なら undefined） */
  conclusionDraft?: string;
  assumptionsDraft?: Partial<StrategicAssumptions>;
  aiGeneratedConclusion?: string;

  isEditMode?: boolean;
  onConclusionChange?: (conclusion: string) => void;
  onAssumptionsChange?: (assumptions: StrategicAssumptions) => void;
  onMidtermStrategyChange?: (midtermStrategy: MidtermStrategy) => void;
}

function stripIssueSummary(text: string): string {
  return text.replace(/【.*?】[\s\S]*?(?=\n\n|$)/g, '').trim();
}

function renderParagraphs(text: string, variant: 'screen' | 'pdf' = 'screen') {
  const cleaned = stripIssueSummary(text ?? '');
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  const paragraphClass = variant === 'pdf'
    ? 'whitespace-pre-wrap break-words text-justify text-[11px] leading-[1.65] tracking-[0.001em] text-slate-700'
    : 'whitespace-pre-wrap break-words text-justify leading-8 tracking-[0.005em] text-slate-700';

  return paragraphs.map((p, i) => (
    <p key={i} className={paragraphClass}>
      {p}
    </p>
  ));
}

function cleanChapterTitle(rawTitle: string | undefined, chapterNumber: number): string {
  const fallbackTitles = [
    'なぜ今、変わる必要があるのか',
    'どこで戦うのか',
    'どんな未来を実現するのか',
    '社員一人ひとりはどう行動するのか',
  ];

  let title = (rawTitle ?? '').trim();
  if (!title) return fallbackTitles[chapterNumber - 1] ?? `章タイトル未設定`;

  title = title.replace(/^#+\s*/, '').trim();

  const chapterPrefixPatterns = [
    /^第\s*[0-9０-９一二三四五六七八九十]+\s*章\s*[：:・\-—–\s]*/,
    /^[0-9０-９一二三四五六七八九十]+\s*章\s*[：:・\-—–\s]*/,
    /^chapter\s*[0-9０-９一二三四五六七八九十]+\s*[：:・\-—–\s]*/i,
  ];

  for (const pattern of chapterPrefixPatterns) {
    while (pattern.test(title)) {
      title = title.replace(pattern, '').trim();
    }
  }

  return title || fallbackTitles[chapterNumber - 1] || `章タイトル未設定`;
}

function parseItems(text: string): string[] {
  return text.split('\n').filter((s) => s.trim());
}

const hasText = (value?: string) => typeof value === 'string' && value.trim() !== '';
const hasList = (value?: string[]) => Array.isArray(value) && value.some((v) => typeof v === 'string' && v.trim() !== '');

/** 入力途中の改行を保持するため、表示文字列はローカルに持ち、確定した項目だけを親へ渡す */
function ItemListEditor({
  items,
  onChange,
  rows,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  rows: number;
  placeholder?: string;
}) {
  const itemsKey = items.join('\n');
  const [text, setText] = useState(itemsKey);

  useEffect(() => {
    setText((current) => (parseItems(current).join('\n') === itemsKey ? current : itemsKey));
  }, [itemsKey]);

  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseItems(e.target.value));
      }}
      className="w-full p-3 border border-slate-300 rounded-lg text-sm leading-relaxed resize-vertical font-sans"
      rows={rows}
      placeholder={placeholder ?? '各項目を1行ずつ入力...'}
    />
  );
}

function EmptyText({ text = '未入力' }: { text?: string }) {
  return <p className="text-sm text-slate-400">（{text}）</p>;
}

function TextField({
  isEditMode,
  value,
  onChange,
  rows = 3,
  placeholder,
  variant,
}: {
  isEditMode?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  rows?: number;
  placeholder?: string;
  variant: 'screen' | 'pdf';
}) {
  if (isEditMode) {
    return (
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full p-3 border border-slate-300 rounded-lg text-sm leading-relaxed resize-vertical font-sans"
        rows={rows}
        placeholder={placeholder}
      />
    );
  }
  return renderParagraphs(value ?? '', variant);
}

function ListField({
  isEditMode,
  items,
  onChange,
  rows = 4,
}: {
  isEditMode?: boolean;
  items: string[];
  onChange?: (items: string[]) => void;
  rows?: number;
}) {
  if (isEditMode) {
    return <ItemListEditor items={items} onChange={(next) => onChange?.(next)} rows={rows} />;
  }
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 text-slate-400">・</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DocSection({
  title,
  isPdf,
  children,
}: {
  title: string;
  isPdf: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="space-y-6 pt-6"
      style={{
        borderTop: '2px solid #0f172a',
        ...(isPdf ? { breakInside: 'avoid', pageBreakInside: 'avoid' } : {}),
      }}
    >
      <h2 className="text-xl font-bold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

/** 表示対象でない項目は見出しごと出さない（閲覧時に「（未入力）」を並べない） */
function FieldBlock({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-slate-800">{label}</h3>
      {children}
    </div>
  );
}

function formatTargetValue(value: number): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

function FinancialTargetTable({ targets }: { targets: FinancialTargets }) {
  const rows = [
    { label: '売上', target: targets.revenue },
    { label: '営業利益', target: targets.operatingProfit },
  ].filter((row): row is { label: string; target: FinancialTargetRow } => !!row.target);

  if (rows.length === 0) return null;

  return (
    <table className="w-full border-collapse text-sm text-slate-800">
      <thead>
        <tr className="border-b border-slate-300 text-left text-xs text-slate-500">
          <th className="py-2 pr-4 font-semibold">項目</th>
          <th className="py-2 pr-4 font-semibold">目標値</th>
          <th className="py-2 font-semibold">目標年度</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, target }) => (
          <tr key={label} className="border-b border-slate-100">
            <td className="py-2 pr-4">{label}</td>
            <td className="py-2 pr-4 font-semibold">
              {formatTargetValue(target.base)} {target.unit}
            </td>
            <td className="py-2">{target.dueYear ? `${target.dueYear}年度` : '未設定'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StrategyStoryPreview({
  story,
  finalized,
  companyName,
  midtermStrategy,
  financialTargets,
  swotSuggestions,
  swotData,
  mode = 'screen',
  conclusionDraft,
  assumptionsDraft,
  aiGeneratedConclusion,
  isEditMode,
  onConclusionChange,
  onAssumptionsChange,
  onMidtermStrategyChange,
}: StrategyStoryPreviewProps) {
  if (!story || story.length === 0) return null;

  const isPdf = mode === 'pdf';
  const variant = isPdf ? 'pdf' : 'screen';
  const midterm: MidtermStrategy = midtermStrategy ?? {};
  const conclusion = resolveConclusion(conclusionDraft, aiGeneratedConclusion);
  const assumptions = resolveStrategicAssumptions(
    assumptionsDraft,
    buildStrategicAssumptions({ swotSuggestions, swotData, midtermStrategy: midterm }),
  );
  const targets: FinancialTargets = financialTargets ?? {};
  const hasTargets = !!(targets.revenue || targets.operatingProfit);
  const edit = !!isEditMode;

  const showConclusion = edit || hasText(conclusion);
  const showGoals =
    edit || hasTargets || hasText(midterm.targetVisionForMidterm) || hasText(midterm.midtermConcept) || hasList(midterm.priorityStrategicThemes);
  const showAssumptions = edit || hasList(assumptions.external) || hasList(assumptions.internal) || hasList(assumptions.implications);
  const showPolicy =
    edit ||
    hasList(midterm.companyWideDecisionCriteria) ||
    hasList(midterm.deploymentPrinciplesForUnits) ||
    hasText(midterm.portfolioPolicy);

  const updateMidterm = (patch: Partial<MidtermStrategy>) => onMidtermStrategyChange?.({ ...midterm, ...patch });
  const updateAssumptions = (patch: Partial<StrategicAssumptions>) => onAssumptionsChange?.({ ...assumptions, ...patch });

  return (
    <article className={isPdf ? 'space-y-10 px-4' : 'mx-auto max-w-5xl space-y-10 px-4'}>
      <header className="border-b-4 border-slate-900 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">全社戦略書</h1>
        <p className="mt-2 text-lg font-semibold text-slate-800">{companyName || '（会社名未入力）'}</p>
        <div className="mt-4 flex flex-wrap gap-6 text-sm text-slate-700">
          <span
            className={
              finalized ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'
            }
          >
            状態：{finalized ? '確定版' : 'ドラフト（未確定）'}
          </span>
        </div>
      </header>

      {showConclusion && (
        <DocSection title="経営戦略の結論" isPdf={isPdf}>
          <TextField
            isEditMode={edit}
            value={edit ? conclusionDraft ?? aiGeneratedConclusion : conclusion}
            onChange={onConclusionChange}
            rows={6}
            placeholder="結論を入力..."
            variant={variant}
          />
        </DocSection>
      )}

      {showGoals && (
        <DocSection title="経営目標・重点戦略" isPdf={isPdf}>
          <FieldBlock label="目指す姿" show={edit || hasText(midterm.targetVisionForMidterm)}>
            <TextField
              isEditMode={edit}
              value={midterm.targetVisionForMidterm}
              onChange={(value) => updateMidterm({ targetVisionForMidterm: value })}
              variant={variant}
            />
          </FieldBlock>
          <FieldBlock label="中計の基本コンセプト" show={edit || hasText(midterm.midtermConcept)}>
            <TextField
              isEditMode={edit}
              value={midterm.midtermConcept}
              onChange={(value) => updateMidterm({ midtermConcept: value })}
              variant={variant}
            />
          </FieldBlock>
          <FieldBlock label="数値目標" show={hasTargets}>
            <FinancialTargetTable targets={targets} />
          </FieldBlock>
          <FieldBlock label="重点戦略テーマ" show={edit || hasList(midterm.priorityStrategicThemes)}>
            <ListField
              isEditMode={edit}
              items={midterm.priorityStrategicThemes ?? []}
              onChange={(items) => updateMidterm({ priorityStrategicThemes: items })}
            />
          </FieldBlock>
        </DocSection>
      )}

      {showAssumptions && (
        <DocSection title="戦略判断の前提" isPdf={isPdf}>
          <FieldBlock label="外部環境" show={edit || hasList(assumptions.external)}>
            <ListField
              isEditMode={edit}
              items={assumptions.external}
              onChange={(items) => updateAssumptions({ external: items })}
              rows={4}
            />
          </FieldBlock>
          <FieldBlock label="内部環境" show={edit || hasList(assumptions.internal)}>
            <ListField
              isEditMode={edit}
              items={assumptions.internal}
              onChange={(items) => updateAssumptions({ internal: items })}
              rows={4}
            />
          </FieldBlock>
          <FieldBlock label="戦略上の含意" show={edit || hasList(assumptions.implications)}>
            <ListField
              isEditMode={edit}
              items={assumptions.implications}
              onChange={(items) => updateAssumptions({ implications: items })}
              rows={3}
            />
          </FieldBlock>
        </DocSection>
      )}

      {story.map((chapter, index) => {
        const title = cleanChapterTitle(chapter.title, index + 1);
        return (
          <section key={index} className="space-y-6 pt-6" style={{ borderTop: '2px solid #0f172a' }}>
            <h2 className="text-xl font-bold text-slate-950">第{index + 1}章：{title}</h2>
            <div className="space-y-4">
              {renderParagraphs(chapter.body, variant) || <EmptyText text="本文未入力" />}
            </div>
          </section>
        );
      })}

      {showPolicy && (
        <DocSection title="全社共通の判断基準・部門展開の基本方針" isPdf={isPdf}>
          <FieldBlock label="全社共通の判断基準" show={edit || hasList(midterm.companyWideDecisionCriteria)}>
            <ListField
              isEditMode={edit}
              items={midterm.companyWideDecisionCriteria ?? []}
              onChange={(items) => updateMidterm({ companyWideDecisionCriteria: items })}
            />
          </FieldBlock>
          <FieldBlock label="部門・社員への展開方針" show={edit || hasList(midterm.deploymentPrinciplesForUnits)}>
            <ListField
              isEditMode={edit}
              items={midterm.deploymentPrinciplesForUnits ?? []}
              onChange={(items) => updateMidterm({ deploymentPrinciplesForUnits: items })}
            />
          </FieldBlock>
          <FieldBlock label="事業ポートフォリオの基本方針" show={edit || hasText(midterm.portfolioPolicy)}>
            <TextField
              isEditMode={edit}
              value={midterm.portfolioPolicy}
              onChange={(value) => updateMidterm({ portfolioPolicy: value })}
              variant={variant}
            />
          </FieldBlock>
        </DocSection>
      )}
    </article>
  );
}
