// /utils/supabase/ancillary.ts
// 役割: strategy_data から分離されている「章回答(answers2)」「最終ストーリー(final_stories)」
//      「進捗ログ(progress_logs)」の保存/読取のみを扱う補助モジュール。
// ポリシー:
//  - company_id は必須（NULL company_id への保存・読取はしない）
//  - ブラウザ（クライアント）からは呼び出さない（Service Role Key を利用するため）
//  - レガシーテーブル(financesummary / business_portfolio / simulationresults 等)は一切触らない
//  - JSONB への書込は常に JSON として行い、互換フォールバックを保持
//  - 書込は UPSERT(onConflict: company_id,user_id) を基本形に統一

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCompanyIdFromCookie, setCompanyIdCookie, isValidUUID } from './client';
import { debugExtractPostgrest, isInvalidJsonSyntax } from './errors';
import { normalizeChaptersAny } from './normalize';
import { getMembership } from './membership';
import type { ChapterAnswers, ChapterStory } from '@/types/strategy';

const T_ANSWERS2 = 'story_answers2';
const T_LOGS = 'progress_logs';
const T_FINAL = 'final_stories';

/* ======================= 実行ガード（サーバ専用） ======================= */
function assertServerOnly() {
  // 誤ってブラウザから呼び出された場合は即時エラーにする
  if (typeof window !== 'undefined') {
    throw new Error('[ancillary] This module must not be called from the browser.');
  }
}

/* ======================= 共通: 管理者クライアント ======================= */
function createAdminClient(): SupabaseClient {
  assertServerOnly();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    throw new Error('Supabase server env missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (...args) => fetch(...args) },
  });
}

/* ---------------------- 共通: companyId 解決（厳格） ---------------------- */
/**
 * ★ 修正：membership.company_id を唯一の源泉に
 *
 * 旧実装：Cookie → membership の順序（Cookie優先）
 * 新実装：membership → Cookie の順序（membership優先）
 */
async function resolveCompanyIdStrict(userId: string): Promise<string> {
  // 1) Membership から company_id を取得（唯一の源泉）
  const m = await getMembership(userId);
  if (isValidUUID(m?.companyId)) {
    const membershipCompanyId = m.companyId!;

    // 2) Cookie は「補助用」のみ（古い値の上書きなど）
    try {
      const c = getCompanyIdFromCookie();
      if (isValidUUID(c) && c !== membershipCompanyId) {
        // Cookie が古い値の場合は上書き
        setCompanyIdCookie(membershipCompanyId);
      } else if (!c) {
        // Cookie が無い場合は設定
        setCompanyIdCookie(membershipCompanyId);
      }
    } catch {
      // Cookie 操作エラーは無視
    }

    return membershipCompanyId;
  }

  // 厳格化: ここまでで解決できなければ失敗
  throw new Error('companyId を解決できません（Strict）。Membership を確認してください。');
}

/* ======================= story_answers2 ======================= */
/** 章別回答を保存（company_id,user_id で UPSERT） */
export async function saveStoryAnswers2(
  userId: string,
  answers2: ChapterAnswers[],
): Promise<Error | null> {
  const db = createAdminClient();
  try {
    if (!userId) return new Error('invalid userId');

    const companyId = await resolveCompanyIdStrict(userId);
    const now = new Date().toISOString();

    // JSONB 安全: まずはそのまま、ダメなら stringify フォールバック
    let up = await db
      .from(T_ANSWERS2)
      .upsert(
        [{ user_id: userId, company_id: companyId, answers2, updated_at: now, created_at: now }],
        { onConflict: 'company_id,user_id' }
      );
    if (up.error && isInvalidJsonSyntax(up)) {
      up = await db
        .from(T_ANSWERS2)
        .upsert(
          [{
            user_id: userId,
            company_id: companyId,
            answers2: JSON.stringify(answers2 ?? []),
            updated_at: now,
            created_at: now
          }],
          { onConflict: 'company_id,user_id' }
        );
    }
    if (up.error) {
      console.error('❌ saveStoryAnswers2:', debugExtractPostgrest(up.error));
      return up.error as any;
    }
    return null;
  } catch (error) {
    console.error('❌ saveStoryAnswers2 fatal:', debugExtractPostgrest(error));
    return error as any;
  }
}

/** 章別回答を読取（company_id,user_id で単一行） */
export async function loadStoryAnswers2(userId: string): Promise<ChapterAnswers[] | null> {
  const db = createAdminClient();
  try {
    if (!userId) return [];
    const companyId = await resolveCompanyIdStrict(userId);

    const r = await db
      .from(T_ANSWERS2)
      .select('answers2')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!r.error && r.data) {
      let result: unknown = (r.data as any).answers2;
      if (typeof result === 'string') {
        try { result = JSON.parse(result); } catch { result = []; }
      }
      if (!Array.isArray(result)) result = [];
      return result as ChapterAnswers[];
    }
    return [];
  } catch (e) {
    console.error('❌ loadStoryAnswers2 fatal:', debugExtractPostgrest(e));
    return null;
  }
}

/* ======================= progress_logs ======================= */
type ProgressLogInput = {
  progressText?: string;
  rating?: number;
  ratingComment?: string;
  advice?: string;
  helpRequest?: string;
  department?: string;
};

/** 進捗ログを company_id 付きで挿入（NULL company 禁止） */
export async function saveProgressLog(
  userId: string,
  okrId: string,
  log: ProgressLogInput,
): Promise<Error | null> {
  const db = createAdminClient();
  try {
    if (!userId || !isValidUUID(okrId)) return new Error('invalid userId or okrId');
    const companyId = await resolveCompanyIdStrict(userId);
    const now = new Date().toISOString();

    const rows = [{
      user_id: userId,
      okr_id: okrId,
      company_id: companyId,
      progress_text: log.progressText ?? '',
      rating: typeof log.rating === 'number' ? log.rating : null,
      rating_comment: log.ratingComment ?? '',
      advice: log.advice ?? '',
      help_request: log.helpRequest ?? '',
      department: log.department ?? '',
      created_at: now,
    }];

    const ins = await db.from(T_LOGS).insert(rows);
    if (ins.error) {
      console.error('❌ saveProgressLog:', debugExtractPostgrest(ins.error));
      return ins.error as any;
    }
    return null;
  } catch (error) {
    console.error('❌ saveProgressLog fatal:', debugExtractPostgrest(error));
    return error as any;
  }
}

/* ======================= final_stories ======================= */
/** 最終ストーリーを保存（company_id,user_id で UPSERT） */
export async function saveFinalStory(
  userId: string,
  story: ChapterStory[],
  summary: string,
): Promise<Error | null> {
  const db = createAdminClient();
  try {
    if (!userId) return new Error('invalid userId');
    const companyId = await resolveCompanyIdStrict(userId);
    const normalized = normalizeChaptersAny(story ?? []);
    const now = new Date().toISOString();

    let up = await db
      .from(T_FINAL)
      .upsert(
        [{
          user_id: userId,
          company_id: companyId,
          story: normalized,
          summary,
          updated_at: now,
          created_at: now,
        }],
        { onConflict: 'company_id,user_id' }
      );
    if (up.error && isInvalidJsonSyntax(up)) {
      up = await db
        .from(T_FINAL)
        .upsert(
          [{
            user_id: userId,
            company_id: companyId,
            story: JSON.stringify(normalized ?? []),
            summary,
            updated_at: now,
            created_at: now,
          }],
          { onConflict: 'company_id,user_id' }
        );
    }
    if (up.error) {
      console.error('❌ saveFinalStory UPSERT:', debugExtractPostgrest(up.error));
      return up.error as any;
    }
    return null;
  } catch (error) {
    console.error('❌ saveFinalStory fatal:', debugExtractPostgrest(error));
    return error as any;
  }
}

/** 最終ストーリーを読取（company_id,user_id で単一行） */
export async function loadFinalStory(userId: string): Promise<ChapterStory[] | null> {
  const db = createAdminClient();
  try {
    if (!userId) return [];
    const companyId = await resolveCompanyIdStrict(userId);

    const r = await db
      .from(T_FINAL)
      .select('story')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!r.error && r.data) {
      return normalizeChaptersAny((r.data as any).story ?? []);
    }
    return [];
  } catch (e) {
    console.error('❌ loadFinalStory fatal:', debugExtractPostgrest(e));
    return null;
  }
}

/* ======================= 便利系（サーバ専用） ======================= */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const db = createAdminClient();
  if (!email) return null;
  try {
    const u = await db.from('users').select('id').ilike('email', email).maybeSingle();
    if (!u.error && (u.data as any)?.id) return String((u.data as any).id);
  } catch {}
  try {
    const p = await db.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (!p.error && (p.data as any)?.id) return String((p.data as any).id);
  } catch {}
  return null;
}
