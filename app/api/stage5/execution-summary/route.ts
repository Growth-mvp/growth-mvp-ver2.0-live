import 'server-only';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

type RecentProjectUpdate = {
  departmentId: string;
  departmentName: string;
  projectId: string;
  projectTitle: string;
  okrId: string | null;
  latestUpdateAt: string;
  latestUpdateType: 'progress' | 'comment' | 'rating' | 'advice' | 'request' | 'status' | 'update';
  latestSummary: string | null;
};

type ExecutionSummaryResponse = {
  ok: boolean;
  data?: {
    totalOkrs: number;
    checkedOkrs7d: number;
    uncheckedOkrs7d: number;
    checkInRate: number | null;
    staleProjects: Array<{
      departmentId: string;
      departmentName: string;
      projectId: string;
      projectTitle: string;
      uncheckedOkrCount: number;
      lastCheckinAt: string | null;
    }>;
    recentProjectUpdates: RecentProjectUpdate[];
  };
  error?: string;
};

function isProgressLogCheckin(log: any): boolean {
  if (log == null) return false;
  if (typeof log.score === 'number') return true;
  if (log.status != null) return true;
  if (log.content == null) return false;
  if (typeof log.content === 'string') return log.content.trim().length > 0;
  return true;
}

function normalizeDisplayName(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : fallback;
}

function getDepartmentName(raw: unknown): string {
  return normalizeDisplayName(raw, '名称未設定の部門');
}

function getProjectTitle(raw: unknown): string {
  return normalizeDisplayName(raw, '名称未設定のプロジェクト');
}

function detectUpdateType(log: { content?: unknown; score?: unknown; status?: unknown }): RecentProjectUpdate['latestUpdateType'] {
  const content = typeof log.content === 'string' ? log.content.trim() : '';

  if (typeof log.score === 'number') return 'rating';
  if (content.startsWith('協力要請先:')) return 'request';
  if (content.startsWith('評価:')) return 'rating';
  if (log.status != null) return 'status';
  if (content.length === 0) return 'update';
  if (/次の一手|改善案|やること|やめること/.test(content)) return 'advice';
  if (/進捗|所感|課題/.test(content)) return 'progress';
  return 'comment';
}

function compactSummary(content: unknown): string | null {
  if (typeof content !== 'string') return null;

  const lines = content
    .split('\n')
    .map((line) => line.replace(/__META__:\{[\s\S]*$/u, '').trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('__META__:'));

  if (lines.length === 0) return null;

  let normalized = lines.join(' / ');
  normalized = normalized.replace(/__META__:\{[\s\S]*$/u, '').trim();
  normalized = normalized.replace(/^\[FB\]\s*/u, '');
  normalized = normalized.replace(/^評価:\s*[0-9-]+\s*/u, '');
  normalized = normalized.replace(/^協力要請先:\s*/u, '');
  normalized = normalized.replace(/\s*\/\s*--- Help ---\s*\/\s*/u, ' / ');

  if (!normalized) return null;
  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
}

export async function GET(): Promise<NextResponse<ExecutionSummaryResponse>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json<ExecutionSummaryResponse>(
      { ok: false, error: 'Missing environment variables' },
      { status: 500 }
    );
  }

  try {
    const h = await headers();
    const authz = h.get('authorization') || '';
    const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7) : null;

    if (!bearer) {
      return NextResponse.json<ExecutionSummaryResponse>(
        { ok: false, error: 'Missing authorization bearer token' },
        { status: 401 }
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: authUser, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !authUser?.user?.id) {
      return NextResponse.json<ExecutionSummaryResponse>(
        { ok: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const userId = authUser.user.id;

    const { data: membership, error: memberError } = await admin
      .from('company_members')
      .select('company_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (memberError) {
      throw new Error(`Failed to fetch company membership: ${memberError.message}`);
    }

    if (!membership?.company_id) {
      return NextResponse.json<ExecutionSummaryResponse>(
        { ok: false, error: 'User has no company membership' },
        { status: 403 }
      );
    }

    const companyId = membership.company_id;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { count: totalOkrsCount, error: okrCountError } = await admin
      .from('okrs')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    if (okrCountError) {
      throw new Error(`Failed to count OKRs: ${okrCountError.message}`);
    }

    const totalOkrs = totalOkrsCount ?? 0;

    const { data: progressLogs, error: logsError } = await admin
      .from('progress_logs')
      .select('okr_id, content, score, status, created_at')
      .eq('company_id', companyId)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });

    if (logsError) {
      throw new Error(`Failed to fetch progress logs: ${logsError.message}`);
    }

    const logs = Array.isArray(progressLogs) ? progressLogs : [];

    const checkinOkrIds = new Set<string>();
    for (const log of logs) {
      if (!isProgressLogCheckin(log)) continue;
      if (log.okr_id) checkinOkrIds.add(String(log.okr_id));
    }

    const checkedOkrs7d = checkinOkrIds.size;
    const uncheckedOkrs7d = Math.max(0, totalOkrs - checkedOkrs7d);
    const checkInRate = totalOkrs > 0 ? checkedOkrs7d / totalOkrs : null;

    // ===== 修正: progress_logs が参照する OKR は is_deleted = true でも取得必要 =====
    // reason: soft delete された OKR のコメントはまだ progress_logs に存在
    //        is_deleted = false だけでは okrMetaMap に enter されず、ホームに表示されない
    const { data: okrsData, error: okrsError } = await admin
      .from('okrs')
      .select('id, department_id, project_id, objective, is_deleted')
      .eq('company_id', companyId);

    if (okrsError) {
      throw new Error(`Failed to fetch OKRs: ${okrsError.message}`);
    }

    const okrRows = Array.isArray(okrsData) ? okrsData : [];
    const okrMetaMap = new Map<string, { departmentId: string; projectId: string; objective: string | null }>();
    const okrsByProject = new Map<string, { departmentId: string; projectId: string; okrIds: string[]; objectiveHints: string[] }>();

    for (const okr of okrRows) {
      const okrId = String(okr?.id ?? '').trim();
      const departmentId = String(okr?.department_id ?? '').trim();
      const projectId = String(okr?.project_id ?? '').trim();
      const objective = typeof okr?.objective === 'string' && okr.objective.trim() ? okr.objective.trim() : null;
      if (!okrId || !departmentId || !projectId) continue;

      okrMetaMap.set(okrId, { departmentId, projectId, objective });

      const projectKey = `${departmentId}|${projectId}`;
      if (!okrsByProject.has(projectKey)) {
        okrsByProject.set(projectKey, {
          departmentId,
          projectId,
          okrIds: [],
          objectiveHints: [],
        });
      }
      const entry = okrsByProject.get(projectKey)!;
      entry.okrIds.push(okrId);
      if (objective) entry.objectiveHints.push(objective);
    }

    interface ProjectStaleness {
      departmentId: string;
      projectId: string;
      uncheckedOkrCount: number;
      lastCheckinAt: string | null;
    }

    const projectStaleness: ProjectStaleness[] = [];
    for (const [, projData] of okrsByProject) {
      const hasAnyCheckin = projData.okrIds.some((id) => checkinOkrIds.has(id));
      if (hasAnyCheckin) continue;
      projectStaleness.push({
        departmentId: projData.departmentId,
        projectId: projData.projectId,
        uncheckedOkrCount: projData.okrIds.length,
        lastCheckinAt: null,
      });
    }

    projectStaleness.sort((a, b) => {
      if (a.uncheckedOkrCount !== b.uncheckedOkrCount) return b.uncheckedOkrCount - a.uncheckedOkrCount;
      return a.projectId.localeCompare(b.projectId);
    });

    const topStale = projectStaleness.slice(0, 3);

    const { data: strategyRow, error: strategyError } = await admin
      .from('strategy_data')
      .select('departments')
      .eq('company_id', companyId)
      .maybeSingle();

    if (strategyError) {
      throw new Error(`Failed to fetch strategy_data: ${strategyError.message}`);
    }

    const departmentMap = new Map<string, string>();
    const projectMap = new Map<string, string>();
    const departments = Array.isArray(strategyRow?.departments) ? (strategyRow.departments as any[]) : [];

    for (const dept of departments) {
      const deptId = String(dept?.id ?? '').trim();
      const deptName = getDepartmentName(dept?.name ?? dept?.title);
      if (deptId) departmentMap.set(deptId, deptName);

      const projects = Array.isArray(dept?.projects) ? dept.projects : [];
      for (const proj of projects) {
        const projId = String(proj?.id ?? '').trim();
        const projTitle = getProjectTitle(proj?.title ?? proj?.name);
        if (projId) projectMap.set(projId, projTitle);
      }
    }

    const resolveDepartmentName = (departmentId: string) => {
      const fromStrategy = departmentMap.get(departmentId);
      return fromStrategy ? getDepartmentName(fromStrategy) : '名称未設定の部門';
    };

    const resolveProjectTitle = (departmentId: string, projectId: string) => {
      const fromStrategy = projectMap.get(projectId);
      if (fromStrategy) return getProjectTitle(fromStrategy);

      const projectKey = `${departmentId}|${projectId}`;
      const hint = okrsByProject.get(projectKey)?.objectiveHints?.[0] ?? null;
      if (hint) return getProjectTitle(hint);

      return '名称未設定のプロジェクト';
    };

    const staleProjectsWithNames = topStale.map((proj) => ({
      departmentId: proj.departmentId,
      departmentName: resolveDepartmentName(proj.departmentId),
      projectId: proj.projectId,
      projectTitle: resolveProjectTitle(proj.departmentId, proj.projectId),
      uncheckedOkrCount: proj.uncheckedOkrCount,
      lastCheckinAt: proj.lastCheckinAt,
    }));

    // ===== 診断: progress_logs から recentProjectUpdates へのフィルタリング過程 =====
    const skipReasons = {
      emptyOkrId: 0,
      okrMetaNotFound: 0,
      emptyLatestUpdateAt: 0,
      projectKeyDuplicate: 0,
      added: 0,
    };

    const latestByProject = new Map<string, RecentProjectUpdate>();
    for (const log of logs) {
      const okrId = String(log?.okr_id ?? '').trim();
      if (!okrId) {
        skipReasons.emptyOkrId++;
        continue;
      }
      const okrMeta = okrMetaMap.get(okrId);
      if (!okrMeta) {
        skipReasons.okrMetaNotFound++;
        continue;
      }

      const latestUpdateAt = typeof log?.created_at === 'string' ? log.created_at : '';
      if (!latestUpdateAt) {
        skipReasons.emptyLatestUpdateAt++;
        continue;
      }

      const projectKey = `${okrMeta.departmentId}|${okrMeta.projectId}`;
      if (latestByProject.has(projectKey)) {
        skipReasons.projectKeyDuplicate++;
        continue;
      }

      skipReasons.added++;
      latestByProject.set(projectKey, {
        departmentId: okrMeta.departmentId,
        departmentName: resolveDepartmentName(okrMeta.departmentId),
        projectId: okrMeta.projectId,
        projectTitle: resolveProjectTitle(okrMeta.departmentId, okrMeta.projectId),
        okrId,
        latestUpdateAt,
        latestUpdateType: detectUpdateType(log),
        latestSummary: compactSummary(log?.content),
      });
    }

    console.log('[execution-summary-filtering]', {
      progressLogsCount: logs.length,
      okrMetaMapSize: okrMetaMap.size,
      skipReasons,
      latestByProjectSize: latestByProject.size,
      sevenDaysAgo,
      companyId,
    });

    const recentProjectUpdates = Array.from(latestByProject.values())
      .sort((a, b) => b.latestUpdateAt.localeCompare(a.latestUpdateAt))
      .slice(0, 4);

    return NextResponse.json<ExecutionSummaryResponse>({
      ok: true,
      data: {
        totalOkrs,
        checkedOkrs7d,
        uncheckedOkrs7d,
        checkInRate,
        staleProjects: staleProjectsWithNames,
        recentProjectUpdates,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[execution-summary] error:', errMsg);
    return NextResponse.json<ExecutionSummaryResponse>(
      { ok: false, error: errMsg },
      { status: 500 }
    );
  }
}
