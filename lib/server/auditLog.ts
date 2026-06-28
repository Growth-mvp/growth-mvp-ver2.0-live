import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export interface AuditLogEntry {
  companyId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: any;
  after?: any;
  metadata?: any;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Log an audit event to the audit_logs table
 *
 * Purpose: Track critical operations (invites, members, roles, etc) for compliance and incident investigation
 *
 * Behavior:
 * - Logs via service_role (bypass client-level RLS)
 * - Fails gracefully: audit log failure does NOT stop the main operation
 * - Always logs to console.warn if audit insert fails
 *
 * @param entry Audit log entry
 * @returns true if successful, false if failed (but main operation continues)
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin();

    const { error } = await admin
      .from('audit_logs')
      .insert({
        company_id: entry.companyId || null,
        actor_user_id: entry.actorUserId || null,
        action: entry.action,
        target_type: entry.targetType || null,
        target_id: entry.targetId || null,
        before: entry.before || null,
        after: entry.after || null,
        metadata: entry.metadata || null,
        ip: entry.ip || null,
        user_agent: entry.userAgent || null,
      });

    if (error) {
      console.warn('[audit] Failed to log audit event', {
        action: entry.action,
        targetType: entry.targetType,
        error: error.message,
      });
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[audit] Unexpected error while logging audit event', {
      action: entry.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Extract IP and User-Agent from NextRequest for audit logging
 */
export function extractAuditMetadata(req: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const ip =
    (req.headers instanceof Headers && (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim())) ||
    (req.headers instanceof Headers && req.headers.get('x-real-ip')) ||
    null;

  const userAgent = (req.headers instanceof Headers && req.headers.get('user-agent')) || null;

  return { ip, userAgent };
}
