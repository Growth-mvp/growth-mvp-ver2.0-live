/**
 * @jest-environment jsdom
 */
import { useUserStore } from '@/store/userStore';
import {
  ceoChatOwnerKey,
  clearCeoChat,
  getCeoChatMessages,
  isCeoChatRequestCurrent,
  openCeoChatRequest,
  setCeoChatPending,
  updateCeoChatMessages,
  useCeoChatStore,
} from './ceoChatStore';
import { CEO_CHAT_GREETING } from '@/lib/ceoChat/chatHistory';

function signIn(userId: string, companyId: string) {
  useUserStore.setState({ user: { id: userId } as any, companyId } as any);
}

function signOut() {
  useUserStore.setState({ user: null, companyId: null } as any);
}

function ownerOf(userId: string, companyId: string) {
  return ceoChatOwnerKey(userId, companyId);
}

function appendUser(ticket: ReturnType<typeof openCeoChatRequest>, content: string) {
  updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'user', content }]);
}

beforeEach(() => {
  signOut();
  signIn('user-1', 'company-a');
});

describe('会話履歴ストア: 所有者（userId + companyId）', () => {
  it('同一ユーザー・同一企業の間は、履歴と進行状態を保持する', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, '質問');
    setCeoChatPending(ticket, true);

    useUserStore.setState({ companyId: 'company-a' } as any);

    expect(getCeoChatMessages(ticket).map((m) => m.content)).toEqual([
      CEO_CHAT_GREETING[0].content,
      '質問',
    ]);
    expect(useCeoChatStore.getState().pending).toBe(true);
  });

  it('企業が切り替わると履歴を破棄し、以前の企業のチケットを無効にする', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, 'A社の質問');

    signIn('user-1', 'company-b');

    expect(isCeoChatRequestCurrent(ticket)).toBe(false);
    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
  });

  it('元の企業に戻っても、以前の会話は復元しない', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, 'A社の質問');

    signIn('user-1', 'company-b');
    signIn('user-1', 'company-a');

    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
  });

  it('ユーザーが切り替わると履歴を破棄する', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, '質問');

    signIn('user-2', 'company-a');

    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
    expect(isCeoChatRequestCurrent(ticket)).toBe(false);
  });

  it('ログアウトで履歴を破棄し、同じユーザーで再ログインしても復元しない', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, '質問');

    signOut();
    signIn('user-1', 'company-a');

    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
  });

  it('企業スコープが未確定（companyId が null）になると破棄する', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, '質問');

    useUserStore.setState({ companyId: null } as any);

    expect(isCeoChatRequestCurrent(ticket)).toBe(false);
    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
  });

  it('所有者が一致しない場合はチケットを発行しない', () => {
    expect(openCeoChatRequest(ownerOf('user-1', 'company-b'))).toBeNull();
    expect(openCeoChatRequest(null)).toBeNull();
  });
});

describe('会話履歴ストア: 遅れた応答の破棄', () => {
  it('企業切替後の応答は、新しい企業の履歴に書き込まない', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    signIn('user-1', 'company-b');

    updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: 'A社の回答' }]);
    setCeoChatPending(ticket, false);

    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
  });

  it('クリア後の応答は、クリア後の履歴に書き込まない', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    setCeoChatPending(ticket, true);

    clearCeoChat();
    updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: '遅れた回答' }]);

    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
    expect(useCeoChatStore.getState().pending).toBe(false);
  });
});

describe('会話履歴ストア: クリア', () => {
  it('同じ企業のままクリアすると、履歴と送信状態を初期化し、新しい送信を受け付ける', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, '質問');
    setCeoChatPending(ticket, true);

    clearCeoChat();

    expect(useCeoChatStore.getState().messages).toEqual(CEO_CHAT_GREETING);
    expect(useCeoChatStore.getState().pending).toBe(false);
    expect(openCeoChatRequest(ownerOf('user-1', 'company-a'))).not.toBeNull();
  });
});

describe('会話履歴ストア: 上限', () => {
  it('件数は直近100件までに収める', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    for (let i = 0; i < 150; i++) appendUser(ticket, `発言${i}`);

    const msgs = useCeoChatStore.getState().messages;
    expect(msgs).toHaveLength(100);
    expect(msgs[msgs.length - 1].content).toBe('発言149');
    expect(msgs[0].content).toBe('発言50');
  });

  it('1件の文字数が上限を超える場合は省略する', () => {
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, 'あ'.repeat(9_000));

    const last = useCeoChatStore.getState().messages.slice(-1)[0];
    expect(last.content.length).toBeLessThanOrEqual(8_000);
    expect(last.content).toContain('省略');
  });
});

describe('会話履歴ストア: 保存先', () => {
  it('履歴の更新で localStorage / sessionStorage に書き込まない', () => {
    const local = jest.spyOn(Storage.prototype, 'setItem');
    const ticket = openCeoChatRequest(ownerOf('user-1', 'company-a'));
    appendUser(ticket, '秘密の質問');
    clearCeoChat();

    const written = local.mock.calls.map((c) => String(c[1])).join('\n');
    expect(written).not.toContain('秘密の質問');
    local.mockRestore();
  });
});
