import { signPreview, verifyPreview } from './previewToken';

const SECRET = 'test-secret-for-preview-only';
const KEY = { companyId: 'co-1', strategyId: 'st-1', projectId: 'proj-1' };
const DRAFT = { ok: true, plan: { section1: { purpose: '目的' } }, generatedBy: 'SERVER' };
const NOW = Date.parse('2026-11-13T00:00:00.000Z');

describe('再生成のプレビューの署名', () => {
  it('同じ対象と同じ内容なら、有効期限内は確かめられる', () => {
    const token = signPreview(SECRET, KEY, DRAFT, NOW);
    expect(verifyPreview(SECRET, token, KEY, DRAFT, NOW + 1000)).toBe(true);
  });

  it('案の内容が一つでも変わっていれば通らない（利用者の入力での差し替えを防ぐ）', () => {
    const token = signPreview(SECRET, KEY, DRAFT, NOW);
    expect(verifyPreview(SECRET, token, KEY, { ...DRAFT, plan: { section1: { purpose: '別の目的' } } }, NOW)).toBe(false);
  });

  it('別の会社・戦略・プロジェクトへは使えない', () => {
    const token = signPreview(SECRET, KEY, DRAFT, NOW);
    expect(verifyPreview(SECRET, token, { ...KEY, companyId: 'co-2' }, DRAFT, NOW)).toBe(false);
    expect(verifyPreview(SECRET, token, { ...KEY, strategyId: 'st-2' }, DRAFT, NOW)).toBe(false);
    expect(verifyPreview(SECRET, token, { ...KEY, projectId: 'proj-2' }, DRAFT, NOW)).toBe(false);
  });

  it('別の秘密鍵で作られた署名、改ざんされた署名、期限切れは通らない', () => {
    const token = signPreview(SECRET, KEY, DRAFT, NOW);
    expect(verifyPreview('other-secret', token, KEY, DRAFT, NOW)).toBe(false);
    expect(verifyPreview(SECRET, token.slice(0, -2) + 'xx', KEY, DRAFT, NOW)).toBe(false);
    expect(verifyPreview(SECRET, token, KEY, DRAFT, NOW + 31 * 60 * 1000)).toBe(false);
    expect(verifyPreview(SECRET, 'not-a-token', KEY, DRAFT, NOW)).toBe(false);
  });

  it('JSONの往復（送受信）の後も、同じ内容として確かめられる', () => {
    const token = signPreview(SECRET, KEY, DRAFT, NOW);
    const received = JSON.parse(JSON.stringify(DRAFT)) as Record<string, unknown>;
    expect(verifyPreview(SECRET, token, KEY, received, NOW)).toBe(true);
  });
});
