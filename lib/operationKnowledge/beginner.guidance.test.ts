import { buildOperationGuidance, classifyQuestion } from './guidance';
import { getOperation } from './lookup';

/* 初心者の質問による操作案内のテスト。
 * 期待値は、画面の実際の操作（ボタン名・欄名・画面の経路）を基準に手で定義している。 */

const SCREEN_PATH = { stage4: '/okr', stage5: '/execution', stage6: '/stage6' } as const;
const SURFACE_OF_SCREEN: Record<string, RegExp> = {
  stage4: /^(app\/okr\/|components\/okr\/)/,
  stage5: /^(app\/execution\/|components\/stage5\/)/,
  stage6: /^(app\/stage6\/|components\/stage6\/)/,
};
const FORBIDDEN_PHRASES = ['自動で確定', '自動的に確定', '自動で反映', '自動的に反映', '自動で金額', '確定されます', '代わりに確認'];

function operationLines(text: string): { label: string; id: string }[] {
  return [...text.matchAll(/^- 「(.+?)」（([a-z0-9.\-]+)）:/gm)].map((m) => ({ label: m[1], id: m[2] }));
}

describe('初心者の質問：操作案内の内容', () => {
  it.each([
    ['stage4', '財務効果の種類と単位の違いを教えて', ['「効果の種類」', '「金額の単位」']],
    ['stage4', '財務効果は何を入れればいいですか', ['「財務効果の算定根拠（任意）」', '任意']],
    ['stage4', '確認済みとこの案を金額に反映の違いは何ですか', ['「内容を確認し、確認済みにする」', '「この案を金額に反映」', '旧北極星の手動金額']],
    ['stage4', '算定根拠はどう考えればいいですか', ['「算定根拠・出所」']],
    ['stage4', 'この案を金額に反映するとどうなりますか', ['「この案を金額に反映」']],
    ['stage4', '金額が分からない施策はどうすればいいですか', ['任意']],
    ['stage5', 'KRの実績はどこで入力しますか', ['「実績を記録」', '例（架空）']],
    ['stage6', '条件付きPLとCFの見方を教えて', ['「1. 目標に届くか」', '達成可能性']],
    ['stage6', '未算定と出たときはどうすればいいですか', ['「税率」']],
  ])('%s：「%s」に、正しい操作と説明を案内する', (screenId, query, expected) => {
    expect(classifyQuestion(query)).not.toBe('consult');
    const r = buildOperationGuidance({ screenId, query, role: 'member' });
    expect(r.text).toContain(SCREEN_PATH[screenId as keyof typeof SCREEN_PATH]);
    for (const needle of expected) {
      expect({ query, needle, found: r.text.includes(needle) }).toEqual({ query, needle, found: true });
    }
  });
});

describe('初心者の質問：安全・整合（存在しないボタン・勝手な確定を案内しない）', () => {
  const queries: [string, string][] = [
    ['stage4', '財務効果の種類と単位の違いを教えて'],
    ['stage4', '確認済みとこの案を金額に反映の違いは何ですか'],
    ['stage4', '算定根拠はどう考えればいいですか'],
    ['stage5', 'KRの実績はどこで入力しますか'],
    ['stage6', '条件付きPLとCFの見方を教えて'],
    ['stage6', '未算定と出たときはどうすればいいですか'],
  ];

  it.each(queries)('%s「%s」の案内は、登録済みの操作だけを、正しい画面で示す', (screenId, query) => {
    const r = buildOperationGuidance({ screenId, query, role: 'admin' });
    for (const { label, id } of operationLines(r.text)) {
      const op = getOperation(id);
      expect({ id, exists: op !== null, label }).toEqual({ id, exists: true, label });
      expect({ id, label: op?.label }).toEqual({ id, label });
      const surface = SURFACE_OF_SCREEN[op!.screenIds[0] ?? ''];
      if (surface) expect({ id, file: op!.source.file, inSurface: surface.test(op!.source.file) }).toEqual({ id, file: op!.source.file, inSurface: true });
    }
  });

  it.each(queries)('%s「%s」の案内に、勝手な確定・反映を示す文言がない', (screenId, query) => {
    const r = buildOperationGuidance({ screenId, query, role: 'admin' });
    for (const phrase of FORBIDDEN_PHRASES) {
      expect({ query, phrase, found: r.text.includes(phrase) }).toEqual({ query, phrase, found: false });
    }
  });

  it('財務効果の確認は利用者の操作として書く（案内の手順に「自動」で確定させる記述がない）', () => {
    const r = buildOperationGuidance({ screenId: 'stage4', query: '財務効果を確認するにはどうすればいい？', role: 'admin' });
    const confirm = getOperation('stage4.confirm-finance-effect');
    expect(confirm).not.toBeNull();
    expect(confirm!.steps.join('')).toContain('「内容を確認し、確認済みにする」を押す');
    expect(confirm!.steps.join('')).not.toContain('自動');
    expect(r.text).toContain('「内容を確認し、確認済みにする」');
  });
});

describe('初心者の質問：経営相談と操作案内を混同しない', () => {
  it.each([
    '売上を伸ばすには？',
    'この戦略で本当に売上が伸びるの？',
  ])('経営の悩み「%s」は、財務の操作案内にならない', (query) => {
    expect(classifyQuestion(query)).toBe('consult');
    expect(buildOperationGuidance({ screenId: 'stage4', query, role: 'admin' }).text).toBe('');
  });
});
