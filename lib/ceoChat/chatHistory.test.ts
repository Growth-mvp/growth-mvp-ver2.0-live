import {
  ASK_HISTORY_MAX_CHARS,
  ASK_HISTORY_MAX_MESSAGES,
  buildAskHistory,
  CEO_CHAT_MAX_MESSAGE_CHARS,
  CEO_CHAT_MAX_MESSAGES,
  CEO_CHAT_MAX_TOTAL_CHARS,
  enforceChatLimits,
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
