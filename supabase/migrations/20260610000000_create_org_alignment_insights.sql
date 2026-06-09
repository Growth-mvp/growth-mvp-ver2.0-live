-- org_alignment_insights テーブル作成
-- 会社単位のAI集計結果を保存

create table if not exists public.org_alignment_insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  summary text not null,
  insights jsonb not null default '[]'::jsonb,
  category_counts jsonb not null default '{}'::jsonb,
  priority_counts jsonb not null default '{"low":0,"medium":0,"high":0}'::jsonb,
  department_trends jsonb not null default '[]'::jsonb,

  source_case_count integer not null default 0,
  generated_by uuid not null references auth.users(id) on delete set null,
  generated_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- インデックス
create index idx_org_alignment_insights_company_id
  on public.org_alignment_insights(company_id);

create index idx_org_alignment_insights_generated_at
  on public.org_alignment_insights(generated_at desc);

create index idx_org_alignment_insights_company_generated
  on public.org_alignment_insights(company_id, generated_at desc);

-- RLS 有効化
alter table public.org_alignment_insights enable row level security;

-- RLS ポリシー: admin のみが自社のインサイトを参照可能
create policy "admin_select_org_alignment_insights"
  on public.org_alignment_insights
  for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = org_alignment_insights.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- RLS ポリシー: admin のみが自社のインサイトを挿入可能
create policy "admin_insert_org_alignment_insights"
  on public.org_alignment_insights
  for insert
  with check (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- RLS ポリシー: admin のみが自社のインサイトを更新可能
create policy "admin_update_org_alignment_insights"
  on public.org_alignment_insights
  for update
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = org_alignment_insights.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = org_alignment_insights.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- RLS ポリシー: admin のみが自社のインサイトを削除可能
create policy "admin_delete_org_alignment_insights"
  on public.org_alignment_insights
  for delete
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = org_alignment_insights.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- コメント
comment on table public.org_alignment_insights is
  '組織変革ルームの管理者向けAI集計結果を保存するテーブル';
comment on column public.org_alignment_insights.summary is
  '全体サマリー（2-3文）';
comment on column public.org_alignment_insights.insights is
  '論点リスト（3-5個）の配列（JSON）';
comment on column public.org_alignment_insights.category_counts is
  'issueType別の件数（JSON）';
comment on column public.org_alignment_insights.priority_counts is
  'リスクレベル別の件数（JSON）';
comment on column public.org_alignment_insights.department_trends is
  '部門別の傾向データ配列（JSON）';
comment on column public.org_alignment_insights.source_case_count is
  '集計元となった org_alignment_cases の件数';
comment on column public.org_alignment_insights.generated_by is
  '集計を実行した管理者のユーザーID';
comment on column public.org_alignment_insights.generated_at is
  'AI集計が実行された日時';
