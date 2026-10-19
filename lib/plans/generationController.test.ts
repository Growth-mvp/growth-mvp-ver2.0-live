import { GenerationController } from './generationController';

const KEY_A = 'company-a|strategy-a|bank';
const KEY_B = 'company-b|strategy-b|bank';

describe('GenerationController（生成中の会社切替）', () => {
  it('clears the generating state when the company switches during generation', () => {
    const c = new GenerationController();
    const token = c.start(KEY_A);

    expect(token).not.toBeNull();
    expect(c.isGeneratingFor(KEY_A)).toBe(true);

    c.scopeChanged();

    expect(c.isBusy()).toBe(false);
    expect(c.isGeneratingFor(KEY_A)).toBe(false);
    expect(c.isGeneratingFor(KEY_B)).toBe(false);
  });

  it('allows generating in the new company right after switching', () => {
    const c = new GenerationController();
    const oldToken = c.start(KEY_A);
    c.scopeChanged();

    const newToken = c.start(KEY_B);

    expect(newToken).not.toBeNull();
    expect(c.isCurrent(newToken as number)).toBe(true);
    expect(c.isGeneratingFor(KEY_B)).toBe(true);
    expect(c.isCurrent(oldToken as number)).toBe(false);
  });

  it('does not show the old company result in the new company', () => {
    const c = new GenerationController();
    const oldToken = c.start(KEY_A) as number;
    c.scopeChanged();

    // 旧会社の応答は、画面に反映してはいけない
    expect(c.isCurrent(oldToken)).toBe(false);
  });

  it('keeps the new company generating state when the old request finishes late', () => {
    const c = new GenerationController();
    const oldToken = c.start(KEY_A) as number;
    c.scopeChanged();
    const newToken = c.start(KEY_B) as number;

    // 旧リクエストの finally が、新会社の生成中状態を壊さない
    c.finish(oldToken);

    expect(c.isGeneratingFor(KEY_B)).toBe(true);
    expect(c.isCurrent(newToken)).toBe(true);
    expect(c.isBusy()).toBe(true);
  });

  it('rejects the old result even when switching back to the same company', () => {
    const c = new GenerationController();
    const oldToken = c.start(KEY_A) as number;
    c.scopeChanged(); // B へ
    c.scopeChanged(); // A へ戻る

    expect(c.isCurrent(oldToken)).toBe(false);
    expect(c.isBusy()).toBe(false);
    expect(c.start(KEY_A)).not.toBeNull();
  });

  it('blocks double submission within the same scope', () => {
    const c = new GenerationController();
    const first = c.start(KEY_A);
    const second = c.start(KEY_A);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('releases the state on normal completion', () => {
    const c = new GenerationController();
    const token = c.start(KEY_A) as number;

    expect(c.isCurrent(token)).toBe(true);
    c.finish(token);

    expect(c.isBusy()).toBe(false);
    expect(c.start(KEY_A)).not.toBeNull();
  });

  it('does not clear a newer generation when a stale token finishes', () => {
    const c = new GenerationController();
    const first = c.start(KEY_A) as number;
    c.finish(first);
    const second = c.start(KEY_A) as number;

    c.finish(first); // 既に終わった古いトークン

    expect(c.isBusy()).toBe(true);
    expect(c.isCurrent(second)).toBe(true);
  });
});
