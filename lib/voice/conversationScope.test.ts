import { isVoiceStagePath, keepsVoiceOnPathChange } from './conversationScope';

describe('音声会話を続けてよい画面移動', () => {
  it('STAGE1〜4の画面は、音声会話の対象になる', () => {
    ['/stage1', '/stage2', '/stage3', '/cascade', '/stage4', '/okr'].forEach((p) => expect(isVoiceStagePath(p)).toBe(true));
    expect(isVoiceStagePath('/okr/detail')).toBe(true);
  });

  it('STAGE1〜4の間の移動は会話を続け、それ以外へ出るときは止める', () => {
    expect(keepsVoiceOnPathChange('/stage1', '/stage2')).toBe(true);
    expect(keepsVoiceOnPathChange('/stage2', '/cascade')).toBe(true);
    expect(keepsVoiceOnPathChange('/stage4', '/stage1')).toBe(true);
    expect(keepsVoiceOnPathChange('/stage1', '/login')).toBe(false);
    expect(keepsVoiceOnPathChange('/stage1', '/')).toBe(false);
    expect(keepsVoiceOnPathChange('/stage2', '/admin/members')).toBe(false);
    expect(keepsVoiceOnPathChange(null, '/stage1')).toBe(false);
  });

  it('似た名前の別画面は、STAGE画面として扱わない', () => {
    expect(isVoiceStagePath('/stage10')).toBe(false);
    expect(isVoiceStagePath('/stage1-old')).toBe(false);
  });
});
