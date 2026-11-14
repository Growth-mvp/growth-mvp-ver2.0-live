-- ============================================================
-- 【適用保留・提案】progress_logs の編集・削除の変更履歴（最小案）
--
-- 目的: 上書き編集と物理削除の前の内容を、既存の audit_logs に残す。
-- 方針:
--   - 既存の audit_logs（20260628_create_audit_logs_table.sql）を再利用し、新しい履歴テーブルは作らない。
--   - 記録は DB トリガーで行う（クライアントから改ざんできない）。SECURITY DEFINER で audit_logs に書く。
--   - 閲覧は既存の audit_logs と同じく、会社の admin のみ。
--   - 内容の変更（content）だけを対象にする。作成日時・会社などの変更は権限修正側で拒否する。
-- 注意: 監査には本文（content）をそのまま保存する。progress_logs は同じ会社の全員が閲覧できるため、
--       監査の閲覧者（admin）に新たに開示する範囲は増えない。
-- ============================================================

begin;

create or replace function public.progress_logs_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.content is distinct from old.content then
      insert into public.audit_logs(company_id, actor_user_id, action, target_type, target_id, before, after)
      values (
        old.company_id,
        auth.uid(),
        'PROGRESS_LOG_UPDATE',
        'progress_logs',
        old.id::text,
        jsonb_build_object('content', old.content, 'user_id', old.user_id),
        jsonb_build_object('content', new.content, 'user_id', new.user_id)
      );
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs(company_id, actor_user_id, action, target_type, target_id, before, after)
    values (
      old.company_id,
      auth.uid(),
      'PROGRESS_LOG_DELETE',
      'progress_logs',
      old.id::text,
      jsonb_build_object('content', old.content, 'user_id', old.user_id, 'created_at', old.created_at, 'okr_id', old.okr_id),
      null
    );
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists progress_logs_audit_trg on public.progress_logs;
create trigger progress_logs_audit_trg
  after update or delete on public.progress_logs
  for each row execute function public.progress_logs_audit();

commit;
