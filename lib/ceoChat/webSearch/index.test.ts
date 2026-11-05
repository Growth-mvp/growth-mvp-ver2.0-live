import { isCeoWebSearchEnabled, resolveCeoWebSearch } from './index';

const createMock = jest.fn();
const client = { responses: { create: (...args: unknown[]) => createMock(...args) } } as never;

const STRATEGY = {
  companyName: 'テスト株式会社',
  industry: 'it',
  businessContent: 'SaaSを提供',
  businessSegments: [],
};

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: '業務用ソフトウェアの需要は増加している。',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://example.com/saas',
                title: 'SaaS市場',
                start_index: 0,
                end_index: '業務用ソフトウェアの需要は増加している。'.length,
              },
            ],
          },
        ],
      },
    ],
  });
});

describe('環境変数による有効化（既定OFF）', () => {
  it.each([[undefined], [''], ['false'], ['TRUE'], ['1'], ['yes']])('%p はOFF扱い', (v) => {
    expect(isCeoWebSearchEnabled(v)).toBe(false);
  });

  it("'true' だけをONにする", () => {
    expect(isCeoWebSearchEnabled('true')).toBe(true);
  });
});

describe('検索の入口（判定ごとの呼び出し有無）', () => {
  it('OFFのときは判定もAPI呼び出しもせず、ブロックを追加しない', async () => {
    const r = await resolveCeoWebSearch({
      enabled: false,
      question: '金属缶市場の最新動向を教えて',
      strategy: STRATEGY,
      client,
    });
    expect(r.block).toBe('');
    expect(r.category).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('社内情報だけの質問（A）では、ONでもAPIを呼ばない', async () => {
    const r = await resolveCeoWebSearch({
      enabled: true,
      question: '営業部門の実行計画を評価して',
      strategy: STRATEGY,
      client,
    });
    expect(r.block).toBe('');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('外部情報が必要な質問（B）では、ONのとき1回だけ検索し、出典つきブロックを返す', async () => {
    const r = await resolveCeoWebSearch({
      enabled: true,
      question: '最新の法改正が業界に与える影響は何か',
      strategy: STRATEGY,
      client,
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.category).toBe('B');
    expect(r.status).toBe('completed');
    expect(r.sourceCount).toBe(1);
    expect(r.block).toContain('https://example.com/saas');
  });

  it('公開情報だけで検索条件を作れない場合は検索せず、その旨をブロックに残す', async () => {
    const r = await resolveCeoWebSearch({
      enabled: true,
      question: '最新の法改正が当社に与える影響は何か',
      strategy: { companyName: 'テスト株式会社', industry: 'other', businessContent: '', businessSegments: [] },
      client,
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(r.status).toBe('skipped_no_scope');
    expect(r.skipReason).toBe('no_public_scope');
    expect(r.block).toContain('公開情報だけでは検索条件を作れなかった');
  });
});
