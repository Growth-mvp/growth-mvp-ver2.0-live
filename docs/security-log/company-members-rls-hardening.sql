-- company_members の直接書込みを禁止し、API に一本化する（案 B）
-- ==========================================================================
-- 状態：提案のみ。本番・ステージングのいずれにも未適用。
-- 順序：
--   0. 事前取得（読み取り専用）→ 結果を保存する（ロールバックの根拠）
--   1. ステージングで適用 → 2. ステージングで検証（ロールバック付き）→ 3. 同時実行テスト
--   4. 承認後に本番へ適用（本番適用は別承認。このファイルでは本番に触れない）
--   5. 問題があればロールバック
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 0. 事前取得（読み取り専用）。結果を保存し、ロールバックの定義と照合する
-- ---------------------------------------------------------------------------
select polname, polcmd, polpermissive, roles::text,
       pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as with_check_expr
from pg_policy
join pg_class on pg_class.oid = polrelid
where relname = 'company_members' order by polname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'company_members'
order by grantee, privilege_type;

select tgname, tgenabled from pg_trigger
where tgrelid = 'public.company_members'::regclass and not tgisinternal;

-- ---------------------------------------------------------------------------
-- 1. 適用（ステージングで先に実行。単一トランザクション）
-- ---------------------------------------------------------------------------
begin;

-- 1-1. 直接 UPDATE・DELETE の許可ポリシーを削除する（INSERT のポリシーは本番に無い）
drop policy if exists company_members_update_admin on public.company_members;
drop policy if exists company_members_delete_admin on public.company_members;

-- 1-2. 権限の剥奪（RLS と二重に防ぐ。サービスロールには影響しない）
revoke insert, update, delete, truncate on public.company_members from authenticated;
revoke insert, update, delete, truncate on public.company_members from anon;

-- 1-3. 最後の管理者を守るトリガー
--   * SECURITY DEFINER：RLS の影響を受けずに、会社の全管理者を数えるため（members_select_self は自分の行しか見せない）
--   * 同じ会社の管理者行を user_id 順に FOR UPDATE で固定する：同時実行を直列化し、ロックの順序を揃えてデッドロックを避ける
--   * DELETE では NEW が NULL なので OLD だけを参照し、RETURN OLD する。UPDATE では NEW を返す
--   * company_id・user_id の付け替えは禁止する（所属の移動は、削除と追加として API で行う）
create or replace function public.company_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  others integer;
begin
  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id or new.user_id is distinct from old.user_id then
      raise exception 'company_members_identity_immutable' using errcode = 'P0001';
    end if;
    -- 管理者でなかった行、または管理者のまま変わらない行は、最後の管理者の検査は不要
    if old.role <> 'admin' or new.role = 'admin' then
      return new;
    end if;
  elsif old.role <> 'admin' then
    return old;
  end if;

  perform 1 from public.company_members
    where company_id = old.company_id and role = 'admin'
    order by user_id
    for update;

  select count(*) into others from public.company_members
    where company_id = old.company_id and role = 'admin' and user_id <> old.user_id;

  if others = 0 then
    raise exception 'last_admin: 会社には管理者が 1 人以上必要です' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.company_members_guard() from public, anon, authenticated;

drop trigger if exists company_members_guard_trg on public.company_members;
create trigger company_members_guard_trg
  before update or delete on public.company_members
  for each row execute function public.company_members_guard();

commit;

-- ---------------------------------------------------------------------------
-- 2. 検証（ステージング。すべてトランザクション内で行い、最後に rollback する）
--    期待値は「適用後」の状態。適用前に実行すると、直接書込みが通ることを確認できる（対照）。
-- ---------------------------------------------------------------------------
begin;
-- 2-1. 直接 UPDATE は 0 行（適用後）。管理者の JWT を模擬する
select set_config('request.jwt.claims', '{"sub":"<ADMIN_A_UID>","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
update public.company_members set role = 'member'
  where company_id = '<COMPANY_A>' and user_id = '<MEMBER_A_UID>';            -- 期待：UPDATE 0
-- 2-2. 直接 DELETE は 0 行（適用後）
delete from public.company_members
  where company_id = '<COMPANY_A>' and user_id = '<MEMBER_A_UID>';            -- 期待：DELETE 0
-- 2-3. 直接 INSERT は権限エラー（適用後）
insert into public.company_members (company_id, user_id, role)
  values ('<COMPANY_A>', '<NEW_UID>', 'member');                              -- 期待：42501
rollback;

begin;
-- 2-4. 自分の所属だけが見える（再帰エラーが出ないこと）
select set_config('request.jwt.claims', '{"sub":"<ADMIN_A_UID>","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select company_id, user_id, role from public.company_members;                 -- 期待：自分の行のみ、エラー無し
-- 2-5. 保存に使う戦略データの参照が、従来どおり動くこと（strategy_data のポリシーは company_members を参照）
select count(*) from public.strategy_data where company_id = '<COMPANY_A>';   -- 期待：エラー無し
rollback;

begin;
-- 2-6. トリガー（サービスロールの経路。RLS を迂回する）
set local role postgres;
delete from public.company_members
  where company_id = '<COMPANY_C>' and user_id = '<ONLY_ADMIN_C_UID>';        -- 期待：P0001 last_admin
update public.company_members set company_id = '<COMPANY_A>'
  where company_id = '<COMPANY_C>' and user_id = '<ONLY_ADMIN_C_UID>';        -- 期待：company_members_identity_immutable
-- 2-7. 複数行の削除で、会社の管理者が全員消えるケースを防ぐ
delete from public.company_members
  where company_id = '<COMPANY_B>' and role = 'admin';                        -- 期待：P0001（最後の 1 人が残る）
rollback;

-- ---------------------------------------------------------------------------
-- 3. 同時実行テスト（2 つのセッションで行う。ステージングのみ）
--    会社に管理者 A と B の 2 人が居る状態で、A と B を同時に削除する。
--    期待：片方だけ成功し、もう片方は P0001（last_admin）になる。40P01（デッドロック）は出ない。
--
--    セッション 1：
--      begin;
--      delete from public.company_members where company_id = '<COMPANY_X>' and user_id = '<ADMIN_A>';
--      select pg_sleep(3);
--      commit;
--    セッション 2（セッション 1 の開始の 1 秒後に）：
--      begin;
--      delete from public.company_members where company_id = '<COMPANY_X>' and user_id = '<ADMIN_B>';
--      commit;   -- セッション 1 の commit を待ってから、P0001 で失敗すること
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. ロールバック：company-members-rls-rollback.sql を実行する（0 の保存結果と照合してから）
-- ---------------------------------------------------------------------------
