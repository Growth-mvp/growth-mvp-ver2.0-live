import { isLocalStage4DocumentScreen } from './localScreen';

const env = process.env as Record<string, string | undefined>;

describe('isLocalStage4DocumentScreen', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, FLAG: process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN };
  afterEach(() => {
    env.NODE_ENV =saved.NODE_ENV;
    if (saved.FLAG === undefined) delete process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN;
    else process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = saved.FLAG;
  });

  it('開発環境でフラグが true のときだけ新しい画面を使う', () => {
    env.NODE_ENV ='development';
    process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = 'true';
    expect(isLocalStage4DocumentScreen()).toBe(true);
  });

  it('フラグが無い、または true 以外なら使わない', () => {
    env.NODE_ENV ='development';
    delete process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN;
    expect(isLocalStage4DocumentScreen()).toBe(false);
    process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = 'false';
    expect(isLocalStage4DocumentScreen()).toBe(false);
  });

  it('本番ビルドでは、フラグが true でも使わない', () => {
    env.NODE_ENV ='production';
    process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN = 'true';
    expect(isLocalStage4DocumentScreen()).toBe(false);
  });
});
