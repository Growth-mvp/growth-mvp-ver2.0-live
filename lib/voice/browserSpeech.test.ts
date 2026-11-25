import { microphoneErrorMessage, type MicrophoneProbe } from './browserSpeech';

const OK: MicrophoneProbe = { policyAllowed: true, permission: 'granted', device: 'available' };

describe('microphoneErrorMessage：not-allowed の原因に合わせた案内', () => {
  it('ページのポリシーでマイクが禁止されていれば、その案内にする（ブラウザの許可の案内にはしない）', () => {
    const message = microphoneErrorMessage('not-allowed', { ...OK, policyAllowed: false });
    expect(message).toContain('このページではマイクの利用が制限されています');
    expect(message).not.toContain('アドレスバー');
  });

  it('マイクの取得が拒否されていれば、ブラウザの許可の案内にする', () => {
    expect(microphoneErrorMessage('not-allowed', { ...OK, device: 'denied', permission: 'denied' })).toContain('アドレスバー');
    expect(microphoneErrorMessage('not-allowed', { ...OK, device: 'denied', permission: 'prompt' })).toContain('アドレスバー');
  });

  it('マイクは取得できているのに音声認識だけ失敗したら、マイクの許可とは言わない', () => {
    const message = microphoneErrorMessage('not-allowed', OK);
    expect(message).toContain('マイクは使えますが');
    expect(message).not.toContain('許可されていません');
  });

  it('マイクが見つからなければ、接続の案内にする', () => {
    expect(microphoneErrorMessage('not-allowed', { ...OK, device: 'missing' })).toContain('マイクが見つかりません');
  });

  it('切り分けできなかった場合も、マイクの許可と決めつけない', () => {
    const message = microphoneErrorMessage('not-allowed', null);
    expect(message).toBe('音声認識を開始できませんでした。文字でご入力ください。');
  });
});

describe('microphoneErrorMessage：それ以外のエラー', () => {
  it('中断（aborted）は表示しない', () => {
    expect(microphoneErrorMessage('aborted', null)).toBeNull();
  });

  it('既存の案内（音声が聞き取れない・ネットワーク・未知のエラー）は変えない', () => {
    expect(microphoneErrorMessage('no-speech', null)).toBe('音声が聞き取れませんでした。もう一度お試しください。');
    expect(microphoneErrorMessage('network', null)).toBe('音声認識サービスに接続できませんでした。文字でご入力ください。');
    expect(microphoneErrorMessage('something-else', null)).toBe('音声入力でエラーが起きました。文字でご入力ください。');
  });
});
