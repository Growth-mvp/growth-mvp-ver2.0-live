-- Supabase RLS Policies for Tenant Isolation
--
-- 重要：以下の SQL をすべて Supabase Studio で実行する、または Migration として追加してください。
-- 実行順：各テーブル毎に ENABLE RLS をしてから、ポリシーを作成します。
--

-- ============================================================
-- 1. strategy_data テーブル
-- ============================================================

-- RLS を有効化（既に有効な場合はスキップ）
ALTER TABLE public.strategy_data ENABLE ROW LEVEL SECURITY;

-- DELETE: policy (existing rows削除権を company_id で制限)
CREATE POLICY "strategy_data_delete_own_company" ON public.strategy_data
  FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- SELECT: policy (同じ company_id のみ読取可能)
CREATE POLICY "strategy_data_select_own_company" ON public.strategy_data
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: policy (自分の company_id に限定)
CREATE POLICY "strategy_data_insert_own_company" ON public.strategy_data
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- UPDATE: policy (同じ company_id のみ更新可能)
CREATE POLICY "strategy_data_update_own_company" ON public.strategy_data
  FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 2. story_answers2 テーブル
-- ============================================================

ALTER TABLE public.story_answers2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "story_answers2_select_own_company" ON public.story_answers2
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "story_answers2_insert_own_company" ON public.story_answers2
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "story_answers2_update_own_company" ON public.story_answers2
  FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "story_answers2_delete_own_company" ON public.story_answers2
  FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 3. final_stories テーブル
-- ============================================================

ALTER TABLE public.final_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "final_stories_select_own_company" ON public.final_stories
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "final_stories_insert_own_company" ON public.final_stories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "final_stories_update_own_company" ON public.final_stories
  FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "final_stories_delete_own_company" ON public.final_stories
  FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 4. progress_logs テーブル
-- ============================================================

ALTER TABLE public.progress_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progress_logs_select_own_company" ON public.progress_logs
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "progress_logs_insert_own_company" ON public.progress_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "progress_logs_update_own_company" ON public.progress_logs
  FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "progress_logs_delete_own_company" ON public.progress_logs
  FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 5. companies テーブル（読取のみ：自分の company_id のみ）
-- ============================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_select_own" ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 6. company_members テーブル（同社メンバーのみ読取・管理）
-- ============================================================

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- SELECT: 同じ company_id のメンバーのみ
CREATE POLICY "company_members_select_own_company" ON public.company_members
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: admin のみが新メンバーを追加可能
CREATE POLICY "company_members_insert_admin_only" ON public.company_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- UPDATE: admin のみが権限変更可能
CREATE POLICY "company_members_update_admin_only" ON public.company_members
  FOR UPDATE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- DELETE: admin のみが削除可能
CREATE POLICY "company_members_delete_admin_only" ON public.company_members
  FOR DELETE
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM public.company_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- 重要：Service Role での実行制御
--
-- Service Role API は RLS をバイパスします。
-- つまり、service_role キーを使用する API route では：
--   - 明示的に WHERE company_id = ? を指定する必要があります
--   - app/api/companies/provision/route.ts など
--   - app/api/admin/invite/route.ts など
--
-- フロントエンド/クライアント側では、Service Role を一切使用しません。
-- 代わりに requireCompanyContext() で membership.company_id を確認してから
-- 認証ユーザーの権限で操作します。
-- ============================================================
