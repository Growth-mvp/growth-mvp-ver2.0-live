import agentPrompt, { CONSULT_BEHAVIOR, CONSULT_ROLE, buildAgentSystemPrompt } from './agentPrompt';

const LEGACY_ROLE_HEAD = 'あなたは経営者の参謀であり、経営の議論相手です。';
const LEGACY_BEHAVIOR_HEAD = '- 経験豊富な経営コンサルタントとして、経営者と対話する';

describe('通常の相談の役割定義と振る舞い', () => {
  it('役割定義は指定された文章である', () => {
    expect(CONSULT_ROLE.startsWith('あなたは、経営者や社員が気軽に相談できる、親しみやすく優秀な経営コンサルタントです。')).toBe(true);
    expect(CONSULT_ROLE).toContain('まず相手が何を尋ねているのかを理解し');
    expect(CONSULT_ROLE).toContain('相手の考えや問題意識が重要な場合は');
  });

  it('役割定義を渡すと、先頭に新しい文章が入り、従来の役割定義は入らない', () => {
    const p = buildAgentSystemPrompt({} as any, [], [], CONSULT_ROLE);
    expect(p.startsWith(CONSULT_ROLE + '\n')).toBe(true);
    expect(p).not.toContain(LEGACY_ROLE_HEAD);
  });

  it('振る舞いを渡すと、通常相談の振る舞いに置き換わり、従来の振る舞いは入らない', () => {
    const p = buildAgentSystemPrompt({} as any, [], [], CONSULT_ROLE, CONSULT_BEHAVIOR);
    expect(p).toContain(CONSULT_BEHAVIOR);
    expect(p).not.toContain(LEGACY_BEHAVIOR_HEAD);
    expect(p).toContain('出所「STAGE1登録」と明記');
    expect(p).toContain('【外部決算情報の扱い】');
    expect(p.split('【振る舞い規範】').length - 1).toBe(1);
  });

  it('振る舞いを渡さない既存の呼び出しは、従来の役割・振る舞いのまま', () => {
    const p = agentPrompt({} as any, [], []);
    expect(p.startsWith(LEGACY_ROLE_HEAD)).toBe(true);
    expect(p).toContain(LEGACY_BEHAVIOR_HEAD);
    expect(p).not.toContain('親しみやすく、気軽に何でも相談できる');
  });

  it('役割・振る舞い以外（会社情報・データの扱い）は変わらない', () => {
    const fromCompany = (x: string) => x.slice(x.indexOf('【会社の前提】'), x.indexOf('【振る舞い規範】'));
    expect(fromCompany(buildAgentSystemPrompt({} as any, [], [], CONSULT_ROLE, CONSULT_BEHAVIOR))).toBe(
      fromCompany(agentPrompt({} as any, [], []))
    );
  });
});
