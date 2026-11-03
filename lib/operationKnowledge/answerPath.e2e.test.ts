import { buildOperationGuidance, classifyQuestion } from './guidance';
import { getOperation } from './lookup';
import { resolveScreenContext } from '@/lib/screens/screenContext';
import { SCREENS } from '@/lib/screens/screenRegistry';

/* 質問分類からプロンプト組み立てまでの経路の検査。
 * app/api/ask-ceo-agent/route.ts の組み立て（現在の画面の行 → 操作案内の連結）と同じ順序で組み立てる。
 * 実OpenAI APIは呼ばない。モデルが生成する文章の品質は、この検査の対象外（未検証）。 */

const BASE_INSTRUCTION = '（基本の指示）';

function composeSystemPrompt(screenRaw: unknown, query: string, role: 'member' | 'manager' | 'admin' = 'member') {
  let systemBase = BASE_INSTRUCTION;
  const screen = resolveScreenContext(screenRaw);
  if (screen) {
    systemBase += `\n\n【現在の画面】${screen.label}（${screen.pathname}）\n操作案内はこの画面の範囲で行う。`;
  }
  const guidance = buildOperationGuidance({ screenId: screen?.screenId ?? null, query, role });
  if (guidance.text) systemBase += '\n\n' + guidance.text;
  return { systemBase, guidance, screen };
}

const STAGE4 = { screenId: 'stage4' };
const STAGE5 = { screenId: 'stage5' };
const STAGE6 = { screenId: 'stage6' };

describe('質問の分類（7つの代表質問）', () => {
  it.each([
    ['財務効果は何を入力すればいい？', 'operation'],
    ['算定根拠って何？', 'operation'],
    ['確認済みと金額に反映の違いは？', 'operation'],
    ['KR実績はどこで入力する？', 'operation'],
    ['条件付きPL・CFって何？', 'operation'],
    ['未算定と出たらどうすればいい？', 'operation'],
    ['売上を伸ばすにはどうすればいい？', 'consult'],
  ])('「%s」は %s', (q, kind) => {
    expect(classifyQuestion(q)).toBe(kind);
  });

  it('操作と経営相談が混在する質問は、複合として両方に対応する', () => {
    expect(classifyQuestion('財務効果は何を入力すればいい？この戦略で売上は伸びる？')).toBe('compound');
    expect(classifyQuestion('KR実績はどこで入力する？利益は本当に伸びる？')).toBe('compound');
  });
});

describe('プロンプト組み立て：操作質問には正しい画面の案内を渡す', () => {
  it('「財務効果は何を入力すればいい？」（STAGE4）→ 財務効果の操作を、現在の画面つきで渡す', () => {
    const { systemBase } = composeSystemPrompt(STAGE4, '財務効果は何を入力すればいい？');
    expect(systemBase).toContain('【現在の画面】STAGE4 現場は何をするのか（/okr）');
    expect(systemBase).toContain('「効果の種類」');
    expect(systemBase).toContain('「金額の単位」');
    expect(systemBase).toContain('任意');
    expect(systemBase).toContain('例（架空）');
  });

  it('「算定根拠って何？」（STAGE4）→ 算定根拠の欄を案内する', () => {
    const { systemBase } = composeSystemPrompt(STAGE4, '算定根拠って何？');
    expect(systemBase).toContain('「算定根拠・出所」');
  });

  it('「確認済みと金額に反映の違いは？」（STAGE4）→ 2つの操作を別物として案内する', () => {
    const { systemBase } = composeSystemPrompt(STAGE4, '確認済みと金額に反映の違いは？');
    expect(systemBase).toContain('「内容を確認し、確認済みにする」');
    expect(systemBase).toContain('「この案を金額に反映」');
    expect(systemBase).toContain('旧北極星の手動金額');
    expect(systemBase).toContain('別の操作');
  });

  it('「KR実績はどこで入力する？」（STAGE5の画面）→ 実績を記録の操作を、実行画面の経路で渡す', () => {
    const { systemBase } = composeSystemPrompt(STAGE5, 'KR実績はどこで入力する？');
    expect(systemBase).toContain('【現在の画面】STAGE5 どうやって前に進めるか（/execution）');
    expect(systemBase).toContain('「実績を記録」');
    expect(systemBase).toContain('例（架空）');
  });

  it('「条件付きPL・CFって何？」（STAGE6）→ 3つのタブの見方を案内し、達成可能性は判定していないと伝える', () => {
    const { systemBase } = composeSystemPrompt(STAGE6, '条件付きPL・CFって何？');
    expect(systemBase).toContain('【現在の画面】STAGE6 成果を確かめる（/stage6）');
    expect(systemBase).toContain('「1. 目標に届くか」');
    expect(systemBase).toContain('達成可能性');
  });

  it('「未算定と出たらどうすればいい？」（STAGE6）→ 不足の前提を入れる欄（税率など）を案内する', () => {
    const { systemBase } = composeSystemPrompt(STAGE6, '未算定と出たらどうすればいい？');
    expect(systemBase).toContain('「税率」');
    expect(systemBase).toContain('「財務計画を保存」で保存する');
  });
});

describe('プロンプト組み立て：経営相談には操作説明を押し付けない', () => {
  it('「売上を伸ばすにはどうすればいい？」→ 操作案内を渡さない（経営相談として扱う）', () => {
    const { systemBase, guidance } = composeSystemPrompt(STAGE4, '売上を伸ばすにはどうすればいい？');
    expect(guidance.text).toBe('');
    expect(systemBase).not.toContain('【操作案内（登録簿に基づく）】');
  });

  it('複合の質問は、操作案内を短く添え、経営判断は通常どおり答えるよう指示する', () => {
    const { systemBase } = composeSystemPrompt(STAGE4, '財務効果は何を入力すればいい？この戦略で売上は伸びる？');
    expect(systemBase).toContain('この質問には経営相談の要素も含まれています');
    expect(systemBase).toMatch(/「(効果の種類|効果の開始月|内容を確認し、確認済みにする|財務効果の算定根拠（任意）)」/);
    expect(systemBase).toContain('経営判断は通常どおり答えてください');
  });
});

describe('プロンプト組み立て：案内の品質（初心者向けの合格基準）', () => {
  const operationQueries: [string, { screenId: string }][] = [
    ['財務効果は何を入力すればいい？', STAGE4],
    ['算定根拠って何？', STAGE4],
    ['確認済みと金額に反映の違いは？', STAGE4],
    ['KR実績はどこで入力する？', STAGE5],
    ['条件付きPL・CFって何？', STAGE6],
    ['未算定と出たらどうすればいい？', STAGE6],
  ];

  it.each(operationQueries)('「%s」：操作名と画面が一致し、手順は3つ以内', (q, screen) => {
    const { guidance } = composeSystemPrompt(screen, q);
    const screenPath = SCREENS.find((s) => s.id === screen.screenId)?.pathname;
    expect(guidance.text).toContain(`（${screenPath}）`);
    const ops = [...guidance.text.matchAll(/^- 「(.+?)」（([a-z0-9.\-]+)）:/gm)].map((m) => ({ label: m[1], id: m[2] }));
    expect(ops.length).toBeGreaterThan(0);
    for (const { label, id } of ops) {
      const op = getOperation(id);
      expect({ id, exists: op !== null, label }).toEqual({ id, exists: true, label });
      expect({ id, label: op?.label }).toEqual({ id, label });
    }
    const stepLines = guidance.text.split('\n').filter((l) => l.startsWith('  手順:'));
    for (const line of stepLines) {
      expect((line.match(/(?:^|\s)\d\. /g) ?? []).length).toBeLessThanOrEqual(3);
    }
  });

  it.each(operationQueries)('「%s」：未確認の内容を確定事項として言わない、と回答原則にある', (q, screen) => {
    const { systemBase } = composeSystemPrompt(screen, q);
    expect(systemBase).toContain('未確認の内容は確定事項として言わない');
    expect(systemBase).toContain('利用者に代わって確認済みにする');
  });

  it('財務効果の案内は、任意の入力を必須と説明しない（「必須」と結びつかない）', () => {
    const { guidance } = composeSystemPrompt(STAGE4, '財務効果は何を入力すればいい？');
    const financeLines = guidance.text.split('\n').filter((l) => l.includes('財務効果'));
    for (const line of financeLines) {
      expect(line).not.toMatch(/必須/);
    }
  });

  it('財務効果の確認を、AIが代わりに行う・金額へ自動反映すると案内しない', () => {
    const { systemBase } = composeSystemPrompt(STAGE4, '財務効果を確認するにはどうすればいい？');
    for (const phrase of ['自動で確定', '自動的に確定', '自動で反映', '自動的に反映', 'AIが確定', 'AIが反映']) {
      expect({ phrase, found: systemBase.includes(phrase) }).toEqual({ phrase, found: false });
    }
    expect(systemBase).toContain('「内容を確認し、確認済みにする」');
    expect(systemBase).toContain('利用者自身が財務効果の内容を確認');
  });

  it('分からないときは無理に入力させない（金額が分からない施策は未設定のままでよい）', () => {
    const { guidance } = composeSystemPrompt(STAGE4, '金額が分からない施策はどうすればいい？');
    expect(guidance.text).toContain('未設定のままでよい');
  });
});

describe('プロンプト組み立て：画面が違っても、質問の対象の画面を案内する', () => {
  it('STAGE1の画面で「財務効果」を聞かれても、財務効果の画面（STAGE4）の操作を案内する', () => {
    const { guidance, systemBase } = composeSystemPrompt({ screenId: 'stage1' }, '財務効果は何を入力すればいい？');
    expect(guidance.screenIds).toEqual(['stage4']);
    expect(systemBase).toContain('「財務効果の算定根拠（任意）」');
  });

  it('画面が特定できないとき、推測で画面を選ばず、尋ね返す案内を渡す', () => {
    const { guidance } = composeSystemPrompt(null, 'このボタンはどこ？');
    expect(guidance.text).toContain('特定できません');
  });
});
