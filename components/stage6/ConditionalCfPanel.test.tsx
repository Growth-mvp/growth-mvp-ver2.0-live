import { renderToStaticMarkup } from 'react-dom/server';
import type { ConditionalCf } from '@/utils/stage6/conditionalCf';
import { ConditionalCfPanel } from './ConditionalCfPanel';

const M = 1_000_000;

const cells = (html: string) => [...html.matchAll(/<td class="px-2 py-1[^"]*">([^<]*)<\/td>/g)].map((m) => m[1]);

describe('条件付きCFパネルの表示', () => {
  it('費用削減のみ：営業CF・期末現預金を表示し、既存CF表と名称を分ける', () => {
    const cf: ConditionalCf = {
      debtEnabled: false,
      taxRate: 0.3,
      years: [
        {
          fiscalYear: 2026,
          operatingIncomeYen: 73 * M,
          operatingCf: { conditionalYen: 59.7 * M, baselineYen: 57.6 * M, deltaYen: 2.1 * M },
          investingCfYen: 0,
          financingCfYen: null,
          openingCashYen: 200 * M,
          closingCashYen: 259.7 * M,
          baselineClosingCashYen: 257.6 * M,
          unknownReasons: [],
        },
      ],
    };
    const html = renderToStaticMarkup(<ConditionalCfPanel cf={cf} />);
    expect(html).toContain('条件付きCF試算（確認済み効果のみ）');
    expect(html).toContain('既存のCF表（経営目標への補間）とは別の計算');
    // 手計算：営業利益 73、営業CF 基準 57.6・条件付き 59.7、期首 200、期末 259.7（基準 257.6）、財務CFは借入計画なし
    expect(cells(html).slice(1, 9)).toEqual(['73.0', '57.6', '59.7', '0.0', '未入力', '200.0', '259.7', '257.6']);
  });

  it('売上増加（原価不明）：営業CF・期末現預金は未算定と表示し、0と書かない', () => {
    const cf: ConditionalCf = {
      debtEnabled: false,
      taxRate: 0.3,
      years: [
        {
          fiscalYear: 2026,
          operatingIncomeYen: null,
          operatingCf: { conditionalYen: null, baselineYen: 57.6 * M, deltaYen: null },
          investingCfYen: 0,
          financingCfYen: null,
          openingCashYen: 200 * M,
          closingCashYen: null,
          baselineClosingCashYen: 257.6 * M,
          unknownReasons: ['営業利益が未算定のため、営業CF・期末現預金は算定しない（売上増加の原価が不明）'],
        },
      ],
    };
    const html = renderToStaticMarkup(<ConditionalCfPanel cf={cf} />);
    expect(cells(html).slice(1, 9)).toEqual(['未算定', '57.6', '未算定', '0.0', '未入力', '200.0', '未算定', '257.6']);
    expect(html).toContain('売上増加の原価が不明');
  });

  it('税率が未確定なら、その旨を表示する', () => {
    const cf: ConditionalCf = { debtEnabled: false, taxRate: null, years: [] };
    const html = renderToStaticMarkup(<ConditionalCfPanel cf={cf} />);
    expect(html).toContain('税率が未確定のため営業CFを算定しません');
  });
});
