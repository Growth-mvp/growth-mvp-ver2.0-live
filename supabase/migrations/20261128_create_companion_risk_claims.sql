-- 経営点検（自律伴走）のAI呼び出しの実行枠と、当日の共通所見を保存する。
-- 日付の基準は日本時間（Asia/Tokyo）。アプリが claim_date を日本時間の日付で渡す。
-- 主キー（company_id, claim_date）により、同一企業のAI呼び出しは1日1回に制限される（並行リクエストでも1件だけ成功する）。
-- 保存するもの：企業・日付・戦略・点検事実の指紋（事実本文は保存しない）・状態・当日のAI所見。
-- 保存しないもの：利用者の個人情報、相談履歴、利用者ID。監査は既存の audit_logs に任せる。
-- 保存期間：claim_date から30日。purge_companion_risk_claims() で古い行を削除する（定期実行は未設定）。

create table if not exists public.companion_risk_claims (
  company_id uuid not null references public.companies(id) on delete cascade,
  claim_date date not null,
  strategy_id uuid not null,
  access_scope text not null default 'COMPANY_MEMBER' check (access_scope = 'COMPANY_MEMBER'),
  facts_fingerprint text not null check (char_length(facts_fingerprint) between 1 and 64),
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE', 'FAILED')),
  ai_finding text null check (char_length(ai_finding) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, claim_date)
);

create index if not exists idx_companion_risk_claims_claim_date
  on public.companion_risk_claims (claim_date);

-- 一般クライアント（anon / authenticated）からは直接読み書きさせない。
-- ポリシーを作らないため RLS で全て拒否され、サーバーの service_role だけが扱う。
alter table public.companion_risk_claims enable row level security;
revoke all on public.companion_risk_claims from anon, authenticated;

create or replace function public.purge_companion_risk_claims(retain_days integer default 30)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.companion_risk_claims
  where claim_date < ((now() at time zone 'Asia/Tokyo')::date - retain_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_companion_risk_claims(integer) from public, anon, authenticated;
