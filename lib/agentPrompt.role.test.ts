import agentPrompt, { CONSULT_ROLE, buildAgentSystemPrompt } from './agentPrompt';

const LEGACY_ROLE_HEAD = 'あなたは経営者の参謀であり、経営の議論相手です。';

describe('通常の相談の役割定義', () => {
  it('指定された文章である', () => {
    expect(CONSULT_ROLE).toBe(
      'あなたは、企業の経営情報を深く理解した、親しみやすく話しやすい経営コンサルタントです。経営者や社員のよき相談相手として自然に対話しながら、問題の本質を一緒に考えます。親しみやすくても迎合せず、必要なときは率直に異論を述べ、専門的な分析や具体策も提供してください。'
    );
  });

  it('役割定義を渡すと、先頭に新しい文章が入り、従来の役割定義は入らない', () => {
    const p = buildAgentSystemPrompt({} as any, [], [], CONSULT_ROLE);
    expect(p.startsWith(CONSULT_ROLE + '\n')).toBe(true);
    expect(p).not.toContain(LEGACY_ROLE_HEAD);
  });

  it('役割定義を渡さない既存の呼び出しは、従来の役割定義のまま', () => {
    const p = agentPrompt({} as any, [], []);
    expect(p.startsWith(LEGACY_ROLE_HEAD)).toBe(true);
    expect(p).not.toContain('親しみやすく話しやすい');
  });

  it('役割定義の部分以外（会社情報・振る舞い規範・データの扱い）は変わらない', () => {
    const fromCompany = (x: string) => x.slice(x.indexOf('【会社の前提】'));
    expect(fromCompany(buildAgentSystemPrompt({} as any, [], [], CONSULT_ROLE))).toBe(fromCompany(agentPrompt({} as any, [], [])));
  });
});
