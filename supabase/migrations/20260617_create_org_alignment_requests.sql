-- org_alignment_requests テーブル作成
-- すり合わせ依頼の管理用テーブル

CREATE TABLE IF NOT EXISTS public.org_alignment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.org_alignment_cases(id) ON DELETE CASCADE,

  -- 依頼者
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),

  -- 対応状態
  status text NOT NULL DEFAULT 'pending',
  -- status の値：pending | reviewing | scheduled | resolved | on_hold

  -- 対応者（管理者）
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,

  -- 管理者メモ
  admin_note text,

  -- メタデータ
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- インデックス
  UNIQUE(company_id, case_id, requested_by)
);

-- インデックス
CREATE INDEX idx_org_alignment_requests_company_id
  ON public.org_alignment_requests(company_id);

CREATE INDEX idx_org_alignment_requests_case_id
  ON public.org_alignment_requests(case_id);

CREATE INDEX idx_org_alignment_requests_status
  ON public.org_alignment_requests(status);

CREATE INDEX idx_org_alignment_requests_company_status
  ON public.org_alignment_requests(company_id, status);

CREATE INDEX idx_org_alignment_requests_requested_at
  ON public.org_alignment_requests(requested_at DESC);

-- RLS 有効化
ALTER TABLE public.org_alignment_requests ENABLE ROW LEVEL SECURITY;

-- RLS ポリシー: member は自分の依頼を参照可能
CREATE POLICY "member_select_own_org_alignment_requests"
  ON public.org_alignment_requests
  FOR SELECT
  USING (
    requested_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_requests.company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

-- RLS ポリシー: member は依頼を作成可能（自社のみ）
CREATE POLICY "member_insert_org_alignment_requests"
  ON public.org_alignment_requests
  FOR INSERT
  WITH CHECK (
    requested_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = company_id
        AND cm.user_id = auth.uid()
    )
  );

-- RLS ポリシー: admin のみが依頼を更新可能
CREATE POLICY "admin_update_org_alignment_requests"
  ON public.org_alignment_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_requests.company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_requests.company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

-- テーブルコメント
COMMENT ON TABLE public.org_alignment_requests IS
  '組織変革・違和感ルームのすり合わせ依頼管理テーブル';
COMMENT ON COLUMN public.org_alignment_requests.status IS
  'pending: 未対応、reviewing: 確認中、scheduled: すり合わせ設定済み、resolved: 対応完了、on_hold: 保留';
COMMENT ON COLUMN public.org_alignment_requests.admin_note IS
  '管理者による対応メモ';
