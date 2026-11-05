import { allowedSourceUrls, verifyAnswerUrls } from './sourceCheck';
import type { CeoFact } from './search';

const fact = (urls: string[]): CeoFact => ({
  text: '事実',
  sources: urls.map((url) => ({ title: 'T', url })),
  period: null,
  publishedOn: null,
  kind: null,
});

const ALLOWED = ['https://example.com/can-2025', 'https://example.org/report'];
const APP = 'https://growth-mvp-ver2-0-live.vercel.app';

describe('許可リストの作成', () => {
  it('検索結果の出典URLを、正規化して保持する', () => {
    const list = allowedSourceUrls([fact(['https://example.com/a?utm_source=x&id=1'])]);
    expect(list).toEqual(['https://example.com/a?id=1']);
  });

  it('https 以外・エラーページの出典は許可しない', () => {
    const list = allowedSourceUrls([fact(['http://example.com/a', 'https://example.com/404.html', 'https://example.com/ok'])]);
    expect(list).toEqual(['https://example.com/ok']);
  });

  it('同じURLは1件にまとめる', () => {
    const list = allowedSourceUrls([fact(['https://example.com/a']), fact(['https://example.com/a'])]);
    expect(list).toEqual(['https://example.com/a']);
  });
});

describe('回答本文のURL照合', () => {
  it('許可リストにあるURLは、そのまま残す', () => {
    const r = verifyAnswerUrls('出典: https://example.com/can-2025', ALLOWED);
    expect(r).toEqual({ content: '出典: https://example.com/can-2025', removed: 0 });
  });

  it('検索結果にないURLは、出典として表示しない', () => {
    const r = verifyAnswerUrls('根拠は https://made-up.example.net/report です。', ALLOWED);
    expect(r.content).toBe('根拠は （未確認のURLを除外） です。');
    expect(r.removed).toBe(1);
  });

  it('似たパスや別のホストは、許可リストと一致しないので除外する', () => {
    const r = verifyAnswerUrls('https://example.com/can-2024 と https://example.com/can-2025/extra', ALLOWED);
    expect(r.removed).toBe(2);
    expect(r.content).not.toContain('https://');
  });

  it('http のURLは、同じホストでも許可しない', () => {
    const r = verifyAnswerUrls('http://example.com/can-2025', ALLOWED);
    expect(r.removed).toBe(1);
  });

  it('追跡パラメータ付きのURLは、許可リストの正規化形に置き換える', () => {
    const r = verifyAnswerUrls('https://example.com/can-2025?utm_medium=email', ALLOWED);
    expect(r.content).toBe('https://example.com/can-2025');
    expect(r.removed).toBe(0);
  });

  it('文末の句読点は、URLと切り分けて残す', () => {
    const r = verifyAnswerUrls('https://example.com/can-2025。次の文', ALLOWED);
    expect(r.content).toBe('https://example.com/can-2025。次の文');
  });

  it('自社サイトのリンクは削除しない', () => {
    const text = `詳しくは ${APP}/stage2 を参照`;
    const r = verifyAnswerUrls(text, [], [APP]);
    expect(r.content).toBe(text);
    expect(r.removed).toBe(0);
  });

  it('社内の相対リンクやURLを含まない文は変更しない', () => {
    const text = '/stage1 を参照してください。';
    expect(verifyAnswerUrls(text, [])).toEqual({ content: text, removed: 0 });
  });

  it('許可リストが空なら、外部のURLはすべて除外する', () => {
    const r = verifyAnswerUrls('https://example.com/a と https://example.org/b', []);
    expect(r.removed).toBe(2);
    expect(r.content).toBe('（未確認のURLを除外） と （未確認のURLを除外）');
  });
});
