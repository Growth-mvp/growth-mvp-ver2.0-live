// /utils/supabase/org-alignment.ts
'use client';

import { supabase } from './client';

export type SaveOrgAlignmentCaseInput = {
  companyId?: string | null;
  userId?: string | null;

  situationText: string;
  myRecognitionText: string;
  idealText: string;
  expectationText: string;

  counterpartyType: string;
  counterpartyDetail?: string;
  visibilityMode: string;

  aiResult: unknown;
};

/**
 * 組織変革・認識のズレケースを Supabase に保存する
 * status は 'generated' で初期化される
 */
export async function saveOrgAlignmentCase(input: SaveOrgAlignmentCaseInput) {
  const { data, error } = await supabase
    .from('org_alignment_cases')
    .insert({
      company_id: input.companyId ?? null,
      created_by: input.userId ?? null,

      status: 'generated',

      situation_text: input.situationText,
      my_recognition_text: input.myRecognitionText,
      ideal_text: input.idealText,
      expectation_text: input.expectationText,

      counterparty_type: input.counterpartyType,
      counterparty_detail: input.counterpartyDetail ?? null,
      visibility_mode: input.visibilityMode,

      ai_result: input.aiResult,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * 組織変革ケースをすり合わせ依頼状態に更新する
 * status を 'alignment_requested' に、requested_at に現在時刻を設定
 */
export async function requestOrgAlignmentCase(
  caseId: string,
  visibilityMode: string,
) {
  const { data, error } = await supabase
    .from('org_alignment_cases')
    .update({
      status: 'alignment_requested',
      visibility_mode: visibilityMode,
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseId)
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export type OrgAlignmentCaseListItem = {
  id: string;
  status: string;
  situation_text: string | null;
  my_recognition_text: string | null;
  ideal_text: string | null;
  expectation_text: string | null;
  counterparty_type: string | null;
  counterparty_detail: string | null;
  visibility_mode: string | null;
  ai_result: any | null;
  requested_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * ユーザーが作成した組織変革ケース一覧を取得する
 * 新しい順でソートされます
 */
export async function getOrgAlignmentCasesByUser(userId: string) {
  const { data, error } = await supabase
    .from('org_alignment_cases')
    .select(
      `
      id,
      status,
      situation_text,
      my_recognition_text,
      ideal_text,
      expectation_text,
      counterparty_type,
      counterparty_detail,
      visibility_mode,
      ai_result,
      requested_at,
      created_at,
      updated_at
      `,
    )
    .eq('created_by', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getOrgAlignmentCasesByUser error:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });

    throw new Error(
      error.message || '自分のすり合わせ履歴の取得に失敗しました。',
    );
  }

  return data ?? [];
}

/**
 * 組織変革ケースを削除する
 * created_by で本人確認を行い、自分の履歴のみ削除可能
 */
export async function deleteOrgAlignmentCase(
  caseId: string,
  userId: string,
) {
  if (!caseId || !userId) {
    throw new Error('削除対象またはユーザー情報が不足しています。');
  }

  const { error } = await supabase
    .from('org_alignment_cases')
    .delete()
    .eq('id', caseId)
    .eq('created_by', userId);

  if (error) {
    console.error('[deleteOrgAlignmentCase] failed:', error);
    throw new Error('すり合わせ履歴の削除に失敗しました。');
  }

  return true;
}
