import { isVoiceDisabledFor, readAutoRead, readVoiceConsent, toSpeakableText, writeAutoRead, writeVoiceConsent } from './voiceSettings';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as unknown as Storage;
}

describe('isVoiceDisabledFor', () => {
  it('既定では全社で有効', () => {
    expect(isVoiceDisabledFor('company-a', undefined, undefined)).toBe(false);
  });

  it('全体の停止フラグが true なら無効', () => {
    expect(isVoiceDisabledFor('company-a', 'true', undefined)).toBe(true);
  });

  it('指定した会社だけ無効にできる（カンマ区切り・空白を許容）', () => {
    expect(isVoiceDisabledFor('company-b', undefined, ' company-a , company-b ')).toBe(true);
    expect(isVoiceDisabledFor('company-c', undefined, 'company-a,company-b')).toBe(false);
  });

  it('会社が未確定のときは会社単位の無効化を判定しない', () => {
    expect(isVoiceDisabledFor(null, undefined, 'company-a')).toBe(false);
  });
});

describe('音声の利用設定', () => {
  it('同意と読み上げは利用者ごとに保存し、初期値は未同意・読み上げOFF', () => {
    const storage = memoryStorage();
    expect(readVoiceConsent(storage, 'user-1')).toBe(false);
    expect(readAutoRead(storage, 'user-1')).toBe(false);

    writeVoiceConsent(storage, 'user-1');
    writeAutoRead(storage, 'user-1', true);
    expect(readVoiceConsent(storage, 'user-1')).toBe(true);
    expect(readVoiceConsent(storage, 'user-2')).toBe(false);
    expect(readAutoRead(storage, 'user-1')).toBe(true);

    writeAutoRead(storage, 'user-1', false);
    expect(readAutoRead(storage, 'user-1')).toBe(false);
  });
});

describe('toSpeakableText', () => {
  it('Markdownの記号・URL・診断表示を読み上げ用に取り除く', () => {
    const md = [
      '## 結論',
      '**売上**が伸びています。[詳細](https://example.com/a)を確認してください。',
      '- 配送の見直し',
      '1. 価格を確認',
      '`STAGE1`を開く',
      '| 項目 | 値 |',
      '[debug] mode=facilitator',
    ].join('\n');
    const text = toSpeakableText(md);
    expect(text).toBe('結論 売上が伸びています。詳細を確認してください。 配送の見直し 価格を確認 STAGE1を開く 項目 値');
  });
});
