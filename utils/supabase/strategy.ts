// /utils/supabase/strategy.ts
import { supabase, isValidUUID, getCompanyIdFromCookie, setCompanyIdCookie } from './client';
import {
  debugExtractPostgrest,
  isInvalidJsonSyntax,
  // 一意衝突系
  isUniqueViolation,
  isConflict,
} from './errors';
import { normalizeStrategyData } from './normalize';
import { getMembership } from './membership';
import type { StrategyData } from '@/types/strategy';

const T_STRATEGY = 'strategy_data';

/* ===================================================================
 *  カラム整合
 *   - アプリ層: camelCase
 *   - DB層   : snake_case（今回ここに統一）
 * =================================================================== */

const STRATEGY_COLS_APP = new Set<string>([
  // メタ（app側には基本持たせないが白リストに含めておく）
  'id', 'user_id', 'company_id', 'created_at', 'updated_at', 'updated_by',
  // 基本情報（app/camel）
  'companyName', 'foundationYear', 'location', 'industry',
  'revenue', 'employees', 'businessContent', 'customerSegment',
  // MVV / SWOT / 思考
  'thought', 'mission', 'vision', 'value',
  'strength', 'weakness', 'opportunity', 'threat',
  // JSON・テキスト（app/camel）
  'story', 'finalStory', 'answers2', 'departments', 'csvFinanceData',
  // 読み専用想定（app/camel）
  'strategySummary', 'editableCascade', 'editableCascadeResult',
]);

/** 受信側: DBの snake → アプリの camel へ寄せる（既存） */
const LEGACY_KEY_MAP: Record<string, string> = {
  company_name: 'companyName',
  foundation_year: 'foundationYear',
  business_content: 'businessContent',
  customer_segment: 'customerSegment',
  csv_finance_data: 'csvFinanceData',
  final_story: 'finalStory',
  strategy_summary: 'strategySummary',
  editable_cascade: 'editableCascade',
  editable_cascade_result: 'editableCascadeResult',
  // 一部の過去揺れ吸収
  finalstory: 'finalStory',
};

/** 送信側: アプリの camel → DBの snake へ寄せる（新規） */
const WRITE_KEY_MAP: Record<string, string> = {
  companyName: 'company_name',
  foundationYear: 'foundation_year',
  businessContent: 'business_content',
  customerSegment: 'customer_segment',
  csvFinanceData: 'csv_finance_data',
  finalStory: 'final_story',
  strategySummary: 'strategy_summary',
  editableCascade: 'editable_cascade',
  editableCascadeResult: 'editable_cascade_result',
  // story / answers2 / departments は DB でも同名（小文字）なのでマップ不要
};

function pickAppCols(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = obj ?? {};
  for (const k of Object.keys(src)) {
    if (STRATEGY_COLS_APP.has(k)) out[k] = (src as any)[k];
  }
  return out;
}

/** DB→アプリ（snake→camel）受信正規化の前処理 */
function normalizeIncomingKeys(obj: Record<string, unknown> | null | undefined) {
  const src = obj ?? {};
  const patched: Record<string, unknown> = { ...src };
  for (const [legacy, modern] of Object.entries(LEGACY_KEY_MAP)) {
    if (legacy in patched && !(modern in patched)) {
      patched[modern] = patched[legacy];
      delete patched[legacy];
    }
  }
  return pickAppCols(patched);
}

/** アプリ→DB（camel→snake）送信時に使用 */
function toDbKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const dbKey = WRITE_KEY_MAP[k] ?? k; // マップに無ければそのまま（story/answers2/departments 等）
    out[dbKey] = v;
  }
  return out;
}

/* ===================================================================
 *  JSON 正規化（ここが根治ポイント）
 * =================================================================== */

// 汎用
const asArray = (v: any) => (Array.isArray(v) ? v : []);
// 財務は配列で取り扱うため asObject は使用しない

// StrategyData 用（NOT NULL の jsonb 配列は必ず [] に）
function normalizeJsonColumnsForSave(anyState: any) {
  return {
    ...anyState,
    story: asArray(anyState?.story),
    finalStory: asArray(anyState?.finalStory),
    answers2: asArray(anyState?.answers2),
    departments: asArray(anyState?.departments),
    csvFinanceData: asArray(anyState?.csvFinanceData), // ★ ここを配列運用に統一
  };
}

// stringify フォールバック用
function maybeStringify(v: any) {
  if (typeof v === 'undefined') return undefined;
  if (v === null) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// JSONそのまま通す（プレビュー用のコピー安全化）
function safeJson(v: any) {
  if (typeof v === 'undefined') return undefined;
  if (typeof v === 'string') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

/* ===================================================================
 *  ログ＆ユーティリティ
 * =================================================================== */

function omitId<T extends Record<string, any>>(row: T): T {
  const c = { ...row };
  delete (c as any).id;
  delete (c as any).strategy_id;
  return c;
}
function safeStringify(obj: any) {
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      obj,
      (k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      },
      2
    );
  } catch {
    try { return String(obj); } catch { return '[Unserializable]'; }
  }
}
function previewValue(v: any) {
  const { story, finalStory, answers2, departments, csvFinanceData, ...rest } = v || {};
  return {
    ...rest,
    story: Array.isArray(story) ? `array(${story.length})` : typeof story,
    finalStory: Array.isArray(finalStory) ? `array(${finalStory.length})` : typeof finalStory,
    answers2: Array.isArray(answers2) ? `array(${answers2.length})` : typeof answers2,
    departments: Array.isArray(departments) ? `array(${departments.length})` : typeof departments,
    hasCsvFinanceData: !!csvFinanceData,
  };
}
function group(label: string, color = '#1976d2') {
  try {
    // @ts-ignore
    console.groupCollapsed?.(`%c${label}`, `color:${color}`);
    return () => {
      // @ts-ignore
      console.groupEnd?.();
    };
  } catch {
    return () => {};
  }
}
function extractErrorVerbose(e: any) {
  const info = debugExtractPostgrest(e);
  const raw = { status: e?.status, code: e?.code, message: e?.message, details: e?.details, hint: e?.hint };
  const merged = { ...(typeof info === 'object' ? info : {}), __raw: raw };
  if (!merged['code'] && !merged['message'] && !merged['details']) (merged as any).__dump = e;
  return merged;
}

/** companyId を (1)明示引数→(2)Cookie→(3)membership の順で解決 */
async function resolveCompanyId(userId: string, override?: string | null): Promise<string | null> {
  const end = group('🧭 resolveCompanyId', '#546e7a');
  try {
    if (override && isValidUUID(override)) {
      console.log('override companyId:', override);
      try { setCompanyIdCookie(override); } catch (e) { console.warn('setCompanyIdCookie failed', e); }
      return override;
    }
    try {
      const fromCookie = getCompanyIdFromCookie();
      if (fromCookie) {
        console.log('fromCookie:', fromCookie);
        return fromCookie;
      }
    } catch (e) {
      console.warn('getCompanyIdFromCookie failed', e);
    }
    try {
      const m: any = await getMembership(userId);
      console.log('membership:', m);
      const cid = m?.companyId;
      if (cid && isValidUUID(cid)) {
        try { setCompanyIdCookie(cid); } catch (e) { console.warn('setCompanyIdCookie failed', e); }
        console.log('set cookie companyId:', cid);
        return cid;
      }
    } catch (e) {
      console.warn('getMembership failed', e);
    }
    console.log('companyId not found');
    return null;
  } finally {
    end();
  }
}

/* ===================================================================
 *  取得
 * =================================================================== */

export async function getFullStrategyDataByCompany(companyId: string) {
  const end = group('📥 getFullStrategyDataByCompany');
  try {
    if (!isValidUUID(companyId)) {
      console.warn('invalid companyId:', companyId);
      return { data: null, error: new Error('invalid companyId') };
    }
    const res: any = await supabase
      .from(T_STRATEGY)
      .select('*')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (res?.error) {
      console.error('getFullStrategyDataByCompany error:', extractErrorVerbose(res.error));
      return { data: null, error: res.error };
    }
    console.log('row exists:', !!res?.data);
    const camel = res?.data ? normalizeIncomingKeys(res.data as any) : null; // ★ snake→camel
    return { data: camel ? normalizeStrategyData(camel as any) : null, error: null };
  } catch (e: any) {
    const info = extractErrorVerbose(e);
    console.error('getFullStrategyDataByCompany fatal:', info);
    return { data: null, error: e };
  } finally {
    end();
  }
}

export async function getFullStrategyData(userId: string, strategyId?: string | null) {
  const end = group('📥 getFullStrategyData');
  try {
    if (!userId) return { data: null, error: new Error('userId is required') };

    if (isValidUUID(strategyId ?? undefined)) {
      const byId: any = await supabase.from(T_STRATEGY).select('*').eq('id', strategyId).maybeSingle();
      if (!byId?.error && byId?.data) {
        console.log('fetched by id');
        const camel = normalizeIncomingKeys(byId.data as any); // ★
        return { data: normalizeStrategyData(camel as any), error: null };
      }
    }
    const m: any = await getMembership(userId);
    if (m?.companyId) {
      console.log('fetch by companyId:', m.companyId);
      return getFullStrategyDataByCompany(m.companyId);
    }

    console.log('fallback: user_id && company_id is null');
    const byUser: any = await supabase
      .from(T_STRATEGY)
      .select('*')
      .eq('user_id', userId)
      .is('company_id', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (byUser?.error) {
      console.error('fallback fetch error:', extractErrorVerbose(byUser.error));
      return { data: null, error: byUser.error };
    }
    const camel = byUser?.data ? normalizeIncomingKeys(byUser.data as any) : null; // ★
    return { data: camel ? normalizeStrategyData(camel as any) : null, error: null };
  } catch (e: any) {
    const info = extractErrorVerbose(e);
    console.error('getFullStrategyData fatal:', info);
    return { data: null, error: e };
  } finally {
    end();
  }
}

/* ===================================================================
 *  保存（company_id 単位で 1 行維持）
 * =================================================================== */

export async function saveStrategyData(
  state: StrategyData,
  userId: string,
  companyIdOverride?: string | null
) {
  const end = group('💾 saveStrategyData', '#2e7d32');
  try {
    try { console.log('args → userId:', userId); } catch {}
    try { console.log('state keys:', Object.keys((state as any) || {})); } catch {}

    const now = new Date().toISOString();
    const companyId = await resolveCompanyId(userId, companyIdOverride);
    console.log('resolved companyId:', companyId);

    // 1) アプリ受取 → camel に正規化（id等は除外）
    const baseCamel = normalizeIncomingKeys(omitId(state as any));

    // 2) JSON系を NOT NULL 方針で正規化
    const jsonFixedCamel = normalizeJsonColumnsForSave({
      ...baseCamel,
      story: safeJson((state as any)?.story),
      finalStory: safeJson((state as any)?.finalStory),
      answers2: safeJson((state as any)?.answers2),
      departments: safeJson((state as any)?.departments),
      csvFinanceData: safeJson((state as any)?.csvFinanceData),
    });

    // 3) 書き込み直前で camel → snake に変換
    const payloadDB: Record<string, unknown> = toDbKeys(jsonFixedCamel);

    const endPreview = group('🧪 payload preview');
    try {
      console.log('keys(camel):', Object.keys(jsonFixedCamel || {}));
      console.log('preview(camel):', previewValue(jsonFixedCamel));
      console.log('payload DB keys:', Object.keys(payloadDB || {}));
      console.log('payload DB full:', safeStringify(payloadDB));
    } catch (e) { console.warn('payload preview failed', e); }
    endPreview();

    /* ============ 会社所属あり：INSERT → 23505/409 だけ UPDATE ============ */
    if (companyId) {
      const rowBase = {
        ...payloadDB,
        user_id: userId,
        company_id: companyId,
        updated_by: userId,
        updated_at: now,
      } as Record<string, unknown>;

      const endInsert = group('➕ INSERT strategy_data');
      let rI: any;
      try {
        rI = await supabase
          .from(T_STRATEGY)
          .insert([{ ...rowBase, created_at: now }])
          .select('id')
          .single();

        // JSON型エラーなら stringify で再試行（※camel→snake も維持）
        if (rI?.error && isInvalidJsonSyntax(rI)) {
          console.warn('INSERT invalid json → fallback stringify');
          const rowStr = {
            ...rowBase,
            created_at: now,
            // フィールドごとに stringify（DBキー名で！）
            story: maybeStringify((payloadDB as any).story),
            final_story: maybeStringify((payloadDB as any).final_story),
            departments: maybeStringify((payloadDB as any).departments),
            answers2: maybeStringify((payloadDB as any).answers2),
            csv_finance_data: maybeStringify((payloadDB as any).csv_finance_data),
          } as any;

          rI = await supabase.from(T_STRATEGY).insert([rowStr]).select('id').single();
        }
      } finally {
        endInsert();
      }

      if (!rI?.error) {
        console.log('✅ INSERT ok →', rI?.data);
        return { error: null };
      }

      // 一意衝突のみ UPDATE へ切替
      const isDup = isUniqueViolation(rI.error) || isConflict(rI.error);
      if (isDup) {
        const endUpdate = group('✏️ UPDATE after unique/conflict');
        try {
          let rU: any = await supabase
            .from(T_STRATEGY)
            .update(rowBase)
            .eq('company_id', companyId)
            .select('id')
            .maybeSingle();

          if (rU?.error && isInvalidJsonSyntax(rU)) {
            console.warn('UPDATE invalid json → fallback stringify');
            const rowStr = {
              ...rowBase,
              story: maybeStringify((payloadDB as any).story),
              final_story: maybeStringify((payloadDB as any).final_story),
              departments: maybeStringify((payloadDB as any).departments),
              answers2: maybeStringify((payloadDB as any).answers2),
              csv_finance_data: maybeStringify((payloadDB as any).csv_finance_data),
            } as any;

            rU = await supabase
              .from(T_STRATEGY)
              .update(rowStr)
              .eq('company_id', companyId)
              .select('id')
              .maybeSingle();
          }

          if (rU?.error) {
            const info = extractErrorVerbose(rU.error);
            console.error('❌ UPDATE after conflict error:', info);
            return { error: info };
          }
          console.log('✅ UPDATE ok →', rU?.data);
          return { error: null };
        } finally {
          endUpdate();
        }
      }

      // それ以外のエラーは詳細出力
      const info = extractErrorVerbose(rI.error);
      console.error('❌ INSERT error:', info, { raw: rI });
      return { error: info };
    }

    /* ============ 会社未所属（レガシー）：user_id + company_id IS NULL ============ */
    const endLegacy = group('🧰 legacy mode (company_id is NULL)', '#8e24aa');
    const rowLegacyBase = {
      ...payloadDB,
      user_id: userId,
      company_id: null,
      updated_by: userId,
      updated_at: now,
    } as any;

    // 先に UPDATE
    const u: any = await supabase
      .from(T_STRATEGY)
      .update(rowLegacyBase)
      .eq('user_id', userId)
      .is('company_id', null)
      .select('id');

    if (!u?.error && Array.isArray(u?.data) && u.data.length > 0) {
      endLegacy();
      console.log('legacy UPDATE ok →', u?.data);
      return { error: null };
    }

    // なければ INSERT
    const i: any = await supabase
      .from(T_STRATEGY)
      .insert([{ ...rowLegacyBase, created_at: now } as any])
      .select('id')
      .single();

    console.log('legacy INSERT result:', i);
    endLegacy();

    if (i?.error) {
      const info = extractErrorVerbose(i.error);
      console.error('❌ legacy INSERT error:', info);
      return { error: info };
    }
    return { error: null };
  } catch (error: any) {
    const info = extractErrorVerbose(error);
    console.error('❌ saveStrategyData fatal:', info);
    return { error: info };
  } finally {
    end();
  }
}

/* ===================================================================
 *  削除
 * =================================================================== */

export async function deleteStrategyData(userId: string) {
  const end = group('🗑 deleteStrategyData', '#c62828');
  try {
    const m: any = await getMembership(userId);
    console.log('membership:', m);

    if (m?.companyId) {
      const { error }: any = await supabase.from(T_STRATEGY).delete().eq('company_id', m.companyId);
      if (error) {
        const info = extractErrorVerbose(error);
        console.error('❌ delete by company_id error:', info);
        return { error: info };
      }
      console.log('✅ deleted by company_id:', m.companyId);
    } else {
      const { error }: any = await supabase
        .from(T_STRATEGY)
        .delete()
        .eq('user_id', userId)
        .is('company_id', null);
      if (error) {
        const info = extractErrorVerbose(error);
        console.error('❌ delete legacy error:', info);
        return { error: info };
      }
      console.log('✅ deleted legacy rows for user:', userId);
    }
    return { error: null };
  } catch (error: any) {
    const info = extractErrorVerbose(error);
    console.error('❌ deleteStrategyData fatal:', info);
    return { error: info };
  } finally {
    end();
  }
}
