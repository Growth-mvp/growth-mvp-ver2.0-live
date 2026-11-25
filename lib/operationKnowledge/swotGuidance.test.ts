import { buildOperationGuidance, classifyQuestion } from './guidance';

describe('SWOTの操作案内：現在の画面を前提に、2〜3手順で案内する', () => {
  const QUESTION = 'SWOT分析の操作方法がわからないです';

  it('「操作方法がわからない」質問は、操作案内として扱う', () => {
    expect(classifyQuestion(QUESTION)).toBe('operation');
  });

  it('STAGE2の画面では、SWOTの強み・弱み・機会・脅威の入力と保存を案内する', () => {
    const r = buildOperationGuidance({ screenId: 'stage2', query: QUESTION, role: 'admin' });
    expect(r.operationCount).toBeGreaterThanOrEqual(1);
    expect(r.text).toContain('SWOT分析');
    expect(r.text).toContain('「入力」タブを開き、「SWOT分析」欄を表示する');
    expect(r.text).toContain('強み（S）・弱み（W）・機会（O）・脅威（T）');
    expect(r.text).toContain('保存済み');
    expect(r.text).not.toContain('トップページ');
  });

  it('管理者以外には、STAGE2の編集の操作を案内しない', () => {
    const r = buildOperationGuidance({ screenId: 'stage2', query: QUESTION, role: 'member' });
    expect(r.text).not.toContain('強み（S）・弱み（W）・機会（O）・脅威（T）の欄に');
  });
});
