/**
 * @jest-environment jsdom
 */
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { StrategyStoryPreview } from './StrategyStoryPreview';
import type { MidtermStrategy, StoryChapter } from '@/types/strategy';

const story: StoryChapter[] = [
  { title: '第1章：なぜ今、変わる必要があるのか', body: '第1章の本文です。\n\n二段落目です。' },
  { title: '第2章：どこで、どう勝つのか', body: '第2章の本文です。' },
  { title: '第3章：どんな未来を実現するのか', body: '第3章の本文です。' },
  { title: '第4章：その実現に向けてどう行動するのか', body: '第4章の本文です。' },
];

const midterm: MidtermStrategy = {
  midtermConcept: '成長領域へ資源を集中する',
  targetVisionForMidterm: '顧客から選ばれる専門企業',
  priorityStrategicThemes: ['新規顧客の開拓', '収益構造の転換'],
  companyWideDecisionCriteria: ['成長領域への投資を優先する'],
  deploymentPrinciplesForUnits: ['部門KPIは全社目標から展開する'],
  portfolioPolicy: '主力事業は収益を維持する',
};

const financialTargets = {
  revenue: { label: '売上', base: 12000, unit: '百万円', dueYear: 2029 },
  operatingProfit: { label: '営業利益', base: 1500, unit: '百万円', dueYear: 2029 },
};

const FIXED_TEXTS = [
  'KEY MESSAGE',
  'Key Message',
  'Strategic Implications',
  'Next Questions',
  'Downstream Design',
  '次のステップ',
  '社員に伝えたい',
  '既存市場の延長では',
  '中期経営計画本文の主役',
];

function renderPreview(mode: 'screen' | 'pdf') {
  return render(
    <StrategyStoryPreview
      story={story}
      finalized
      companyName="テスト株式会社"
      midtermStrategy={midterm}
      financialTargets={financialTargets}
      conclusionDraft="確定した結論です。"
      assumptionsDraft={{ external: ['市場の成長'], internal: [], implications: [] }}
      mode={mode}
    />,
  );
}

describe('StrategyStoryPreview（全社戦略書）', () => {
  it('画面とPDFで同じ確定内容を描画する', () => {
    const screenView = renderPreview('screen');
    const screenText = screenView.container.textContent;
    screenView.unmount();

    const pdfView = renderPreview('pdf');
    const pdfText = pdfView.container.textContent;
    pdfView.unmount();

    expect(pdfText).toBe(screenText);
  });

  it('全社戦略書の構成と確定内容を含み、固定の補助文は含まない', () => {
    const { container } = renderPreview('pdf');
    const text = container.textContent ?? '';

    expect(text).toContain('全社戦略書');
    expect(text).toContain('テスト株式会社');
    expect(text).toContain('状態：確定版');
    expect(text).toContain('確定した結論です。');
    expect(text).toContain('市場の成長');
    expect(text).toContain('成長領域へ資源を集中する');
    expect(text).toContain('新規顧客の開拓');
    expect(text).toContain('第1章：なぜ今、変わる必要があるのか');
    expect(text).toContain('第4章：その実現に向けてどう行動するのか');
    expect(text).toContain('成長領域への投資を優先する');
    expect(text).toContain('部門KPIは全社目標から展開する');
    FIXED_TEXTS.forEach((fixed) => expect(text).not.toContain(fixed));
  });

  it('数値目標は保存された値・単位・年度をそのまま表示する', () => {
    const { container } = renderPreview('pdf');
    const text = container.textContent ?? '';

    expect(text).toContain('12,000 百万円');
    expect(text).toContain('1,500 百万円');
    expect(text).toContain('2029年度');
    expect(text).not.toContain('対象年度');
  });

  it('未登録の数値目標や結論は推測で補完しない', () => {
    const { container } = render(
      <StrategyStoryPreview story={story} finalized={false} companyName="テスト株式会社" mode="pdf" />,
    );
    const text = container.textContent ?? '';

    expect(text).not.toContain('数値目標');
    expect(text).not.toContain('（未入力）');
    expect(text).not.toContain('対象年度');
    expect(text).toContain('状態：ドラフト（未確定）');
    expect(text).not.toContain('12,000');
  });
});

describe('箇条書きの編集', () => {
  function EditableHarness() {
    const [assumptionsDraft, setAssumptionsDraft] = useState<{ external: string[]; internal: string[]; implications: string[] }>({
      external: ['市場の成長'],
      internal: [],
      implications: [],
    });
    return (
      <StrategyStoryPreview
        story={story}
        finalized={false}
        companyName="テスト株式会社"
        midtermStrategy={midterm}
        assumptionsDraft={assumptionsDraft}
        isEditMode
        onAssumptionsChange={setAssumptionsDraft}
      />
    );
  }

  it('Enterで改行を入力でき、入力途中の改行が消えない', () => {
    render(<EditableHarness />);
    const textarea = screen.getByDisplayValue('市場の成長') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: '市場の成長\n' } });
    expect(textarea.value).toBe('市場の成長\n');

    fireEvent.change(textarea, { target: { value: '市場の成長\n人口減少' } });
    expect(textarea.value).toBe('市場の成長\n人口減少');
  });
});
