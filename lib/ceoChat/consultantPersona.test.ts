import { CONSULTANT_PERSONA, HELP_TONE } from './consultantPersona';
import { decideAnswerStyle } from './answerStyle';

const style = (userText: string) => decideAnswerStyle({ userText, hasPriorAssistantTurn: false });

describe('人柄の定義', () => {
  it('受け止め・見解・異論・御社の呼び方を含む（利用者との対話で共通）', () => {
    expect(CONSULTANT_PERSONA).toContain('受け止めは経営判断への同意ではない');
    expect(CONSULTANT_PERSONA).toContain('必要なときは異論を唱える');
    expect(CONSULTANT_PERSONA).toContain('相談先の会社は「御社」と呼ぶ');
  });

  it('会話例は固定テンプレートではないと明記し、例の企業情報を別企業の事実として扱わない', () => {
    expect(CONSULTANT_PERSONA).toContain('固定テンプレートではない');
    expect(CONSULTANT_PERSONA).toContain('別の企業の事実として使わない');
  });

  it('操作案内の話し方は、画面や手順の禁則を優先すると明記する', () => {
    expect(HELP_TONE).toContain('上記の禁則を優先する');
  });
});

describe('詳細モードの判定は、明確な依頼だけに限る', () => {
  it.each([
    '売上と営業利益の推移を分析してください',
    '宅配1件あたりの採算はどう計算すればよいでしょうか',
    '実行計画を作ってください',
    '詳しく説明してください',
  ])('詳細を依頼する：%s', (q) => {
    expect(style(q)).toBe('detailed');
  });

  it.each([
    '売上の数値はいくらですか',
    '営業部と製造部の目標を比較するとどうなりますか',
    '一覧を見るにはどこを押しますか',
  ])('単語だけでは詳細にしない：%s', (q) => {
    expect(style(q)).not.toBe('detailed');
  });
});
