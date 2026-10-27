-- company_members の案 B をロールバックする（ステージング・本番のいずれでも、承認後にのみ実行）
-- ==========================================================================
-- 前提：company-members-rls-hardening.sql の適用後であること。
-- 定義の出典：supabase/schema_remote_20260708.sql（本番の pg_policies と一致することを、事前取得で確認する）。
--       実行前に、hardening の「0. 事前取得」の結果がこの定義と一致するか確認すること。
-- ==========================================================================

begin;

drop trigger if exists company_members_guard_trg on public.company_members;
drop function if exists public.company_members_guard();

drop policy if exists company_members_delete_admin on public.company_members;
CREATE POLICY "company_members_delete_admin" ON "public"."company_members" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "company_members"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text")))));

drop policy if exists company_members_update_admin on public.company_members;
CREATE POLICY "company_members_update_admin" ON "public"."company_members" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "company_members"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "company_members"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text")))));

-- 権限を元に戻す（anon には元から権限が無い。service_role は変更されていない）
GRANT ALL ON TABLE "public"."company_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_members" TO "authenticated";

commit;
