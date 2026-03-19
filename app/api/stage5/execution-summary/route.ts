import 'server-only';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

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
  };
  error?: string;
};

/**
 * チェックイン判定：既存の ExecutionPanel.isCheckin と同じロジック
 * - score が数値 → true
 * - status が存在 → true
 * - content === null → false
 * - content が string で空でない → true
 * - content が object など → true
 */
function isProgressLogCheckin(log: any): boolean {
  if (log == null) return false;

  if (typeof log.score === 'number') return true;

  if (log.status != null) return true;

  if (log.content == null) return false;

  // content が string で実質的に入っている
  if (typeof log.content === 'string') {
    return log.content.trim().length > 0;
  }

  // content が object など（string以外）の場合は true
  return true;
}

export async function GET(): Promise<NextResponse<ExecutionSummaryResponse>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json<ExecutionSummaryResponse>(
      {
        ok: false,
        error: 'Missing environment variables',
      },
      { status: 500 }
    );
  }

  try {
    // Bearer token を取得
    const h = await headers();
    const authz = h.get('authorization') || '';
    const bearer = authz.toLowerCase().startsWith('bearer ')
      ? authz.slice(7)
      : null;

    if (!bearer) {
      return NextResponse.json<ExecutionSummaryResponse>(
        {
          ok: false,
          error: 'Missing authorization bearer token',
        },
        { status: 401 }
      );
    }

    // Service role client で auth.getUser
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: authUser, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !authUser?.user?.id) {
      return NextResponse.json<ExecutionSummaryResponse>(
        {
          ok: false,
          error: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    const userId = authUser.user.id;

    // company_members から companyId を取得（whoami パターン）
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
        {
          ok: false,
          error: 'User has no company membership',
        },
        { status: 403 }
      );
    }

    const companyId = membership.company_id;

    // 直近7日の日時
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 1. OKR総数を okrs テーブルから取得（count フィールドを使う）
    const { count: totalOkrsCount, error: okrCountError } = await admin
      .from('okrs')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    if (okrCountError) {
      throw new Error(`Failed to count OKRs: ${okrCountError.message}`);
    }

    const totalOkrs = totalOkrsCount ?? 0;

    // 2. 直近7日の progress_logs を取得
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

    // 3. チェックイン済み OKR を集計
    const checkinOkrIds = new Set<string>();
    for (const log of logs) {
      if (!isProgressLogCheckin(log)) continue;
      const okrId = log.okr_id;
      if (okrId) {
        checkinOkrIds.add(String(okrId));
      }
    }

    const checkedOkrs7d = checkinOkrIds.size;
    const uncheckedOkrs7d = Math.max(0, totalOkrs - checkedOkrs7d);
    const checkInRate = totalOkrs > 0 ? checkedOkrs7d / totalOkrs : null;

    // 4. staleProjects を計算
    // okrs テーブルでプロジェクト別に集計
    const { data: okrsData, error: okrsError } = await admin
      .from('okrs')
      .select('id, department_id, project_id')
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    if (okrsError) {
      throw new Error(`Failed to fetch OKRs: ${okrsError.message}`);
    }

    const okrsByProject = new Map<
      string,
      { departmentId: string; projectId: string; okrIds: string[] }
    >();

    for (const okr of okrsData || []) {
      const projectKey = `${okr.department_id}|${okr.project_id}`;
      if (!okrsByProject.has(projectKey)) {
        okrsByProject.set(projectKey, {
          departmentId: okr.department_id,
          projectId: okr.project_id,
          okrIds: [],
        });
      }
      okrsByProject.get(projectKey)!.okrIds.push(okr.id);
    }

    // プロジェクトごとに判定
    interface ProjectStaleness {
      departmentId: string;
      projectId: string;
      uncheckedOkrCount: number;
      lastCheckinAt: string | null;
    }

    const projectStaleness: ProjectStaleness[] = [];

    for (const [, projData] of okrsByProject) {
      const okrIds = projData.okrIds;

      // 配下OKRのうち1件でもチェックインがあれば stale ではない
      const hasAnyCheckin = okrIds.some((id) => checkinOkrIds.has(id));
      if (hasAnyCheckin) continue; // stale から除外

      // 配下OKRが全て未チェックイン → stale
      const uncheckedOkrCount = okrIds.length;

      projectStaleness.push({
        departmentId: projData.departmentId,
        projectId: projData.projectId,
        uncheckedOkrCount,
        lastCheckinAt: null, // 7日以内のチェックインなし
      });
    }

    // 未チェックイン数が多い順でソート
    projectStaleness.sort((a, b) => {
      if (a.uncheckedOkrCount !== b.uncheckedOkrCount) {
        return b.uncheckedOkrCount - a.uncheckedOkrCount;
      }
      // 同じ未チェックイン数ならプロジェクトIDで安定ソート
      return a.projectId.localeCompare(b.projectId);
    });

    // 上位3件を取得
    const topStale = projectStaleness.slice(0, 3);

    // 5. departmentName / projectTitle を strategy_data から取得
    const { data: strategyRow, error: strategyError } = await admin
      .from('strategy_data')
      .select('departments')
      .eq('company_id', companyId)
      .maybeSingle();

    if (strategyError) {
      throw new Error(`Failed to fetch strategy_data: ${strategyError.message}`);
    }

    // department_id/project_id → name のマップを構築
    const departmentMap = new Map<string, string>();
    const projectMap = new Map<string, string>();

    const departments = (strategyRow?.departments as any[]) || [];
    for (const dept of departments) {
      const deptId = String(dept?.id ?? '');
      const deptName = String(dept?.name ?? '（部門名未設定）');
      if (deptId) {
        departmentMap.set(deptId, deptName);
      }

      const projects = (dept?.projects as any[]) || [];
      for (const proj of projects) {
        const projId = String(proj?.id ?? '');
        const projTitle = String(proj?.title ?? proj?.name ?? '（プロジェクト名未設定）');
        if (projId) {
          projectMap.set(projId, projTitle);
        }
      }
    }

    // staleProjects に displayName を追加
    const staleProjectsWithNames = topStale.map((proj) => ({
      departmentId: proj.departmentId,
      departmentName: departmentMap.get(proj.departmentId) ?? `（ID: ${proj.departmentId}）`,
      projectId: proj.projectId,
      projectTitle: projectMap.get(proj.projectId) ?? `（ID: ${proj.projectId}）`,
      uncheckedOkrCount: proj.uncheckedOkrCount,
      lastCheckinAt: proj.lastCheckinAt,
    }));

    return NextResponse.json<ExecutionSummaryResponse>({
      ok: true,
      data: {
        totalOkrs,
        checkedOkrs7d,
        uncheckedOkrs7d,
        checkInRate,
        staleProjects: staleProjectsWithNames,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[execution-summary] error:', errMsg);
    return NextResponse.json<ExecutionSummaryResponse>(
      {
        ok: false,
        error: errMsg,
      },
      { status: 500 }
    );
  }
}
