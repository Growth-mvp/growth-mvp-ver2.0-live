import {
  ASK_HISTORY_MAX_CHARS,
  ASK_HISTORY_MAX_MESSAGES,
  buildAskHistory,
  CEO_CHAT_MAX_MESSAGE_CHARS,
  CEO_CHAT_MAX_MESSAGES,
  CEO_CHAT_MAX_TOTAL_CHARS,
  CEO_CHAT_RETENTION_MS,
  enforceChatLimits,
  parseCeoChatSnapshot,
  type CeoChatMessage,
} from './chatHistory';

function msgs(count: number, size = 10): CeoChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${i}`.padEnd(size, 'x'),
  }));
}

describe('enforceChatLimits', () => {
  it('件数の上限を超えたら古い履歴から削除する', () => {
    const kept = enforceChatLimits(msgs(CEO_CHAT_MAX_MESSAGES + 5));
    expect(kept).toHaveLength(CEO_CHAT_MAX_MESSAGES);
    expect(kept[0].content.startsWith('5x')).toBe(true);
  });

  it('1件の文字数上限を超える内容は切り詰める', () => {
    const [m] = enforceChatLimits([{ role: 'assistant', content: 'a'.repeat(CEO_CHAT_MAX_MESSAGE_CHARS + 100) }]);
    expect(m.content.length).toBe(CEO_CHAT_MAX_MESSAGE_CHARS);
  });

  it('総文字数の上限を超えたら古い履歴から削除する', () => {
    const big = Array.from({ length: 50 }, () => ({
      role: 'assistant' as const,
      content: 'b'.repeat(CEO_CHAT_MAX_MESSAGE_CHARS),
    }));
    const kept = enforceChatLimits(big);
    const total = kept.reduce((s, m) => s + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(CEO_CHAT_MAX_TOTAL_CHARS);
    expect(kept.length).toBeLessThan(big.length);
  });

  it('上限内の履歴は変更しない', () => {
    const input = msgs(3);
    expect(enforceChatLimits(input)).toEqual(input);
  });
});

describe('buildAskHistory', () => {
  it('直近の件数だけを、古い順を保って返す', () => {
    const input = msgs(30);
    const picked = buildAskHistory(input);
    expect(picked).toHaveLength(ASK_HISTORY_MAX_MESSAGES);
    expect(picked).toEqual(input.slice(-ASK_HISTORY_MAX_MESSAGES));
  });

  it('文字数の上限を超える古い履歴は送らない', () => {
    const input = [
      { role: 'user' as const, content: 'old'.repeat(3_000) },
      { role: 'assistant' as const, content: 'x'.repeat(4_000) },
      { role: 'user' as const, content: 'y'.repeat(4_000) },
    ];
    const picked = buildAskHistory(input);
    const total = picked.reduce((s, m) => s + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(ASK_HISTORY_MAX_CHARS);
    expect(picked[picked.length - 1]).toEqual(input[2]);
    expect(picked).not.toContainEqual(input[0]);
  });

  it('空の履歴は空で返す', () => {
    expect(buildAskHistory([])).toEqual([]);
  });
});

describe('parseCeoChatSnapshot', () => {
  const now = Date.UTC(2026, 10, 4);
  const valid = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: 1,
      ownerKey: 'user-1|company-a',
      savedAt: now - 1000,
      messages: [{ role: 'user', content: '質問' }, { role: 'assistant', content: '回答' }],
      ...overrides,
    });

  it('有効な保存分を読み込む', () => {
    const snap = parseCeoChatSnapshot(valid(), now);
    expect(snap?.ownerKey).toBe('user-1|company-a');
    expect(snap?.messages).toHaveLength(2);
  });

  it('壊れたJSON・未知の版・空の履歴は捨てる', () => {
    expect(parseCeoChatSnapshot('{x', now)).toBeNull();
    expect(parseCeoChatSnapshot(valid({ v: 2 }), now)).toBeNull();
    expect(parseCeoChatSnapshot(valid({ messages: [] }), now)).toBeNull();
    expect(parseCeoChatSnapshot(null, now)).toBeNull();
  });

  it('30日を過ぎたもの、未来の時刻のものは捨てる', () => {
    const old = now - CEO_CHAT_RETENTION_MS - 1;
    expect(parseCeoChatSnapshot(valid({ savedAt: old }), now)).toBeNull();
    expect(parseCeoChatSnapshot(valid({ savedAt: now + 60_000 }), now)).toBeNull();
  });

  it('不正な発言を除き、上限を適用する', () => {
    const snap = parseCeoChatSnapshot(
      valid({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: '残す' }] }),
      now
    );
    expect(snap?.messages).toEqual([{ role: 'user', content: '残す' }]);
  });
});
