-- ============================================================
-- 【未適用】新STAGE3の事業・部門戦略書の作業状態（草案・6問後の再生成案・調整候補・対話結果・選択）を、戦略ごとに1行で保存する表。
-- このファイルは supabase/migrations の外に置いてある。レビューの後、テスト用DBで検証してから適用する。
-- 本番DBへの適用、マイグレーションへの登録は、別の承認の後に行う。
--
-- 目的: 未確定の案を、STAGE4〜6が読む正式データ（strategy_data.departments）と分けて保存し、リロード後も復元する。
-- 理由: strategy_data に列を足すと、保存のたびに revision が上がり、既存の自動保存と衝突する。
--       departments に草案を入れると、未確定の案が STAGE4〜6 の正式データに混ざる。
--       stage4_plan_documents と同じく、草案は専用の表に置く。
-- 競合制御: version（版番号）。更新は「読んだ版番号と同じ時だけ」行い、違えば 0 件になる（競合）。
-- 権限: 読み取りは所属企業のメンバー。書き込みは行わない（API が service role で書く。利用者の直接の書き込みは許さない）。
-- ============================================================

create table if not exists public.stage3_strategy_books (
  strategy_id uuid primary key references public.strategy_data(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stage3_strategy_books_company_idx
  on public.stage3_strategy_books (company_id);

alter table public.stage3_strategy_books enable row level security;

create policy stage3_strategy_books_select on public.stage3_strategy_books
  for select
  using (
    company_id in (
      select cm.company_id from public.company_members cm where cm.user_id = auth.uid()
    )
  );

-- 直接の書き込み（insert / update / delete）の許可は作らない。書き込みは API（service role）だけが行う。
