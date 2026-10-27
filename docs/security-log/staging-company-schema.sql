-- ステージング用の最小スキーマ（提案。未適用・未実行）
--
-- 目的：会社・所属・招待・監査ログ・戦略データの最小セットを、本番の定義（supabase/schema_remote_20260708.sql）から
--       そのまま写して、company_members の RLS と API の回帰テストを行えるようにする。
-- 注意：
--  * 本番のデータはコピーしない。このファイルは型・テーブル・インデックス・ポリシー・GRANT のみ。
--  * 対象：companies / company_members / company_invites / audit_logs / strategy_data（5 テーブル）と、それが使う型 user_role。
--  * 本番と同じ company_members のポリシー（update_admin / delete_admin）を入れる。
--    案 B の適用は別ファイル（company-members-rls-hardening.sql）で、承認後に行う。
--  * auth.users への外部キーあり（companies.created_by、company_invites、company_members.user_id ON DELETE CASCADE、strategy_data.user_id）。
--    staging の Auth（auth.users）が存在することが前提。
--  * 実行前に、staging に public スキーマの同名オブジェクトが無いことを確認すること。
--  * 本番の定義が変わった場合は、このファイルを再生成して差分を確認すること。

CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'manager',
    'member'
);

ALTER TYPE "public"."user_role" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);

ALTER TABLE "public"."companies" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."strategy_data" (
    "user_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone,
    "company_name" "text",
    "foundation_year" "text",
    "location" "text",
    "industry" "text",
    "revenue" "text",
    "employees" "text",
    "business_content" "text",
    "customer_segment" "text",
    "strength" "text",
    "weakness" "text",
    "opportunity" "text",
    "threat" "text",
    "mission" "text",
    "vision" "text",
    "value" "text",
    "departments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "csv_finance_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "story" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "strategy_summary" "jsonb",
    "editable_cascade" "jsonb",
    "thought" "text",
    "email" "text",
    "role" "public"."user_role",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "answers" "jsonb",
    "answers2" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "final_story" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "editable_cascade_result" "jsonb",
    "questions" "text"[],
    "reasons" "text"[],
    "questions2" "text"[],
    "reasons2" "text"[],
    "notification" "text",
    "company_id" "uuid" NOT NULL,
    "updated_by" "uuid",
    "business_portfolio" "jsonb",
    "finance_summary" "jsonb",
    "simulation_result" "jsonb",
    "simulation_results" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "fiscal_year_end" "text",
    "currency" "text" DEFAULT 'JPY'::"text",
    "period_start_year" "text",
    "period_end_year" "text",
    "business_segments" "jsonb" DEFAULT '[]'::"jsonb",
    "is_listed" boolean DEFAULT false,
    "ticker" "text",
    "pbr_manual" "text",
    "finance_pl" "jsonb",
    "revision" integer DEFAULT 0 NOT NULL,
    "stage1_issues" "jsonb",
    "ceo_intent" "text",
    "swot_suggestions" "jsonb",
    "story_draft" "jsonb",
    "win_patterns_candidate" "jsonb",
    "answers12" "jsonb",
    "company_targets" "jsonb",
    "final_story_draft" "jsonb",
    "final_story_edited" "jsonb",
    "final_story_final" "jsonb",
    "project_target_impacts" "jsonb" DEFAULT '[]'::"jsonb",
    "project_issue_links" "jsonb" DEFAULT '[]'::"jsonb",
    "stage1_benchmarks" "jsonb",
    "okr_target_scores" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "stage3_strategy_bridge" "jsonb",
    "stage2_final_document_edits" "jsonb",
    CONSTRAINT "chk_strategy_finance_is_object" CHECK ((("finance_summary" IS NULL) OR ("jsonb_typeof"("finance_summary") = 'object'::"text"))),
    CONSTRAINT "chk_strategy_portfolio_is_object" CHECK ((("business_portfolio" IS NULL) OR ("jsonb_typeof"("business_portfolio") = 'object'::"text"))),
    CONSTRAINT "strategy_data_answers2_json" CHECK ((("answers2" IS NULL) OR ("jsonb_typeof"("answers2") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_business_portfolio_json" CHECK ((("business_portfolio" IS NULL) OR ("jsonb_typeof"("business_portfolio") = 'object'::"text"))),
    CONSTRAINT "strategy_data_csv_finance_data_json" CHECK ((("csv_finance_data" IS NULL) OR ("jsonb_typeof"("csv_finance_data") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_departments_json" CHECK ((("departments" IS NULL) OR ("jsonb_typeof"("departments") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_editable_cascade_json" CHECK ((("editable_cascade" IS NULL) OR ("jsonb_typeof"("editable_cascade") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_editable_cascade_result_json" CHECK ((("editable_cascade_result" IS NULL) OR ("jsonb_typeof"("editable_cascade_result") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_final_story_json" CHECK ((("final_story" IS NULL) OR ("jsonb_typeof"("final_story") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_finance_summary_json" CHECK ((("finance_summary" IS NULL) OR ("jsonb_typeof"("finance_summary") = 'object'::"text"))),
    CONSTRAINT "strategy_data_simulation_result_json" CHECK ((("jsonb_typeof"("simulation_result") IS NULL) OR ("jsonb_typeof"("simulation_result") = 'object'::"text"))),
    CONSTRAINT "strategy_data_story_json" CHECK ((("story" IS NULL) OR ("jsonb_typeof"("story") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_strategy_summary_json" CHECK ((("strategy_summary" IS NULL) OR ("jsonb_typeof"("strategy_summary") = ANY (ARRAY['array'::"text", 'object'::"text"])))),
    CONSTRAINT "strategy_data_user_or_company_chk" CHECK ((("user_id" IS NOT NULL) OR ("company_id" IS NOT NULL)))
);

ALTER TABLE "public"."strategy_data" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "target_type" "text",
    "target_id" "text",
    "before" "jsonb",
    "after" "jsonb",
    "metadata" "jsonb",
    "ip" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."audit_logs" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."company_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "accepted_by" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."company_invites" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."company_members" (
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department_id" "uuid",
    CONSTRAINT "company_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'member'::"text"])))
);

ALTER TABLE "public"."company_members" OWNER TO "postgres";

ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."company_invites"
    ADD CONSTRAINT "company_invites_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_pkey" PRIMARY KEY ("company_id", "user_id");

ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_unique_company_user" UNIQUE ("company_id", "user_id");

ALTER TABLE ONLY "public"."strategy_data"
    ADD CONSTRAINT "strategy_data_pkey" PRIMARY KEY ("id");

CREATE INDEX "company_invites_company_email_ix" ON "public"."company_invites" USING "btree" ("company_id", "email");

CREATE UNIQUE INDEX "company_invites_token_hash_ux" ON "public"."company_invites" USING "btree" ("token_hash");

CREATE INDEX "idx_audit_logs_action_created_at" ON "public"."audit_logs" USING "btree" ("action", "created_at" DESC);

CREATE INDEX "idx_audit_logs_actor_created_at" ON "public"."audit_logs" USING "btree" ("actor_user_id", "created_at" DESC);

CREATE INDEX "idx_audit_logs_company_created_at" ON "public"."audit_logs" USING "btree" ("company_id", "created_at" DESC);

CREATE INDEX "idx_audit_logs_target" ON "public"."audit_logs" USING "btree" ("target_type", "target_id");

CREATE INDEX "idx_cm_comp_user" ON "public"."company_members" USING "btree" ("company_id", "user_id");

CREATE INDEX "idx_cm_company" ON "public"."company_members" USING "btree" ("company_id");

CREATE INDEX "idx_cm_user" ON "public"."company_members" USING "btree" ("user_id");

CREATE INDEX "idx_company_members_company" ON "public"."company_members" USING "btree" ("company_id");

CREATE INDEX "idx_company_members_company_id" ON "public"."company_members" USING "btree" ("company_id");

CREATE INDEX "idx_company_members_user" ON "public"."company_members" USING "btree" ("user_id");

CREATE INDEX "idx_company_members_user_created_at" ON "public"."company_members" USING "btree" ("user_id", "created_at" DESC);

CREATE INDEX "idx_members_company" ON "public"."company_members" USING "btree" ("company_id");

CREATE INDEX "idx_members_user" ON "public"."company_members" USING "btree" ("user_id");

CREATE INDEX "idx_strategy_company" ON "public"."strategy_data" USING "btree" ("company_id");

CREATE INDEX "idx_strategy_data_company" ON "public"."strategy_data" USING "btree" ("company_id");

CREATE INDEX "idx_strategy_data_company_id" ON "public"."strategy_data" USING "btree" ("company_id");

CREATE UNIQUE INDEX "strategy_data_company_unique" ON "public"."strategy_data" USING "btree" ("company_id") WHERE ("company_id" IS NOT NULL);

CREATE INDEX "strategy_data_story_draft_gin" ON "public"."strategy_data" USING "gin" ("story_draft");

CREATE INDEX "strategy_data_updated_at_idx" ON "public"."strategy_data" USING "btree" ("updated_at" DESC);

CREATE UNIQUE INDEX "strategy_data_user_id_key" ON "public"."strategy_data" USING "btree" ("user_id");

CREATE UNIQUE INDEX "strategy_data_user_legacy_unique" ON "public"."strategy_data" USING "btree" ("user_id") WHERE ("company_id" IS NULL);

CREATE UNIQUE INDEX "uq_company_members_pair" ON "public"."company_members" USING "btree" ("company_id", "user_id");

CREATE UNIQUE INDEX "uq_strategy_company" ON "public"."strategy_data" USING "btree" ("company_id") WHERE ("company_id" IS NOT NULL);

CREATE UNIQUE INDEX "uq_strategy_data_company" ON "public"."strategy_data" USING "btree" ("company_id");

CREATE UNIQUE INDEX "uq_strategy_user_personal" ON "public"."strategy_data" USING "btree" ("user_id") WHERE ("company_id" IS NULL);

CREATE UNIQUE INDEX "ux_company_members_company_user" ON "public"."company_members" USING "btree" ("company_id", "user_id");

CREATE UNIQUE INDEX "ux_strategy_data_company" ON "public"."strategy_data" USING "btree" ("company_id");

ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."company_invites"
    ADD CONSTRAINT "company_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."company_invites"
    ADD CONSTRAINT "company_invites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."company_invites"
    ADD CONSTRAINT "company_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."company_members"
    ADD CONSTRAINT "company_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."strategy_data"
    ADD CONSTRAINT "strategy_data_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."strategy_data"
    ADD CONSTRAINT "strategy_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_admin_select" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ((("company_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "audit_logs"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text"))))));

CREATE POLICY "audit_logs_no_delete" ON "public"."audit_logs" FOR DELETE TO "authenticated" USING (false);

CREATE POLICY "audit_logs_no_insert_authenticated" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK (false);

CREATE POLICY "audit_logs_no_update" ON "public"."audit_logs" FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);

ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_delete_creator" ON "public"."companies" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));

CREATE POLICY "companies_insert_creator" ON "public"."companies" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));

CREATE POLICY "companies_select_creator" ON "public"."companies" FOR SELECT TO "authenticated" USING (("created_by" = "auth"."uid"()));

CREATE POLICY "companies_select_member" ON "public"."companies" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "companies"."id")))));

CREATE POLICY "companies_update_creator" ON "public"."companies" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));

ALTER TABLE "public"."company_invites" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."company_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_members_delete_admin" ON "public"."company_members" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "company_members"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text")))));

CREATE POLICY "company_members_update_admin" ON "public"."company_members" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "company_members"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "company_members"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text")))));

CREATE POLICY "deny_all_delete" ON "public"."company_invites" FOR DELETE TO "authenticated" USING (false);

CREATE POLICY "deny_all_insert" ON "public"."company_invites" FOR INSERT TO "authenticated" WITH CHECK (false);

CREATE POLICY "deny_all_select" ON "public"."company_invites" FOR SELECT TO "authenticated" USING (false);

CREATE POLICY "deny_all_update" ON "public"."company_invites" FOR UPDATE TO "authenticated" USING (false);

CREATE POLICY "members_select_self" ON "public"."company_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));

ALTER TABLE "public"."strategy_data" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy_delete" ON "public"."strategy_data" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "strategy_data"."company_id")))));

CREATE POLICY "strategy_insert" ON "public"."strategy_data" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "strategy_data"."company_id")))));

CREATE POLICY "strategy_select" ON "public"."strategy_data" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "strategy_data"."company_id")))));

CREATE POLICY "strategy_update" ON "public"."strategy_data" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "strategy_data"."company_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "strategy_data"."company_id")))));

GRANT ALL ON TABLE "public"."companies" TO "service_role";

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."companies" TO "authenticated";

GRANT ALL ON TABLE "public"."strategy_data" TO "service_role";

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."strategy_data" TO "authenticated";

GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";

GRANT SELECT ON TABLE "public"."audit_logs" TO "authenticated";

GRANT ALL ON TABLE "public"."company_invites" TO "service_role";

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_invites" TO "authenticated";

GRANT ALL ON TABLE "public"."company_members" TO "service_role";

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_members" TO "authenticated";
