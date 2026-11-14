-- 隔離検証用：修正前の環境に残っていた可能性のある「全件許可」の旧ポリシー（評価専用）。
-- 修正案は、名前を問わず既存の progress_logs のポリシーを全て削除するため、この許可も無効になるべき。
create policy legacy_member_all on public.progress_logs for all to authenticated using (true) with check (true);
