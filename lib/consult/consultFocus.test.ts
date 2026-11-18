import { consultBlockFor, consultPayloadFor, consultPromptBlock, ConsultFocusSchema, type ConsultFocusEntry } from './consultFocus';

const stage2Screen = { pathname: '/stage2', area: 'stage' };
const orgScreen = { pathname: '/org-transformation', area: 'org' };
const names = new Set(['営業部']);

describe('consultBlockFor（相談の文脈の照合）', () => {
  it('未保存の回答を、保存状態と質問の意図つきで渡す', () => {
    const block = consultBlockFor(
      {
        pathname: '/stage2',
        stage: 2,
        question: { id: 'ch0-q1', title: '3〜5年後の顧客の困りごと', intent: '顧客の課題を特定する' },
        draft: { text: '配送の遅れが増えている', saved: false },
      },
      stage2Screen,
      names,
    );
    expect(block).toContain('段階：STAGE2');
    expect(block).toContain('質問：3〜5年後の顧客の困りごと');
    expect(block).toContain('質問の意図：顧客の課題を特定する');
    expect(block).toContain('入力中の回答（未保存）：');
    expect(block).toContain('<入力中の回答>\n配送の遅れが増えている\n</入力中の回答>');
    expect(block).toContain('正式な戦略データではありません');
  });

  it('組織変革ルームの文脈は渡さない', () => {
    expect(consultBlockFor({ pathname: '/org-transformation', draft: { text: '個人の話', saved: true } }, orgScreen, names)).toBe('');
  });

  it('画面が一致しない文脈は捨てる', () => {
    expect(consultBlockFor({ pathname: '/cascade', draft: { text: 'x', saved: true } }, stage2Screen, names)).toBe('');
    expect(consultBlockFor({ pathname: '/stage2' }, null, names)).toBe('');
  });

  it('戦略の部門に無い部門名は落とし、残りの文脈は使う', () => {
    const block = consultBlockFor(
      { pathname: '/cascade', stage: 3, departmentName: '存在しない部門', question: { title: '役まわり' } },
      { pathname: '/cascade', area: 'stage' },
      names,
    );
    expect(block).not.toContain('存在しない部門');
    expect(block).toContain('質問：役まわり');
  });

  it('入力中の回答は上限で切り詰め、保存済みは保存済みと表示する', () => {
    const parsed = ConsultFocusSchema.parse({
      pathname: '/cascade',
      draft: { text: 'あ'.repeat(3000), saved: true },
    });
    expect(parsed.draft?.text).toHaveLength(1200);
    expect(consultPromptBlock(parsed)).toContain('入力中の回答（保存済み）');
  });
});

describe('consultPayloadFor（送信時の文脈の選択）', () => {
  const entry: ConsultFocusEntry = {
    pathname: '/stage2',
    stage: 2,
    question: { title: '質問A' },
    draft: { text: '途中の回答', saved: false },
    strategyId: 's-1',
  };

  it('画面と戦略が一致する文脈だけを返し、戦略ID自体は送らない', () => {
    const payload = consultPayloadFor({ 'stage2-questions': entry }, '/stage2', 's-1');
    expect(payload).toEqual({ pathname: '/stage2', stage: 2, question: { title: '質問A' }, draft: { text: '途中の回答', saved: false } });
    expect(payload).not.toHaveProperty('strategyId');
  });

  it('画面を離れた・戦略が違う場合は文脈を返さない', () => {
    expect(consultPayloadFor({ 'stage2-questions': entry }, '/cascade', 's-1')).toBeUndefined();
    expect(consultPayloadFor({ 'stage2-questions': entry }, '/stage2', 's-2')).toBeUndefined();
    expect(consultPayloadFor({}, '/stage2', 's-1')).toBeUndefined();
  });

  it('組織変革ルームの画面からは文脈を送らない', () => {
    const orgEntry = { ...entry, pathname: '/org-transformation' };
    expect(consultPayloadFor({ x: orgEntry }, '/org-transformation', 's-1')).toBeUndefined();
  });
});
