import {
  COMPANION_COOLDOWN_MS,
  COMPANION_MAX_ADVICE_PER_DAY,
  COMPANION_MAX_PER_SESSION,
  canRequestAdvice,
  canRequestRiskReview,
  recordRiskReviewRequested,
  isCompanionKilled,
  localDayKey,
  readCompanionPref,
  recordAdviceRequested,
  recordCompanionShown,
  shouldShowCompanion,
  writeCompanionPref,
  type CompanionStores,
} from './companionPolicy';
import type { CompanionAction } from './companionEngine';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

/** 同じ端末（local は共有）で、タブ（session）を開いた状態 */
function tab(local: ReturnType<typeof memoryStorage>, session = memoryStorage()): CompanionStores {
  return { local, session };
}

const action = (key: string): CompanionAction => ({
  kind: 'progress',
  key,
  title: 't',
  message: 'm',
  href: '/stage1',
  linkLabel: 'l',
  canEdit: true,
  steps: [],
});

// 2026-11-19 10:00（ローカル時刻）
const DAY1 = new Date(2026, 10, 19, 10, 0, 0).getTime();
const DAY1_LATER = new Date(2026, 10, 19, 18, 0, 0).getTime();
const DAY2 = new Date(2026, 10, 20, 9, 0, 0).getTime();

describe('伴走の初期状態と無効化', () => {
  it('利用者の設定が無ければOFF（初期状態）', () => {
    expect(readCompanionPref(memoryStorage(), 'user-1')).toBe(false);
  });

  it('設定をオンにすると、その利用者だけオンになる', () => {
    const s = memoryStorage();
    writeCompanionPref(s, 'user-1', true);
    expect(readCompanionPref(s, 'user-1')).toBe(true);
    expect(readCompanionPref(s, 'user-2')).toBe(false);
  });

  it('環境変数で止められる（true のときだけ止まる）', () => {
    expect(isCompanionKilled('true')).toBe(true);
    expect(isCompanionKilled(undefined)).toBe(false);
    expect(isCompanionKilled('false')).toBe(false);
  });
});

describe('未完了の作業の案内（24時間の固定抑止をしない）', () => {
  it('同じ日なら、別のタブでも、同じ案内は出さない', () => {
    const local = memoryStorage();
    recordCompanionShown(tab(local), 'u', 'co-a', action('ADD_ISSUE:co-a:st-a'), DAY1);
    expect(shouldShowCompanion(tab(local), 'u', 'co-a', action('ADD_ISSUE:co-a:st-a'), DAY1_LATER)).toBe(false);
  });

  it('同じタブを翌日まで開いたままでも、未完了の作業は再び案内される', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    recordCompanionShown(tab(local, session), 'u', 'co-a', action('ADD_ISSUE:co-a:st-a'), DAY1);
    expect(shouldShowCompanion(tab(local, session), 'u', 'co-a', action('ADD_ISSUE:co-a:st-a'), DAY2)).toBe(true);
  });

  it('日付の境界はローカル日付で決まる', () => {
    expect(localDayKey(DAY1)).toBe(localDayKey(DAY1_LATER));
    expect(localDayKey(DAY1)).not.toBe(localDayKey(DAY2));
  });
});

describe('表示の上限と間隔', () => {
  it('直前の案内から1分以内は、別の案内も出さない（連続発話の防止）', () => {
    const s = tab(memoryStorage());
    recordCompanionShown(s, 'u', 'co-a', action('A'), DAY1);
    expect(shouldShowCompanion(s, 'u', 'co-a', action('B'), DAY1 + COMPANION_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldShowCompanion(s, 'u', 'co-a', action('B'), DAY1 + COMPANION_COOLDOWN_MS)).toBe(true);
  });

  it('1セッションで出すのは上限回数まで', () => {
    const s = tab(memoryStorage());
    let now = DAY1;
    for (let i = 0; i < COMPANION_MAX_PER_SESSION; i++) {
      const a = action(`K${i}`);
      expect(shouldShowCompanion(s, 'u', 'co-a', a, now)).toBe(true);
      recordCompanionShown(s, 'u', 'co-a', a, now);
      now += COMPANION_COOLDOWN_MS;
    }
    expect(shouldShowCompanion(s, 'u', 'co-a', action('K-last'), now)).toBe(false);
  });

  it('会社が違えば、履歴も上限も別々に数える（企業の混在を防ぐ）', () => {
    const s = tab(memoryStorage());
    const a = action('GO_STAGE2:co-a:st-a');
    recordCompanionShown(s, 'u', 'co-a', a, DAY1);
    expect(shouldShowCompanion(s, 'u', 'co-b', a, DAY1 + 1)).toBe(true);
  });

  it('利用者が違えば、履歴も別々に数える', () => {
    const s = tab(memoryStorage());
    const a = action('K');
    recordCompanionShown(s, 'user-1', 'co-a', a, DAY1);
    expect(shouldShowCompanion(s, 'user-2', 'co-a', a, DAY1 + 1)).toBe(true);
  });
});

describe('経営助言（AI）の依頼の上限', () => {
  it('同じ節目（同じ内容）では、一度依頼したら翌日も依頼しない', () => {
    const s = tab(memoryStorage());
    expect(canRequestAdvice(s, 'u', 'co-a', 'MILESTONE:CONFIRM:x', DAY1)).toBe(true);
    recordAdviceRequested(s, 'u', 'co-a', 'MILESTONE:CONFIRM:x', DAY1);
    expect(canRequestAdvice(s, 'u', 'co-a', 'MILESTONE:CONFIRM:x', DAY2)).toBe(false);
  });

  it('内容が変われば、別の節目として依頼できる', () => {
    const s = tab(memoryStorage());
    recordAdviceRequested(s, 'u', 'co-a', 'MILESTONE:CONFIRM:x', DAY1);
    expect(canRequestAdvice(s, 'u', 'co-a', 'MILESTONE:CONFIRM:y', DAY1_LATER)).toBe(true);
  });

  it('1日に依頼できるのは上限回数まで（翌日は回復する）', () => {
    const local = memoryStorage();
    for (let i = 0; i < COMPANION_MAX_ADVICE_PER_DAY; i++) {
      recordAdviceRequested(tab(local, memoryStorage()), 'u', 'co-a', `K${i}`, DAY1 + i);
    }
    expect(canRequestAdvice(tab(local, memoryStorage()), 'u', 'co-a', 'NEW', DAY1_LATER)).toBe(false);
    expect(canRequestAdvice(tab(local, memoryStorage()), 'u', 'co-a', 'NEW', DAY2)).toBe(true);
  });

  it('会社が違えば、依頼の回数と履歴も別々に数える', () => {
    const local = memoryStorage();
    recordAdviceRequested(tab(local), 'u', 'co-a', 'K', DAY1);
    expect(canRequestAdvice(tab(local), 'u', 'co-b', 'K', DAY1)).toBe(true);
  });
});

describe('経営点検（STAGE5・6）の依頼：会社ごとに1日1回', () => {
  it('同じ会社・同じ日には、一度依頼したら再び依頼しない。翌日は依頼できる', () => {
    const s = tab(memoryStorage());
    expect(canRequestRiskReview(s, 'u', 'co-a', DAY1)).toBe(true);
    recordRiskReviewRequested(s, 'u', 'co-a', DAY1);
    expect(canRequestRiskReview(s, 'u', 'co-a', DAY1_LATER)).toBe(false);
    expect(canRequestRiskReview(s, 'u', 'co-a', DAY2)).toBe(true);
  });

  it('会社が違えば、依頼の記録は別々に持つ', () => {
    const s = tab(memoryStorage());
    recordRiskReviewRequested(s, 'u', 'co-a', DAY1);
    expect(canRequestRiskReview(s, 'u', 'co-b', DAY1)).toBe(true);
  });
});
