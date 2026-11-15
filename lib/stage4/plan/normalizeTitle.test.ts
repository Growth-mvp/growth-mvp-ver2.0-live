import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { normalizeKnownDrift, shortenActionTitle } from './normalize';
import { PlanDraftSchema } from './types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('実施事項タイトルの80文字超過（再生成の422）', () => {
  it('80文字以内のタイトルは変えない', () => {
    expect(shortenActionTitle('既存の改装事例3件の改装前後を比べ表にする')).toEqual({ text: '既存の改装事例3件の改装前後を比べ表にする', removed: '' });
  });

  it('区切りの後ろで短くし、前の内容を残す（失う文字は removed に残る）', () => {
    const long = '既存顧客の保守契約の更新対象を一覧にし、更新案内の到達状況を週次で比べ、未到達の理由を三つに分けて整理する。' + '追加の説明'.repeat(8);
    const { text, removed } = shortenActionTitle(long);
    expect(text.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(text)).toBe(true);
    expect(text.endsWith('。') || text.endsWith('、')).toBe(false);
    expect(text + removed).toBe(long);
  });

  it('区切りが無ければ末尾を「…」にし、全体を80文字以内に収める', () => {
    const long = 'あ'.repeat(90);
    const { text } = shortenActionTitle(long);
    expect(text.length).toBeLessThanOrEqual(80);
    expect(text.endsWith('…')).toBe(true);
    expect(long.startsWith(text.slice(0, -1))).toBe(true);
  });

  it('超過したタイトルを正規化すると、スキーマ検証を通り、本文・担当・期限は変わらない', () => {
    const draft = clone(COMMERCIAL_GOLDEN_DRAFT);
    const action = draft.section2.actions[2];
    const original = { ownerRole: action.ownerRole, dueYm: action.dueYm, deliverable: action.deliverable, exitCondition: action.exitCondition };
    action.title = '既存顧客の保守契約の更新対象を一覧にし、更新案内の到達状況を週次で比べ、未到達の理由を三つに分けて整理する。' + '追加の説明'.repeat(8);
    expect(PlanDraftSchema.safeParse(draft).success).toBe(false);
    const normalized = normalizeKnownDrift(draft);
    expect(normalized.applied.map((a) => a.key)).toContain('title');
    const parsed = PlanDraftSchema.safeParse(normalized.json);
    expect(parsed.success).toBe(true);
    const after = (parsed.data as typeof draft).section2.actions[2];
    expect({ ownerRole: after.ownerRole, dueYm: after.dueYm, deliverable: after.deliverable, exitCondition: after.exitCondition }).toEqual(original);
  });
});
