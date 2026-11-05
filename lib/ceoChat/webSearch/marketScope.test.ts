import { selectMarketScope } from './marketScope';
import { resolveCeoWebSearch } from './index';

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
    {
      id: 's-estate',
      name: '不動産賃貸事業',
      summary: 'オフィスの不動産賃貸',
      mainProductsServices: ['不動産賃貸'],
      keyCustomers: ['テナント'],
      revenue: 50,
    },
  ],
};

const METAL_Q = '金属缶市場の最新動向を教えてください。特に高付加価値缶の需要と競合企業の動きを知りたいです。';

describe('質問に応じた市場の選択', () => {
  it('1. 金属缶市場の質問では、不動産賃貸市場を検索対象にしない', () => {
    const s = selectMarketScope({ question: METAL_Q, strategy: STRATEGY });
    expect(s.mode).toBe('focused');
    if (s.mode !== 'focused') return;
    expect(s.categoryIds).toContain('p_metal_can');
    expect(s.categoryIds).not.toContain('p_real_estate_leasing');
    expect(s.input).not.toContain('不動産');
  });

  it('2. 不動産賃貸市場の質問では、不動産市場を検索対象にする', () => {
    const s = selectMarketScope({ question: '不動産賃貸市場の空室率と賃料の動向を教えて', strategy: STRATEGY });
    expect(s.mode).toBe('focused');
    if (s.mode !== 'focused') return;
    expect(s.categoryIds).toContain('p_real_estate_leasing');
    expect(s.categoryIds).not.toContain('p_metal_can');
  });

  it('3. 全社・全事業の市場環境の質問では、全事業を対象にする', () => {
    expect(selectMarketScope({ question: '当社全体の市場環境はどうか', strategy: STRATEGY })).toEqual({
      mode: 'all',
      reason: 'company_wide',
    });
    expect(selectMarketScope({ question: 'すべての事業の市場動向を教えて', strategy: STRATEGY })).toEqual({
      mode: 'all',
      reason: 'company_wide',
    });
  });

  it('4. 原材料・物流・規制などの横断的な質問では、必要な関連市場を除外しない（全事業）', () => {
    const logistics = selectMarketScope({ question: '原材料価格と物流コストの動向を教えて', strategy: STRATEGY });
    expect(logistics).toEqual({ mode: 'all', reason: 'cross_cutting' });
    const regulation = selectMarketScope({ question: '環境規制の強化は当社にどう影響するか', strategy: STRATEGY });
    expect(regulation).toEqual({ mode: 'all', reason: 'cross_cutting' });
  });

  it('5. 対象事業が曖昧な質問では、一つの事業に無理に限定しない', () => {
    expect(selectMarketScope({ question: 'この先どう進めるべきか相談したい', strategy: STRATEGY })).toEqual({
      mode: 'all',
      reason: 'unspecified',
    });
  });

  it('6. 複数の事業を指定した質問では、両方を対象にする', () => {
    const s = selectMarketScope({ question: '金属缶市場と不動産賃貸市場の両方の動向を比べたい', strategy: STRATEGY });
    expect(s.mode).toBe('focused');
    if (s.mode !== 'focused') return;
    expect(s.categoryIds).toEqual(expect.arrayContaining(['p_metal_can', 'p_real_estate_leasing']));
  });

  it('7. 検索に送る入力は公開分類のラベルだけで、質問の語を含まない', () => {
    const q = `${METAL_Q}ヒミツ案件XYZ`;
    const s = selectMarketScope({ question: q, strategy: STRATEGY });
    expect(s.mode).toBe('focused');
    if (s.mode !== 'focused') return;
    expect(s.input).not.toContain('ヒミツ案件XYZ');
    expect(s.input).not.toContain('高付加価値缶');
    expect(s.input).not.toContain('競合企業の動き');
  });
});

describe('検索処理への反映と診断情報（件数と状態のみ）', () => {
  it('金属缶の質問では、検索の入力に不動産の市場を含めず、診断に市場分類IDを出す', async () => {
    const sent: string[] = [];
    const client = {
      responses: {
        create: jest.fn(async (params: { input: string }) => {
          sent.push(params.input);
          return {
            output: [
              { type: 'web_search_call', status: 'completed', id: 'ws', action: { type: 'search' } },
              { type: 'message', content: [{ type: 'output_text', text: '金属缶の出荷は横ばいだった。', annotations: [] }] },
            ],
          };
        }),
      },
    } as any;
    const r = await resolveCeoWebSearch({ enabled: true, question: METAL_Q, strategy: STRATEGY, client });
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('不動産');
    expect(r.diagnostics?.marketScope).toMatchObject({ mode: 'focused', reason: 'explicit_market' });
    expect(r.diagnostics?.marketScope.categoryIds).toContain('p_metal_can');
    expect(r.diagnostics?.marketScope.count).toBeGreaterThan(0);
    expect(JSON.stringify(r.diagnostics)).not.toContain('日本製罐');
    expect(JSON.stringify(r.diagnostics)).not.toContain(METAL_Q);
  });

  it('全社の質問では、全事業の市場を対象とし、理由コードを出す', async () => {
    const client = {
      responses: {
        create: jest.fn(async () => ({
          output: [{ type: 'message', content: [{ type: 'output_text', text: '市場は横ばいだった。', annotations: [] }] }],
        })),
      },
    } as any;
    const r = await resolveCeoWebSearch({
      enabled: true,
      question: '当社全体の市場環境を教えて',
      strategy: STRATEGY,
      client,
    });
    expect(r.diagnostics?.marketScope).toMatchObject({ mode: 'all', reason: 'company_wide' });
  });
});
