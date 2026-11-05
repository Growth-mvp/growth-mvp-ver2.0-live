import { buildExternalInfoBlock } from './block';
import { resolveCeoWebSearch } from './index';
import { buildSearchInstructions, type CeoFact } from './search';

const NOW = new Date('2026-11-05T00:00:00Z');
const SOURCE = { title: '統計資料', url: 'https://example.com/stat' };

const fact = (over: Partial<CeoFact>): CeoFact => ({
  text: '',
  sources: [SOURCE],
  period: null,
  publishedOn: null,
  kind: null,
  ...over,
});

const recordsOf = (block: string): Record<string, string>[] =>
  block
    .split('\n')
    .filter((l) => l.startsWith('- {'))
    .map((l) => JSON.parse(l.slice(2)));

describe('部分期間の数値を年間実績として表示しない', () => {
  it('2025年1月〜10月の累計は、年間統計と記載されていても通年として扱わない', () => {
    const b = buildExternalInfoBlock({
      status: 'completed',
      facts: [fact({ text: '200L缶の出荷は2.6%減', period: '2025年1月〜10月', kind: 'annual', publishedOn: '2025-12-01' })],
      confirmedOn: '2026-11-05',
    });
    const [r] = recordsOf(b);
    expect(r.対象期間区分).toBe('部分期間（通年実績ではない）');
    expect(r.種別).toMatch(/^その他/);
    expect(r.種別).not.toBe('年間統計');
    expect(r['確度・制約']).toContain('通年実績として扱わない');
    expect(b).toContain('部分期間・月次の数値は、年間の数値と合算・比較・年換算しないでください。');
  });

  it('2025年1月〜12月の暦年の通年は、年間統計として表示する', () => {
    const b = buildExternalInfoBlock({
      status: 'completed',
      facts: [fact({ text: '金属缶の出荷は横ばい', period: '2025年1月〜12月', kind: 'annual' })],
      confirmedOn: '2026-11-05',
    });
    const [r] = recordsOf(b);
    expect(r.対象期間区分).toBe('暦年の通年');
    expect(r.種別).toBe('年間統計');
  });

  it('対象期間が「2025年」だけの年間統計は、通年と断定しない', () => {
    const b = buildExternalInfoBlock({
      status: 'completed',
      facts: [fact({ text: '金属缶の出荷は横ばい', period: '2025年', kind: 'annual' })],
      confirmedOn: '2026-11-05',
    });
    const [r] = recordsOf(b);
    expect(r.対象期間区分).toBe('不明（通年と断定しない）');
    expect(r['確度・制約']).toContain('対象期間の詳細は未確認');
  });
});

describe('製品区分の扱い', () => {
  it('200L缶と18L缶の統計を同じ市場の統計として扱わないよう注意を出す', () => {
    const b = buildExternalInfoBlock({
      status: 'completed',
      facts: [
        fact({ text: '200L缶の出荷は2.6%減', period: '2025年', kind: 'annual' }),
        fact({ text: '18L缶の出荷は増えた', period: '2025年', kind: 'annual' }),
      ],
      confirmedOn: '2026-11-05',
    });
    const records = recordsOf(b);
    expect(records.map((r) => r.対象製品区分)).toEqual(['200L缶', '18L缶']);
    expect(records[0]['確度・制約']).toContain('市場全体の値ではない');
    expect(b).toContain('製品区分の異なる統計は、同一の市場統計として比較・合算しないでください。');
  });

  it('製品区分が本文から確認できない数値は、区分を補わず市場全体の値と断定しない', () => {
    const b = buildExternalInfoBlock({
      status: 'completed',
      facts: [fact({ text: '出荷は2.6%減', period: '2025年', kind: 'annual' })],
      confirmedOn: '2026-11-05',
    });
    const [r] = recordsOf(b);
    expect(r.対象製品区分).toBe('未確認');
    expect(r['確度・制約']).toContain('市場全体の値と断定しない');
    expect(b).not.toContain('金属缶市場全体');
  });
});

describe('回答規則と検索指示', () => {
  it('統計の期間・製品区分の保持、部分期間の非通年化、前年比の禁止を回答規則に含める', () => {
    const b = buildExternalInfoBlock({
      status: 'completed',
      facts: [fact({ text: '金属缶の出荷は横ばい', period: '2025年', kind: 'annual' })],
      confirmedOn: '2026-11-05',
    });
    expect(b).toContain('統計の対象期間と製品区分（例: 200L缶、ペール缶）は、回答でも省略せず正確に保持してください。');
    expect(b).toContain('累計・上半期・四半期・月次などの部分期間の数値を、年間実績や通年の値として説明しないでください。');
    expect(b).toContain('特定の製品区分の統計を、市場全体の増減と断定しないでください。');
    expect(b).toContain('資料に明記されていない前年比・成長率・増減率は書かないでください。');
    expect(b).toContain('数値を比較する場合は、対象期間・製品区分・単位が一致しているかを確認してください。');
  });

  it('検索指示に、期間・集計範囲・製品区分・前年比の制約を含める', () => {
    const s = buildSearchInstructions(NOW);
    expect(s).toContain('対象期間（暦年・年度・月次・四半期・上半期・累計など）と集計範囲');
    expect(s).toContain('累計・上半期・四半期・月次の数値を、年間（通年）の実績として書かないでください。');
    expect(s).toContain('200L缶・ペール缶・18L缶などの製品区分は、事実の文の中に区分名のまま書いてください。');
    expect(s).toContain('前年比・成長率は、資料に明記されている場合だけ書いてください。');
    expect(s).toContain('1月〜10月の累計や上半期など年の一部だけを対象とする数値は、種別を「その他」');
  });
});

describe('診断（件数と状態のみ）', () => {
  const STRATEGY = {
    companyName: '日本製罐株式会社',
    industry: 'manufacturing',
    businessContent: '',
    businessSegments: [
      {
        id: 's-can',
        name: '金属缶事業',
        summary: '金属缶を製造・販売',
        mainProductsServices: ['金属缶'],
        keyCustomers: ['食品メーカー'],
        revenue: 900,
      },
    ],
  } as any;
  const QUESTION = '金属缶市場の最新動向を教えてください。';

  it('期間の区分と製品区分の件数を出し、回答の数値照合用の根拠を保持する（ログ用の値には本文を含めない）', async () => {
    const text =
      '2025年1月〜10月の200L缶の出荷は2.6%減 ｜ 対象期間: 2025年1月〜10月 ｜ 公表日: 不明 ｜ 種別: 年間統計';
    const client = {
      responses: {
        create: jest.fn(async () => ({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text,
                  annotations: [{ type: 'url_citation', url: SOURCE.url, title: SOURCE.title, end_index: text.length - 1 }],
                },
              ],
            },
          ],
        })),
      },
    } as any;

    const r = await resolveCeoWebSearch({ enabled: true, question: QUESTION, strategy: STRATEGY, client });

    expect(r.diagnostics?.statistics).toEqual({
      annual: 0,
      partial: 1,
      monthly: 0,
      unknownPeriod: 0,
      productScopeKnown: 1,
    });
    expect(r.facts.map((f) => f.text).join('\n')).toContain('2.6%減');
    const diag = JSON.stringify(r.diagnostics);
    expect(diag).not.toContain('日本製罐');
    expect(diag).not.toContain(QUESTION);
    expect(diag).not.toContain('2.6%');
  });
});
