import { buildPlanData } from '@/utils/export/buildPlanData';
import { buildBankPlanSummary } from './bankPlanSummary';
import { correctHistoricalClaims, type HistoricalFinanceRow } from './historicalClaims';
import { toBusinessWording } from './businessWording';

const base = (extra: Record<string, unknown> = {}) => ({ companyName: 'テスト株式会社', departments: [], ...extra });

describe('内部用語の経営用語への置き換え', () => {
  it('STAGE番号を経営用語に置き換える', () => {
    expect(toBusinessWording('STAGE2の登録目標とSTAGE6の計画経路')).toBe('全社戦略の登録目標と財務計画の計画経路');
    expect(toBusinessWording('STAGE4に確定済みの資本的支出の登録なし')).toBe('実行施策に確定済みの資本的支出の登録なし');
    expect(toBusinessWording('STAGE5/6の確認')).toBe('業績管理・財務計画の確認');
  });

  it('重複した言い回しをまとめ、製品名を除く', () => {
    expect(toBusinessWording('STAGE6の財務計画による計算結果')).toBe('財務計画による計算結果');
    expect(toBusinessWording('GROWTH SHIFT が作成')).toBe(' が作成');
  });

  it('内部用語を含まない文章はそのまま返す', () => {
    const text = '経営課題の分析と改善戦略を示します。';
    expect(toBusinessWording(text)).toBe(text);
  });
});

describe('過去実績の増減・底の記述の事実検査', () => {
  const rows: HistoricalFinanceRow[] = [
    { year: 2023, revenue: 100, operatingIncome: 10, netIncome: 5 },
    { year: 2024, revenue: 90, operatingIncome: 8, netIncome: 4 },
    { year: 2025, revenue: 110, operatingIncome: 12, netIncome: 7 },
  ];

  it('売上高が2023年を底としていない文は、実績表を参照する文に差し替える', () => {
    const out = correctHistoricalClaims('売上高、営業利益、当期純利益が2023年を底として増加しています。', rows);
    expect(out.corrected.length).toBe(1);
    expect(out.text).toBe('売上高、営業利益、当期純利益の過去実績の推移は、実績表のとおりです。');
  });

  it('実績と合う底の記述は変えない', () => {
    const text = '営業利益は2024年を底として増加しています。';
    expect(correctHistoricalClaims(text, rows)).toEqual({ text, corrected: [] });
  });

  it('期間の増減の向きが実績と逆の文は差し替える', () => {
    const wrong = correctHistoricalClaims('売上高は2023年から2025年にかけて減少しました。', rows);
    expect(wrong.corrected.length).toBe(1);
    const right = correctHistoricalClaims('売上高は2023年から2025年にかけて増加しました。', rows);
    expect(right.corrected.length).toBe(0);
  });

  it('実績で確認できない指標の断定は差し替える', () => {
    const noNet = rows.map(({ netIncome, ...r }) => r);
    const out = correctHistoricalClaims('当期純利益は2023年を底として増加しています。', noNet);
    expect(out.corrected.length).toBe(1);
  });

  it('表や見出しは変えず、箇条書きの記号は残す', () => {
    const text = [
      '## 2. 改善戦略',
      '| 売上高 | 2023年を底 |',
      '- 売上高は2023年から2025年にかけて減少しました。',
    ].join('\n');
    const out = correctHistoricalClaims(text, rows).text.split('\n');
    expect(out[0]).toBe('## 2. 改善戦略');
    expect(out[1]).toBe('| 売上高 | 2023年を底 |');
    expect(out[2]).toBe('- 売上高の過去実績の推移は、実績表のとおりです。');
  });

  it('過去実績が無い場合は文章を変えない', () => {
    const text = '売上高は2023年を底として増加しています。';
    expect(correctHistoricalClaims(text, [])).toEqual({ text, corrected: [] });
  });
});

describe('銀行向け冒頭サマリー', () => {
  it('構造化された登録値がない項目は省略し、補完しない', () => {
    const plan = buildPlanData(base(), 'bank');
    const summary = buildBankPlanSummary(plan, undefined);
    expect(summary).toContain('## 経営計画の要約');
    expect(summary).not.toContain('全社戦略');
    expect(summary).not.toContain('事業・部門別の重点戦略');
    expect(summary).not.toContain('未入力');
    expect(summary).not.toContain('先頭');
    expect(summary).not.toMatch(/STAGE\d/);
  });

  it('確定済みの戦略・目標・役割を要約に反映する', () => {
    const plan = buildPlanData(
      base({
        vision: '地域で選ばれる会社',
        departments: [{ name: '営業部', strategicRole: '既存顧客の深耕', projects: [] }],
        companyTargets: [{ label: '売上高', base: 1500, unit: '百万円', dueYear: 2028 }],
        finalStoryFinal: [{ title: '章', body: '当社は地域で選ばれる存在を目指します。利益の改善を進めます。' }],
        stage2FinalDocumentEdits: { conclusion: '既存事業の深耕を進めます。' },
        midtermStrategy: { growthStrategy: '成長A', profitImprovementStrategy: '利益B' },
      }),
      'bank',
    );
    const summary = buildBankPlanSummary(plan, undefined);
    expect(summary).toContain('目指す姿：地域で選ばれる会社');
    expect(summary.indexOf('全社戦略の結論：既存事業の深耕を進めます。')).toBeLessThan(summary.indexOf('目指す姿'));
    expect(summary).toContain('成長戦略：成長A');
    expect(summary).toContain('利益戦略：利益B');
    expect(summary).toContain('- 営業部：既存顧客の深耕');
    expect(summary).toContain('売上高 1500百万円（2028年）（承認状態は未確認）');
  });

  it('個別項目が空のとき、確定ストーリー本文から文章を引用しない', () => {
    const plan = buildPlanData(
      base({
        finalStoryFinal: [
          { title: '章', body: '当社は地域で選ばれる存在を目指します。文化施設事業の業績が悪化しています。資材費が上昇しています。' },
        ],
      }),
      'bank',
    );
    const summary = buildBankPlanSummary(plan, undefined);
    expect(summary).not.toContain('「');
    expect(summary).not.toContain('文化施設事業の業績');
    expect(summary).not.toContain('顧客が当社を選ぶ理由');
    expect(summary).not.toContain('成長戦略');
  });

  it('構造化フィールドに値がある項目は、その値をそのまま示す', () => {
    const plan = buildPlanData(
      base({
        midtermStrategy: { growthStrategy: '既存顧客の深耕による成長', profitImprovementStrategy: '価格・納期の改善' },
        finalStoryFinal: [{ title: '章', body: '本文' }],
      }),
      'bank',
    );
    const summary = buildBankPlanSummary(plan, undefined);
    expect(summary).toContain('成長戦略：既存顧客の深耕による成長');
    expect(summary).toContain('利益戦略：価格・納期の改善');
    expect(summary).not.toContain('顧客が当社を選ぶ理由');
  });
});
