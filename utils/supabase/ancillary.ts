// /utils/supabase/ancillary.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCompanyIdFromCookie, setCompanyIdCookie, isValidUUID } from './client';
import { debugExtractPostgrest, isInvalidJsonSyntax } from './errors';
import { normalizeChaptersAny } from './normalize';
import { getMembership } from './membership';
import type { ChapterAnswers, ChapterStory } from '@/types/strategy';

const T_ANSWERS2 = 'story_answers2';
const T_LOGS = 'progress_logs';
const T_FINAL = 'final_stories';

/* ======================= 共通: 管理者クライアント ======================= */
/** サーバー専用：Service Role で毎回生成（RLSやCookieに依存しない） */
function createAdminClient(): SupabaseClient {
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

/* ---------------------- 共通: companyId 解決 ---------------------- */
async function resolveCompanyId(userId: string): Promise<string | null> {
  try {
    const c = getCompanyIdFromCookie();
    if (c) return c;
  } catch {
    /* noop */
  }
  try {
    const m = await getMembership(userId);
    if (m.companyId) {
      try {
        setCompanyIdCookie(m.companyId);
      } catch {
        /* noop */
      }
      return m.companyId;
    }
  } catch {
    /* noop */
  }
  return null;
}

/* ======================= story_answers2 ======================= */

/** 回答を保存（会社単位で保存。fallback: user単位） */
export async function saveStoryAnswers2(userId: string, answers2: ChapterAnswers[]): Promise<Error | null> {
  const db = createAdminClient();
  try {
    if (!userId) return new Error('invalid userId');

    const companyId = await resolveCompanyId(userId);
    const payload = { user_id: userId, answers2 };

    if (companyId) {
      // company_id + user_id で upsert
      let ins = await db.from(T_ANSWERS2).upsert([{ ...payload, company_id: companyId }], {
        onConflict: 'company_id,user_id',
      });

      // JSON型エラー時は stringify フォールバック
      if (ins.error && isInvalidJsonSyntax(ins)) {
        ins = await db
          .from(T_ANSWERS2)
          .upsert(
            [{ ...payload, company_id: companyId, answers2: JSON.stringify(answers2 ?? []) }],
            { onConflict: 'company_id,user_id' },
          );
      }

      if (ins.error) {
        console.error('❌ saveStoryAnswers2 company:', debugExtractPostgrest(ins.error));
        return ins.error as any;
      }
      return null;
    }

    // 会社未所属：user基準で upsert（UNIQUE(user_id) 前提）
    let ins2 = await db.from(T_ANSWERS2).upsert([payload], { onConflict: 'user_id' });

    if (ins2.error && isInvalidJsonSyntax(ins2)) {
      ins2 = await db
        .from(T_ANSWERS2)
        .upsert([{ user_id: userId, answers2: JSON.stringify(answers2 ?? []) }], { onConflict: 'user_id' });
    }

    if (ins2.error) {
      console.error('❌ saveStoryAnswers2 legacy:', debugExtractPostgrest(ins2.error));
      return ins2.error as any;
    }
    return null;
  } catch (error) {
    console.error('❌ saveStoryAnswers2 fatal:', debugExtractPostgrest(error));
    return error as any;
  }
}

/** 回答を取得（会社優先 → 互換の user 単位）。なければ空配列を返す */
export async function loadStoryAnswers2(userId: string): Promise<ChapterAnswers[] | null> {
  const db = createAdminClient();
  try {
    if (!userId) return [];

    const companyId = await resolveCompanyId(userId);
    if (companyId) {
      const r1 = await db
        .from(T_ANSWERS2)
        .select('answers2')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!r1.error && r1.data) {
        let result: unknown = (r1.data as any).answers2;
        if (typeof result === 'string') {
          try {
            result = JSON.parse(result);
          } catch {
            result = [];
          }
        }
        if (!Array.isArray(result)) result = [];
        return result as ChapterAnswers[];
      }
    }

    // 互換（company_id IS NULL）
    const r2 = await db
      .from(T_ANSWERS2)
      .select('answers2')
      .eq('user_id', userId)
      .is('company_id', null)
      .maybeSingle();

    if (!r2.error && r2.data) {
      let result: unknown = (r2.data as any).answers2;
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result);
        } catch {
          result = [];
        }
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

/** 進捗ログを追加（必ず company_id を付与） */
export async function saveProgressLog(
  userId: string,
  okrId: string,
  log: ProgressLogInput,
): Promise<Error | null> {
  const db = createAdminClient();
  try {
    if (!userId || !isValidUUID(okrId)) {
      return new Error('invalid userId or okrId');
    }
    const companyId = await resolveCompanyId(userId);
    const now = new Date().toISOString();

    const rows = [
      {
        user_id: userId,
        okr_id: okrId,
        company_id: companyId ?? null, // RLS設計に依存。NULL可のスキーマなら許容
        progress_text: log.progressText ?? '',
        rating: typeof log.rating === 'number' ? log.rating : null,
        rating_comment: log.ratingComment ?? '',
        advice: log.advice ?? '',
        help_request: log.helpRequest ?? '',
        department: log.department ?? '',
        created_at: now,
      },
    ];

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

/** 最終ストーリーを保存（user×company で1件に収める） */
export async function saveFinalStory(userId: string, story: ChapterStory[], summary: string): Promise<Error | null> {
  const db = createAdminClient();
  try {
    if (!userId) return new Error('invalid userId');

    const companyId = await resolveCompanyId(userId);
    const normalized = normalizeChaptersAny(story);
    const now = new Date().toISOString();

    if (companyId) {
      // 既存行の有無を company_id + user_id で確認
      const found = await db
        .from(T_FINAL)
        .select('id')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (found.data?.id) {
        // UPDATE（JSON型不整合に備えフォールバックあり）
        let up = await db
          .from(T_FINAL)
          .update({ story: normalized, summary, updated_at: now })
          .eq('id', found.data.id)
          .select('id')
          .single();

        if (up.error && isInvalidJsonSyntax(up)) {
          up = await db
            .from(T_FINAL)
            .update({ story: JSON.stringify(normalized ?? []), summary, updated_at: now })
            .eq('id', found.data.id)
            .select('id')
            .single();
        }

        if (up.error) {
          console.error('❌ saveFinalStory UPDATE:', debugExtractPostgrest(up.error));
          return up.error as any;
        }
        return null;
      }

      // INSERT（初回）
      let ins = await db
        .from(T_FINAL)
        .insert([{ user_id: userId, company_id: companyId, story: normalized, summary, created_at: now, updated_at: now }])
        .select('id')
        .single();

      if (ins.error && isInvalidJsonSyntax(ins)) {
        ins = await db
          .from(T_FINAL)
          .insert([
            {
              user_id: userId,
              company_id: companyId,
              story: JSON.stringify(normalized ?? []),
              summary,
              created_at: now,
              updated_at: now,
            },
          ])
          .select('id')
          .single();
      }

      if (ins.error) {
        console.error('❌ saveFinalStory INSERT:', debugExtractPostgrest(ins.error));
        return ins.error as any;
      }
      return null;
    }

    // 会社未所属（互換）：user_id 単位で upsert
    let up2 = await db.from(T_FINAL).upsert([{ user_id: userId, story: normalized, summary }], {
      onConflict: 'user_id',
    });

    if (up2.error && isInvalidJsonSyntax(up2)) {
      up2 = await db
        .from(T_FINAL)
        .upsert([{ user_id: userId, story: JSON.stringify(normalized ?? []), summary }], { onConflict: 'user_id' });
    }

    if (up2.error) {
      console.error('❌ saveFinalStory legacy UPSERT:', debugExtractPostgrest(up2.error));
      return up2.error as any;
    }
    return null;
  } catch (error) {
    console.error('❌ saveFinalStory fatal:', debugExtractPostgrest(error));
    return error as any;
  }
}

/** 最終ストーリー取得（会社優先 → 互換の user 単位） */
export async function loadFinalStory(userId: string): Promise<ChapterStory[] | null> {
  const db = createAdminClient();
  try {
    if (!userId) return [];

    const companyId = await resolveCompanyId(userId);
    if (companyId) {
      const r1 = await db
        .from(T_FINAL)
        .select('story')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!r1.error && r1.data) {
        return normalizeChaptersAny((r1.data as any).story || null);
      }
    }

    const r2 = await db
      .from(T_FINAL)
      .select('story')
      .eq('user_id', userId)
      .is('company_id', null)
      .maybeSingle();

    if (!r2.error && r2.data) {
      return normalizeChaptersAny((r2.data as any).story || null);
    }
    return [];
  } catch (e) {
    console.error('❌ loadFinalStory fatal:', debugExtractPostgrest(e));
    return null;
  }
}

/* ======================= 便利系 ======================= */

/** email → userId の簡易検索（存在しない環境はスキップ） */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const db = createAdminClient();

  // auth.users はクライアントから読めないため、アプリ側の users / profiles を順に当たる
  try {
    const u = await db.from('users').select('id').ilike('email', email).maybeSingle();
    if (!u.error && (u.data as any)?.id) return String((u.data as any).id);
  } catch {
    /* noop */
  }

  try {
    const p = await db.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (!p.error && (p.data as any)?.id) return String((p.data as any).id);
  } catch {
    /* noop */
  }

  return null;
}
