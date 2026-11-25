import { judgeSearchNeed, sanitizePublicQuery } from './judge';
import { buildSearchInstructions } from './search';

const clientReturning = (content: string) =>
  ({ chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content } }] })) } } }) as never;

describe('外部検索の意味判定（judgeSearchNeed）', () => {
  it('判定結果を読み取り、軽量モデルの設定で一度だけ呼ぶ', async () => {
    const create = jest.fn(async (_params: unknown) => ({
      choices: [{ message: { content: '{"needsExternal":true,"scope":"general","publicQuery":"日経平均株価 本日 終値"}' } }],
    }));
    const r = await judgeSearchNeed({ chat: { completions: { create } } } as never, '本日の日経平均の終値は？');
    expect(r).toEqual({ needsExternal: true, scope: 'general', publicQuery: '日経平均株価 本日 終値' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('形式が合わない応答は null にする（呼び出し側がキーワード判定に戻る）', async () => {
    expect(await judgeSearchNeed(clientReturning('{"needsExternal":"yes"}'), 'x')).toBeNull();
    expect(await judgeSearchNeed(clientReturning('OK'), 'x')).toBeNull();
  });

  it('呼び出しが失敗したときは null にする', async () => {
    const client = { chat: { completions: { create: jest.fn(async () => Promise.reject(new Error('down'))) } } } as never;
    expect(await judgeSearchNeed(client, 'x')).toBeNull();
  });

  it('判定に使える chat がないクライアントでも、例外にせず null にする', async () => {
    expect(await judgeSearchNeed({} as never, 'x')).toBeNull();
  });
});

describe('検索語句の検査（sanitizePublicQuery）', () => {
  it('一般の公開語句はそのまま使う（空白は整える）', () => {
    expect(sanitizePublicQuery(' トヨタ自動車  最新 決算 ', '秘密商事株式会社')).toBe('トヨタ自動車 最新 決算');
  });

  it('登録企業の名称を含む語句は使わない（株式会社の有無も同じ扱い）', () => {
    expect(sanitizePublicQuery('秘密商事 最新業績', '秘密商事株式会社')).toBeNull();
    expect(sanitizePublicQuery('秘密商事 最新業績', '')).toBe('秘密商事 最新業績');
  });

  it('会社への言及を含む語句・URL・空・長すぎる語句は使わない', () => {
    expect(sanitizePublicQuery('当社の業界 市場規模', '')).toBeNull();
    expect(sanitizePublicQuery('https://example.com 日経', '')).toBeNull();
    expect(sanitizePublicQuery('   ', '')).toBeNull();
    expect(sanitizePublicQuery('あ'.repeat(81), '')).toBeNull();
  });
});

describe('検索の指示（用途ごと）', () => {
  it('一般の検索は、業界に限定しない指示にする', () => {
    const general = buildSearchInstructions(new Date('2026-11-25T00:00:00Z'), 'general');
    expect(general).toContain('特定の会社や業界に限定せず');
    expect(general).not.toContain('指定された業界・市場分類の公開情報だけ');
  });

  it('市場の検索は従来どおり、業界・市場分類に限定する指示にする', () => {
    const market = buildSearchInstructions(new Date('2026-11-25T00:00:00Z'));
    expect(market).toContain('指定された業界・市場分類の公開情報だけ');
    expect(market).toContain('本日は2026-11-25です');
  });
});
