import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logAuditEvent } from '@/lib/server/auditLog';

const ACTION = 'invite_confirmation_mail';
export const MAIL_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const MAIL_LIMIT_MAX = 3;

export type InviteMailKind = 'signup' | 'notice' | 'resend';

/**
 * 招待ごとの送信回数の上限（監査ログを使う。スキーマは変えない）。
 * 集計に失敗したら送らない（安全側）。
 */
export async function isInviteMailAllowed(admin: SupabaseClient, inviteId: string): Promise<boolean> {
  const since = new Date(Date.now() - MAIL_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('action', ACTION)
    .eq('target_id', inviteId)
    .gte('created_at', since);

  if (error) {
    console.warn('[invites/mail-limit] count failed:', { code: error.code });
    return false;
  }
  return (count ?? 0) < MAIL_LIMIT_MAX;
}

/** 送信できたことを記録する（宛先のメールアドレスや本文は記録しない） */
export async function recordInviteMail(inviteId: string, kind: InviteMailKind): Promise<void> {
  await logAuditEvent({
    action: ACTION,
    targetType: 'invite',
    targetId: inviteId,
    metadata: { kind },
  });
}
