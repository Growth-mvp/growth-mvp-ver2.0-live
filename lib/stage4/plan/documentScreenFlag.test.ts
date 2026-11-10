import { isStage4DocumentScreenEnabled } from './documentScreenFlag';

const env = process.env as Record<string, string | undefined>;

describe('isStage4DocumentScreenEnabled', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, FLAG: process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN };
  afterEach(() => {
    env.NODE_ENV =saved.NODE_ENV;
    if (saved.FLAG === undefined) delete process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN;
    else process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = saved.FLAG;
  });

  it('フラグが true のときだけ新しい画面を使う（開発環境でも本番ビルドでも同じ条件）', () => {
    env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = 'true';
    expect(isStage4DocumentScreenEnabled()).toBe(true);
    env.NODE_ENV = 'production';
    expect(isStage4DocumentScreenEnabled()).toBe(true);
  });

  it('フラグが無い、または true 以外なら使わない（既定はOFF）', () => {
    env.NODE_ENV = 'production';
    delete process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN;
    expect(isStage4DocumentScreenEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = 'false';
    expect(isStage4DocumentScreenEnabled()).toBe(false);
  });
});
