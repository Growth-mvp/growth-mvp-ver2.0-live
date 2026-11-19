/* 自律伴走の表示制御。会社ごとに分け、重複・過剰な案内と助言のAI呼び出しを防ぐ。
 * 保存先は利用者の端末のみ（会話本文は保存しない）。
 * - local：案内を出した日（ローカル日付）、AI助言を依頼した節目と1日の回数、伴走のオン/オフ
 * - session：このタブのセッションで出した回数と最後の時刻（タブを閉じるとリセット）
 * 未完了の作業は、同じ日には繰り返さず、翌日には再び案内する（タブを開いたままでも）。 */

import type { CompanionAction } from './companionEngine';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type CompanionStores = { local: KeyValueStorage; session: KeyValueStorage };

export const COMPANION_MAX_PER_SESSION = 3;
export const COMPANION_COOLDOWN_MS = 60 * 1000;
export const COMPANION_MAX_ADVICE_PER_DAY = 2;

type SessionState = { count: number; lastAt: number };
type AdviceDay = { day: string; count: number };

const PREF_PREFIX = 'growth.ceoCompanion.pref.v1';
const DAY_PREFIX = 'growth.ceoCompanion.days.v1';
const ADVICE_PREFIX = 'growth.ceoCompanion.advice.v1';
const SESSION_PREFIX = 'growth.ceoCompanion.session.v1';

/** 環境変数で伴走を止められる（true のときは利用者の設定に関わらず出さない） */
export function isCompanionKilled(disabledFlag: string | undefined): boolean {
  return disabledFlag === 'true';
}

/** ローカル日付（YYYY-MM-DD）。同じ日かどうかの判定に使う */
export function localDayKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function readCompanionPref(storage: KeyValueStorage, userId: string): boolean {
  try {
    return storage.getItem(`${PREF_PREFIX}:${userId}`) === 'on';
  } catch {
    return false;
  }
}

export function writeCompanionPref(storage: KeyValueStorage, userId: string, on: boolean): void {
  try {
    storage.setItem(`${PREF_PREFIX}:${userId}`, on ? 'on' : 'off');
  } catch {
    /* 保存できなくても、この画面の中では動く */
  }
}

function scoped(prefix: string, userId: string, companyId: string): string {
  return `${prefix}:${userId}:${companyId}`;
}

function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readSession(storage: KeyValueStorage, userId: string, companyId: string): SessionState {
  const parsed = readJson<Partial<SessionState>>(storage, scoped(SESSION_PREFIX, userId, companyId), {});
  return {
    count: typeof parsed.count === 'number' ? parsed.count : 0,
    lastAt: typeof parsed.lastAt === 'number' ? parsed.lastAt : 0,
  };
}

function sessionAllows(storage: KeyValueStorage, userId: string, companyId: string, now: number): boolean {
  const session = readSession(storage, userId, companyId);
  if (session.count >= COMPANION_MAX_PER_SESSION) return false;
  if (session.lastAt > 0 && now - session.lastAt < COMPANION_COOLDOWN_MS) return false;
  return true;
}

/** 今、この案内（操作・進行）を出してよいか。
 * 同じ日には同じ案内を出さない（別のタブ・再ログインでも）。翌日は未完了の作業を再び案内する。 */
export function shouldShowCompanion(
  stores: CompanionStores,
  userId: string,
  companyId: string,
  action: CompanionAction,
  now: number,
): boolean {
  const days = readJson<Record<string, string>>(stores.local, scoped(DAY_PREFIX, userId, companyId), {});
  if (days[action.key] === localDayKey(now)) return false;
  return sessionAllows(stores.session, userId, companyId, now);
}

/** 案内を表示したことを記録する（画面内に見えた時に呼ぶ） */
export function recordCompanionShown(
  stores: CompanionStores,
  userId: string,
  companyId: string,
  action: CompanionAction,
  now: number,
): void {
  try {
    const days = readJson<Record<string, string>>(stores.local, scoped(DAY_PREFIX, userId, companyId), {});
    days[action.key] = localDayKey(now);
    stores.local.setItem(scoped(DAY_PREFIX, userId, companyId), JSON.stringify(days));
    const session = readSession(stores.session, userId, companyId);
    const next: SessionState = { count: session.count + 1, lastAt: now };
    stores.session.setItem(scoped(SESSION_PREFIX, userId, companyId), JSON.stringify(next));
  } catch {
    /* 記録できない環境では、表示は上限と間隔の判定に任せる */
  }
}

/** AI助言を依頼してよいか。同じ節目（同じ内容）では一度だけ、1日の上限を守る。
 * 失敗しても自動では再依頼しない（同じ節目は記録済みになる）。 */
export function canRequestAdvice(
  stores: CompanionStores,
  userId: string,
  companyId: string,
  milestoneKey: string,
  now: number,
): boolean {
  const advised = readJson<Record<string, true>>(stores.local, scoped(ADVICE_PREFIX, userId, companyId), {} as Record<string, true>);
  if (advised[milestoneKey]) return false;
  const day = readJson<AdviceDay>(stores.local, `${scoped(ADVICE_PREFIX, userId, companyId)}:day`, { day: '', count: 0 });
  if (day.day === localDayKey(now) && day.count >= COMPANION_MAX_ADVICE_PER_DAY) return false;
  return true;
}

/** AI助言の依頼を記録する（依頼と同時に呼ぶ。結果が失敗でも節目は使用済みになる） */
export function recordAdviceRequested(
  stores: CompanionStores,
  userId: string,
  companyId: string,
  milestoneKey: string,
  now: number,
): void {
  try {
    const base = scoped(ADVICE_PREFIX, userId, companyId);
    const advised = readJson<Record<string, true>>(stores.local, base, {} as Record<string, true>);
    advised[milestoneKey] = true;
    stores.local.setItem(base, JSON.stringify(advised));
    const today = localDayKey(now);
    const day = readJson<AdviceDay>(stores.local, `${base}:day`, { day: '', count: 0 });
    const next: AdviceDay = day.day === today ? { day: today, count: day.count + 1 } : { day: today, count: 1 };
    stores.local.setItem(`${base}:day`, JSON.stringify(next));
  } catch {
    /* 記録できない環境では、依頼の回数を抑えられないため、表示側で一度の依頼に留める */
  }
}

const RISK_PREFIX = 'growth.ceoCompanion.risk.v1';

/** 経営点検（STAGE5・6）を、この会社で今日まだ依頼していなければ依頼してよい（1日1回） */
export function canRequestRiskReview(stores: CompanionStores, userId: string, companyId: string, now: number): boolean {
  try {
    return stores.local.getItem(scoped(RISK_PREFIX, userId, companyId)) !== localDayKey(now);
  } catch {
    return false;
  }
}

export function recordRiskReviewRequested(stores: CompanionStores, userId: string, companyId: string, now: number): void {
  try {
    stores.local.setItem(scoped(RISK_PREFIX, userId, companyId), localDayKey(now));
  } catch {
    /* 記録できない環境では、依頼は1回の表示に留める（再読み込みで重ねない判定は表示側の保存に任せる） */
  }
}

const ADVICE_TEXT_PREFIX = 'growth.ceoCompanion.adviceText.v1';

/** 依頼済みの助言の本文を、このタブの中でだけ保持する（再読み込み後も再依頼せずに読めるように） */
export function readAdviceText(session: KeyValueStorage, userId: string, companyId: string, milestoneKey: string): string | null {
  const map = readJson<Record<string, string>>(session, scoped(ADVICE_TEXT_PREFIX, userId, companyId), {});
  return typeof map[milestoneKey] === 'string' ? map[milestoneKey] : null;
}

export function writeAdviceText(session: KeyValueStorage, userId: string, companyId: string, milestoneKey: string, text: string): void {
  try {
    const key = scoped(ADVICE_TEXT_PREFIX, userId, companyId);
    const map = readJson<Record<string, string>>(session, key, {});
    map[milestoneKey] = text.slice(0, 4000);
    session.setItem(key, JSON.stringify(map));
  } catch {
    /* 保存できない環境では、再読み込み後は助言を表示しない（再依頼もしない） */
  }
}
