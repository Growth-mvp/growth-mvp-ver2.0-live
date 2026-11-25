import { isVoiceDisabledFor, readAutoRead, writeAutoRead } from './voiceSettings';

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

describe('回答の自動読み上げの設定', () => {
  it('利用者ごとに保存し、初期値は読み上げOFF', () => {
    const storage = memoryStorage();
    expect(readAutoRead(storage, 'user-1')).toBe(false);

    writeAutoRead(storage, 'user-1', true);
    expect(readAutoRead(storage, 'user-1')).toBe(true);
    expect(readAutoRead(storage, 'user-2')).toBe(false);

    writeAutoRead(storage, 'user-1', false);
    expect(readAutoRead(storage, 'user-1')).toBe(false);
  });
});
