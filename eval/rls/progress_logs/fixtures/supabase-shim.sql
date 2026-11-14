-- Supabase 相当の環境を再現する追加定義（評価専用。本番DBには適用しない）。
-- PostgREST（v12）が設定する JWT の GUC（request.jwt.claims）から auth.uid() を求める。Supabase の定義と同じ形。
-- PostgREST が呼び出すログイン用ロール authenticator を作り、anon・authenticated・service_role へ切り替えさせる。

create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$ begin
  create role authenticator login noinherit password 'authenticator-test-only';
exception when duplicate_object then
  alter role authenticator login noinherit password 'authenticator-test-only';
end $$;
grant anon, authenticated, service_role to authenticator;

-- 本番で anon が実行できないことを確認済みの SECURITY DEFINER 関数を模した定義（public に公開される）。
-- 修正案の rls_private 関数とは別物。公開範囲の差を検証するための比較対象。
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.company_members m where m.company_id = p_company_id and m.user_id = auth.uid());
$$;
revoke all on function public.is_company_member(uuid) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated, service_role;
