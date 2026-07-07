

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."role_enum" AS ENUM (
    'admin',
    'manager',
    'member'
);


ALTER TYPE "public"."role_enum" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'manager',
    'member'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bump_strategy_data_revision"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.revision := coalesce(old.revision, 0) + 1;
  return new;
end;
$$;


ALTER FUNCTION "public"."bump_strategy_data_revision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_company_role"("c_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.role
  from company_members m
  where m.company_id = c_id
    and m.user_id    = auth.uid()
  limit 1;
$$;


ALTER FUNCTION "public"."fn_company_role"("c_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_is_company_admin"("c_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    exists (
      select 1
      from company_members m
      where m.company_id = c_id
        and m.user_id    = auth.uid()
        and m.role       = 'admin'
    )
  or exists (
      select 1
      from companies co
      where co.id = c_id
        and co.created_by = auth.uid()
    );
$$;


ALTER FUNCTION "public"."fn_is_company_admin"("c_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_role_at_least"("actual" "text", "min_role" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when actual is null then false
    else (
      case min_role
        when 'member'  then true
        when 'manager' then actual in ('manager','admin')
        when 'admin'   then actual = 'admin'
        else false
      end
    )
  end;
$$;


ALTER FUNCTION "public"."fn_role_at_least"("actual" "text", "min_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_same_company_user"("target_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from company_members me
    join company_members other
      on other.company_id = me.company_id
     and other.user_id    = target_user
    where me.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."fn_same_company_user"("target_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."forbid_delete_companies"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'Physical delete on companies is forbidden. Use logical delete instead.';
END;
$$;


ALTER FUNCTION "public"."forbid_delete_companies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_block_story_erase"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- 旧: 非空、 新: 空 → 上書き禁止（履歴に退避して元に戻す）
  IF NEW.story IS NOT NULL
     AND jsonb_typeof(NEW.story) = 'array'
     AND jsonb_array_length(NEW.story) = 0
     AND OLD.story IS NOT NULL
     AND jsonb_typeof(OLD.story) = 'array'
     AND jsonb_array_length(OLD.story) > 0
  THEN
    INSERT INTO public.story_versions(strategy_id, company_id, story_old, story_new, changed_by)
      -- ★ ここを OLD.strategy_id → OLD.id に変更
      VALUES (OLD.id, OLD.company_id, OLD.story, NEW.story, NEW.updated_by);

    -- 空配列での上書きを無効化（元の story に戻す）
    NEW.story := OLD.story;
  END IF;
  RETURN NEW;
END
$$;


ALTER FUNCTION "public"."guard_block_story_erase"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_edit_role"("c_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select exists(
    select 1 from public.company_members m
    where m.company_id = c_id
      and m.user_id = auth.uid()
      and m.role in ('admin','manager')
  );
$$;


ALTER FUNCTION "public"."has_edit_role"("c_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_admin"("c_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select exists(
    select 1 from public.company_members m
    where m.company_id = c_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_company_admin"("c_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_company_member"("p_company_id" "uuid", "p_roles" "text"[] DEFAULT ARRAY['admin'::"text", 'manager'::"text", 'member'::"text"]) RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.company_id = p_company_id
      AND m.user_id    = auth.uid()
      AND (p_roles IS NULL OR m.role = ANY(p_roles))
  );
$$;


ALTER FUNCTION "public"."is_company_member"("p_company_id" "uuid", "p_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propagate_company_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.company_id is distinct from old.company_id then
    update public.story_answers2  set company_id = new.company_id where strategy_id = new.id;
    update public.final_stories   set company_id = new.company_id where strategy_id = new.id;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."propagate_company_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_company"("p_user_id" "uuid", "p_company_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_company_id uuid;
  v_exists uuid;
begin
  if p_user_id is null or p_company_name is null or length(trim(p_company_name)) = 0 then
    raise exception 'invalid input';
  end if;

  -- 既所属ならその会社IDを返す
  select company_id into v_exists
  from public.company_members
  where user_id = p_user_id
  limit 1;

  if v_exists is not null then
    return v_exists;
  end if;

  -- 会社作成
  insert into public.companies (name, created_by)
  values (trim(p_company_name), p_user_id)
  returning id into v_company_id;

  -- 自分をadminで所属
  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, p_user_id, 'admin');

  return v_company_id;
exception
  when unique_violation then
    -- 競合時も所属会社を返す
    select company_id into v_company_id
    from public.company_members
    where user_id = p_user_id
    limit 1;
    return v_company_id;
end;
$$;


ALTER FUNCTION "public"."provision_company"("p_user_id" "uuid", "p_company_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_jsonb"("txt" "text", "fallback" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE j jsonb;
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN
    RETURN fallback;
  END IF;
  BEGIN
    j := txt::jsonb;
    RETURN j;
  EXCEPTION WHEN others THEN
    RETURN fallback;
  END;
END;
$$;


ALTER FUNCTION "public"."safe_jsonb"("txt" "text", "fallback" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_company_id_from_strategy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.strategy_id is not null then
    select sd.company_id into new.company_id
    from public.strategy_data sd
    where sd.id = new.strategy_id
    limit 1;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."set_company_id_from_strategy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = coalesce(new.updated_at, now());
  if tg_op = 'UPDATE' then new.updated_at = now(); end if;
  return new;
end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_org_alignment_stage_reflection_candidates_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_org_alignment_stage_reflection_candidates_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."final_stories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "company_id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "updated_by" "uuid",
    "final_story" "jsonb"
);


ALTER TABLE "public"."final_stories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progress_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "progress_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "department" "text",
    "rating" integer,
    "rating_comment" "text",
    "advice" "text",
    "help_request" "text",
    "company_id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "content" "text",
    "score" numeric,
    "status" "text",
    "okr_id" "uuid"
);


ALTER TABLE "public"."progress_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_answers2" (
    "user_id" "uuid",
    "answers2" "jsonb",
    "inserted_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "company_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid"
);


ALTER TABLE "public"."story_answers2" OWNER TO "postgres";


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


COMMENT ON TABLE "public"."strategy_data" IS 'GROWTH: 会社単位1行（または company_id NULL 時は user_id 単位1行）で戦略データを保持';



COMMENT ON COLUMN "public"."strategy_data"."swot_suggestions" IS 'STAGE2 SWOT AI-generated suggestions. Structure: { opportunity?: string[], threat?: string[], generatedAt?: string }. Generated by /api/generate-ot endpoint.';



COMMENT ON COLUMN "public"."strategy_data"."company_targets" IS 'STAGE2: North Star Metrics (CompanyTarget[] as jsonb)';



COMMENT ON COLUMN "public"."strategy_data"."final_story_draft" IS 'STAGE2: Final story draft version (3-state editing system)';



COMMENT ON COLUMN "public"."strategy_data"."final_story_edited" IS 'STAGE2: Final story edited version (3-state editing system)';



COMMENT ON COLUMN "public"."strategy_data"."final_story_final" IS 'STAGE2: Final story final/approved version (3-state editing system)';



CREATE OR REPLACE VIEW "public"."admin_audit_overview" WITH ("security_invoker"='true') AS
 WITH "dup" AS (
         SELECT 'strategy_data'::"text" AS "tbl",
            "strategy_data"."company_id",
            "count"(*) AS "cnt"
           FROM "public"."strategy_data"
          GROUP BY "strategy_data"."company_id"
         HAVING ("count"(*) > 1)
        ), "orphan" AS (
         SELECT 'strategy_data'::"text" AS "tbl",
            "count"(*) AS "orphan_cnt"
           FROM ("public"."strategy_data" "sd"
             LEFT JOIN "public"."companies" "c" ON (("sd"."company_id" = "c"."id")))
          WHERE ("c"."id" IS NULL)
        UNION ALL
         SELECT 'story_answers2'::"text",
            "count"(*) AS "count"
           FROM ("public"."story_answers2" "sa"
             LEFT JOIN "public"."companies" "c" ON (("sa"."company_id" = "c"."id")))
          WHERE ("c"."id" IS NULL)
        UNION ALL
         SELECT 'final_stories'::"text",
            "count"(*) AS "count"
           FROM ("public"."final_stories" "fs"
             LEFT JOIN "public"."companies" "c" ON (("fs"."company_id" = "c"."id")))
          WHERE ("c"."id" IS NULL)
        UNION ALL
         SELECT 'progress_logs'::"text",
            "count"(*) AS "count"
           FROM ("public"."progress_logs" "pl"
             LEFT JOIN "public"."companies" "c" ON (("pl"."company_id" = "c"."id")))
          WHERE ("c"."id" IS NULL)
        ), "nulls" AS (
         SELECT 'companies.created_by'::"text" AS "col",
            "count"(*) AS "null_cnt"
           FROM "public"."companies"
          WHERE ("companies"."created_by" IS NULL)
        )
 SELECT ("now"())::timestamp without time zone AS "inspected_at",
    ( SELECT COALESCE("sum"("dup"."cnt"), (0)::numeric) AS "coalesce"
           FROM "dup") AS "duplicate_company_rows",
    ( SELECT COALESCE("sum"("orphan"."orphan_cnt"), (0)::numeric) AS "coalesce"
           FROM "orphan") AS "orphan_rows",
    ( SELECT COALESCE("sum"("nulls"."null_cnt"), (0)::numeric) AS "coalesce"
           FROM "nulls") AS "critical_nulls";


ALTER VIEW "public"."admin_audit_overview" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "strategy_id" "uuid",
    "step" integer NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "agent_logs_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."agent_logs" OWNER TO "postgres";


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


COMMENT ON TABLE "public"."audit_logs" IS 'Append-only audit logs for security-sensitive actions.';



COMMENT ON COLUMN "public"."audit_logs"."company_id" IS 'Target company id. Null logs are hidden from normal authenticated users.';



COMMENT ON COLUMN "public"."audit_logs"."actor_user_id" IS 'User who performed the action.';



COMMENT ON COLUMN "public"."audit_logs"."action" IS 'Audit action name such as invite_created, member_role_changed.';



COMMENT ON COLUMN "public"."audit_logs"."before" IS 'Minimal previous state. Do not store secrets or long text.';



COMMENT ON COLUMN "public"."audit_logs"."after" IS 'Minimal next state. Do not store secrets or long text.';



COMMENT ON COLUMN "public"."audit_logs"."metadata" IS 'Additional non-sensitive metadata.';



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


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."okrs" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "department_id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "source_okr_id" "text",
    "project_snapshot_title" "text",
    "objective" "text" NOT NULL,
    "key_results_json" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "owner_user_id" "uuid",
    "owner_name" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "source_stage" "text" DEFAULT 'migration'::"text" NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "meta_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."okrs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_alignment_cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "created_by" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "situation_text" "text",
    "my_recognition_text" "text",
    "ideal_text" "text",
    "expectation_text" "text",
    "counterparty_type" "text",
    "counterparty_detail" "text",
    "visibility_mode" "text" DEFAULT 'manager_only'::"text" NOT NULL,
    "ai_result" "jsonb",
    "requested_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "org_alignment_cases_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'generated'::"text", 'alignment_requested'::"text", 'in_alignment'::"text", 'closed'::"text"]))),
    CONSTRAINT "org_alignment_cases_visibility_mode_check" CHECK (("visibility_mode" = ANY (ARRAY['anonymous'::"text", 'manager_only'::"text", 'named'::"text"])))
);


ALTER TABLE "public"."org_alignment_cases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_alignment_insight_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "insight_id" "uuid" NOT NULL,
    "insight_key" "text" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."org_alignment_insight_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_alignment_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "summary" "text",
    "insights" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "category_counts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "priority_counts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "department_trends" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source_case_count" integer DEFAULT 0 NOT NULL,
    "generated_by" "uuid",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."org_alignment_insights" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_alignment_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "requested_by" "uuid",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "handled_by" "uuid",
    "handled_at" timestamp with time zone,
    "admin_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_alignment_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'reviewing'::"text", 'scheduled'::"text", 'resolved'::"text", 'on_hold'::"text"])))
);


ALTER TABLE "public"."org_alignment_requests" OWNER TO "postgres";


COMMENT ON TABLE "public"."org_alignment_requests" IS '組織変革・違和感ルームのすり合わせ依頼管理テーブル';



COMMENT ON COLUMN "public"."org_alignment_requests"."status" IS 'pending: 未対応、reviewing: 確認中、scheduled: すり合わせ設定済み、resolved: 対応完了、on_hold: 保留';



COMMENT ON COLUMN "public"."org_alignment_requests"."admin_note" IS '管理者による対応メモ';



CREATE TABLE IF NOT EXISTS "public"."org_alignment_shared_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "source_insight_id" "text",
    "source_insight_title" "text",
    "title" "text" NOT NULL,
    "summary" "text",
    "status" "text" DEFAULT 'published'::"text" NOT NULL,
    "priority_score" integer DEFAULT 0,
    "importance" "text",
    "urgency" "text",
    "impact_scope" "text",
    "affected_departments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "related_issue_types" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "recognition_gap" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "company_axis" "text",
    "session_type" "text",
    "next_actions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "strategy_reflection" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "visibility" "text" DEFAULT 'company'::"text" NOT NULL,
    "published_by" "uuid",
    "published_at" timestamp with time zone,
    "edited_by" "uuid",
    "edited_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "related_case_count" integer DEFAULT 0 NOT NULL,
    "source_alignment_insight_id" "uuid",
    "announcement_text" "text",
    "announcement_updated_at" timestamp with time zone,
    "announcement_updated_by" "uuid",
    "source_insight_key" "text",
    "alignment_result" "text",
    "changed_things" "jsonb" DEFAULT '[]'::"jsonb",
    "unchanged_things" "jsonb" DEFAULT '[]'::"jsonb",
    "stage3_reflected_at" timestamp with time zone,
    "stage4_reflected_at" timestamp with time zone,
    CONSTRAINT "org_alignment_shared_topics_status_check" CHECK (("status" = ANY (ARRAY['published'::"text", 'in_alignment'::"text", 'action_planned'::"text", 'reflected'::"text", 'closed'::"text", 'on_hold'::"text", 'hidden'::"text"])))
);


ALTER TABLE "public"."org_alignment_shared_topics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_alignment_stage_reflection_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "shared_topic_id" "uuid" NOT NULL,
    "target_stage" "text" NOT NULL,
    "target_department" "text",
    "candidate_type" "text" NOT NULL,
    "title" "text",
    "summary" "text",
    "objective" "text",
    "key_results" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "owner" "text",
    "due_date" "date",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    CONSTRAINT "org_alignment_stage_reflection_candidates_candidate_type_check" CHECK (("candidate_type" = ANY (ARRAY['project'::"text", 'okr'::"text"]))),
    CONSTRAINT "org_alignment_stage_reflection_candidates_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text"]))),
    CONSTRAINT "org_alignment_stage_reflection_candidates_target_stage_check" CHECK (("target_stage" = ANY (ARRAY['stage3'::"text", 'stage4'::"text"])))
);


ALTER TABLE "public"."org_alignment_stage_reflection_candidates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_histories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "story" "text" NOT NULL,
    "summary" "text",
    "answers" "jsonb",
    "answers2" "jsonb",
    "industry" "text",
    "revenue" "text",
    "employees" "text",
    "thought" "text",
    "mission" "text",
    "vision" "text",
    "value" "text",
    "strength" "text",
    "weakness" "text",
    "opportunity" "text",
    "threat" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"())
);


ALTER TABLE "public"."story_histories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid",
    "company_id" "uuid",
    "story_old" "jsonb",
    "story_new" "jsonb",
    "changed_at" timestamp with time zone DEFAULT "now"(),
    "changed_by" "uuid"
);


ALTER TABLE "public"."story_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."strategy_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "strategy_id" "text" NOT NULL,
    "chapter_index" integer NOT NULL,
    "answers2" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "strategy_sessions_chapter_index_check" CHECK (("chapter_index" >= 0))
);


ALTER TABLE "public"."strategy_sessions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."users" WITH ("security_invoker"='true') AS
 SELECT "p"."user_id" AS "id",
    NULL::character varying(255) AS "email",
    NULL::"text" AS "name",
    "cm"."department_id",
    "cm"."role"
   FROM ("public"."profiles" "p"
     LEFT JOIN "public"."company_members" "cm" ON ((("cm"."user_id" = "p"."user_id") AND ("cm"."company_id" = "p"."company_id"))));


ALTER VIEW "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agent_logs"
    ADD CONSTRAINT "agent_logs_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."final_stories"
    ADD CONSTRAINT "final_stories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."okrs"
    ADD CONSTRAINT "okrs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_alignment_cases"
    ADD CONSTRAINT "org_alignment_cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_alignment_insight_sources"
    ADD CONSTRAINT "org_alignment_insight_sources_insight_id_insight_key_case_i_key" UNIQUE ("insight_id", "insight_key", "case_id");



ALTER TABLE ONLY "public"."org_alignment_insight_sources"
    ADD CONSTRAINT "org_alignment_insight_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_alignment_insights"
    ADD CONSTRAINT "org_alignment_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_alignment_requests"
    ADD CONSTRAINT "org_alignment_requests_company_id_case_id_requested_by_key" UNIQUE ("company_id", "case_id", "requested_by");



ALTER TABLE ONLY "public"."org_alignment_requests"
    ADD CONSTRAINT "org_alignment_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_alignment_shared_topics"
    ADD CONSTRAINT "org_alignment_shared_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_alignment_stage_reflection_candidates"
    ADD CONSTRAINT "org_alignment_stage_reflection_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."progress_logs"
    ADD CONSTRAINT "progress_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."story_answers2"
    ADD CONSTRAINT "story_answers2_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."story_histories"
    ADD CONSTRAINT "story_histories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."story_versions"
    ADD CONSTRAINT "story_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_data"
    ADD CONSTRAINT "strategy_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_sessions"
    ADD CONSTRAINT "strategy_sessions_pkey" PRIMARY KEY ("id");



CREATE INDEX "company_invites_company_email_ix" ON "public"."company_invites" USING "btree" ("company_id", "email");



CREATE UNIQUE INDEX "company_invites_token_hash_ux" ON "public"."company_invites" USING "btree" ("token_hash");



CREATE UNIQUE INDEX "final_stories_company_id_key" ON "public"."final_stories" USING "btree" ("company_id");



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



CREATE INDEX "idx_departments_company" ON "public"."departments" USING "btree" ("company_id");



CREATE INDEX "idx_departments_company_id" ON "public"."departments" USING "btree" ("company_id");



CREATE INDEX "idx_final_stories_company" ON "public"."final_stories" USING "btree" ("company_id");



CREATE INDEX "idx_final_stories_company_id" ON "public"."final_stories" USING "btree" ("company_id");



CREATE INDEX "idx_final_stories_company_updated" ON "public"."final_stories" USING "btree" ("company_id", "updated_at" DESC);



CREATE INDEX "idx_final_stories_user" ON "public"."final_stories" USING "btree" ("user_id");



CREATE INDEX "idx_insight_sources_case" ON "public"."org_alignment_insight_sources" USING "btree" ("case_id");



CREATE INDEX "idx_insight_sources_insight" ON "public"."org_alignment_insight_sources" USING "btree" ("insight_id", "insight_key");



CREATE INDEX "idx_members_company" ON "public"."company_members" USING "btree" ("company_id");



CREATE INDEX "idx_members_user" ON "public"."company_members" USING "btree" ("user_id");



CREATE INDEX "idx_okrs_company_id" ON "public"."okrs" USING "btree" ("company_id");



CREATE INDEX "idx_okrs_is_deleted" ON "public"."okrs" USING "btree" ("is_deleted");



CREATE INDEX "idx_okrs_owner_user_id" ON "public"."okrs" USING "btree" ("owner_user_id");



CREATE INDEX "idx_okrs_project_id_sort" ON "public"."okrs" USING "btree" ("project_id", "sort_order");



CREATE INDEX "idx_okrs_strategy_id" ON "public"."okrs" USING "btree" ("strategy_id");



CREATE INDEX "idx_okrs_strategy_project_not_deleted" ON "public"."okrs" USING "btree" ("strategy_id", "project_id", "is_deleted");



CREATE INDEX "idx_org_alignment_requests_case_id" ON "public"."org_alignment_requests" USING "btree" ("case_id");



CREATE INDEX "idx_org_alignment_requests_company_id" ON "public"."org_alignment_requests" USING "btree" ("company_id");



CREATE INDEX "idx_org_alignment_requests_company_status" ON "public"."org_alignment_requests" USING "btree" ("company_id", "status");



CREATE INDEX "idx_org_alignment_requests_requested_at" ON "public"."org_alignment_requests" USING "btree" ("requested_at" DESC);



CREATE INDEX "idx_org_alignment_requests_status" ON "public"."org_alignment_requests" USING "btree" ("status");



CREATE INDEX "idx_org_alignment_shared_topics_company_id" ON "public"."org_alignment_shared_topics" USING "btree" ("company_id");



CREATE INDEX "idx_org_alignment_shared_topics_company_source_status" ON "public"."org_alignment_shared_topics" USING "btree" ("company_id", "source_alignment_insight_id", "status");



CREATE INDEX "idx_org_alignment_shared_topics_company_status" ON "public"."org_alignment_shared_topics" USING "btree" ("company_id", "status");



CREATE INDEX "idx_org_alignment_shared_topics_created_at" ON "public"."org_alignment_shared_topics" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_org_alignment_shared_topics_source_alignment_insight_id" ON "public"."org_alignment_shared_topics" USING "btree" ("source_alignment_insight_id");



CREATE INDEX "idx_org_alignment_shared_topics_status" ON "public"."org_alignment_shared_topics" USING "btree" ("status");



CREATE INDEX "idx_org_alignment_stage_reflection_candidates_company_id" ON "public"."org_alignment_stage_reflection_candidates" USING "btree" ("company_id");



CREATE INDEX "idx_org_alignment_stage_reflection_candidates_company_stage_sta" ON "public"."org_alignment_stage_reflection_candidates" USING "btree" ("company_id", "target_stage", "status");



CREATE INDEX "idx_org_alignment_stage_reflection_candidates_shared_topic_id" ON "public"."org_alignment_stage_reflection_candidates" USING "btree" ("shared_topic_id");



CREATE INDEX "idx_org_alignment_stage_reflection_candidates_target_stage_stat" ON "public"."org_alignment_stage_reflection_candidates" USING "btree" ("target_stage", "status");



CREATE INDEX "idx_profiles_company_id" ON "public"."profiles" USING "btree" ("company_id");



CREATE INDEX "idx_progress_logs_company" ON "public"."progress_logs" USING "btree" ("company_id");



CREATE INDEX "idx_progress_logs_company_id" ON "public"."progress_logs" USING "btree" ("company_id");



CREATE INDEX "idx_progress_logs_created_at" ON "public"."progress_logs" USING "btree" ("created_at");



CREATE INDEX "idx_progress_logs_okr_id" ON "public"."progress_logs" USING "btree" ("okr_id");



CREATE INDEX "idx_progress_logs_user" ON "public"."progress_logs" USING "btree" ("user_id");



CREATE INDEX "idx_progress_logs_user_id" ON "public"."progress_logs" USING "btree" ("user_id");



CREATE INDEX "idx_shared_topics_source_insight" ON "public"."org_alignment_shared_topics" USING "btree" ("source_insight_id", "source_insight_key");



CREATE INDEX "idx_story_answers2_company" ON "public"."story_answers2" USING "btree" ("company_id");



CREATE INDEX "idx_story_answers2_company_id" ON "public"."story_answers2" USING "btree" ("company_id");



CREATE INDEX "idx_story_answers2_company_updated" ON "public"."story_answers2" USING "btree" ("company_id", "updated_at" DESC);



CREATE INDEX "idx_story_answers2_user" ON "public"."story_answers2" USING "btree" ("user_id");



CREATE INDEX "idx_strategy_company" ON "public"."strategy_data" USING "btree" ("company_id");



CREATE INDEX "idx_strategy_data_company" ON "public"."strategy_data" USING "btree" ("company_id");



CREATE INDEX "idx_strategy_data_company_id" ON "public"."strategy_data" USING "btree" ("company_id");



CREATE INDEX "idx_strategy_sessions_lookup" ON "public"."strategy_sessions" USING "btree" ("user_id", "strategy_id", "chapter_index", "created_at" DESC);



CREATE INDEX "ix_final_stories_company" ON "public"."final_stories" USING "btree" ("company_id");



CREATE INDEX "ix_final_stories_company_created_at" ON "public"."final_stories" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "ix_progress_logs_company" ON "public"."progress_logs" USING "btree" ("company_id");



CREATE INDEX "ix_progress_logs_company_created_at" ON "public"."progress_logs" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "ix_story_answers2_company" ON "public"."story_answers2" USING "btree" ("company_id");



CREATE UNIQUE INDEX "okrs_unique_active_business_key" ON "public"."okrs" USING "btree" ("company_id", "strategy_id", "department_id", "project_id", "objective") WHERE (COALESCE("is_deleted", false) = false);



CREATE UNIQUE INDEX "strategy_data_company_unique" ON "public"."strategy_data" USING "btree" ("company_id") WHERE ("company_id" IS NOT NULL);



CREATE INDEX "strategy_data_story_draft_gin" ON "public"."strategy_data" USING "gin" ("story_draft");



CREATE INDEX "strategy_data_updated_at_idx" ON "public"."strategy_data" USING "btree" ("updated_at" DESC);



CREATE UNIQUE INDEX "strategy_data_user_id_key" ON "public"."strategy_data" USING "btree" ("user_id");



CREATE UNIQUE INDEX "strategy_data_user_legacy_unique" ON "public"."strategy_data" USING "btree" ("user_id") WHERE ("company_id" IS NULL);



CREATE UNIQUE INDEX "strategy_sessions_unique_active" ON "public"."strategy_sessions" USING "btree" ("user_id", "strategy_id", "chapter_index") WHERE "is_active";



CREATE UNIQUE INDEX "uq_company_members_pair" ON "public"."company_members" USING "btree" ("company_id", "user_id");



CREATE UNIQUE INDEX "uq_final_stories_company" ON "public"."final_stories" USING "btree" ("company_id");



CREATE UNIQUE INDEX "uq_shared_topics_source_insight" ON "public"."org_alignment_shared_topics" USING "btree" ("source_insight_id", "source_insight_key") WHERE (("source_insight_id" IS NOT NULL) AND ("source_insight_key" IS NOT NULL));



CREATE UNIQUE INDEX "uq_story_answers2_company" ON "public"."story_answers2" USING "btree" ("company_id");



CREATE UNIQUE INDEX "uq_strategy_company" ON "public"."strategy_data" USING "btree" ("company_id") WHERE ("company_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_strategy_data_company" ON "public"."strategy_data" USING "btree" ("company_id");



CREATE UNIQUE INDEX "uq_strategy_user_personal" ON "public"."strategy_data" USING "btree" ("user_id") WHERE ("company_id" IS NULL);



CREATE UNIQUE INDEX "ux_company_members_company_user" ON "public"."company_members" USING "btree" ("company_id", "user_id");



CREATE UNIQUE INDEX "ux_story_answers2_company" ON "public"."story_answers2" USING "btree" ("company_id");



CREATE UNIQUE INDEX "ux_strategy_data_company" ON "public"."strategy_data" USING "btree" ("company_id");



CREATE OR REPLACE TRIGGER "trg_block_story_erase" BEFORE UPDATE OF "story" ON "public"."strategy_data" FOR EACH ROW EXECUTE FUNCTION "public"."guard_block_story_erase"();



CREATE OR REPLACE TRIGGER "trg_companies_updated_at" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_company_members_updated_at" BEFORE UPDATE ON "public"."company_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_final_stories_updated_at" BEFORE UPDATE ON "public"."final_stories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_forbid_delete_companies" BEFORE DELETE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_delete_companies"();



CREATE OR REPLACE TRIGGER "trg_okrs_set_updated_at" BEFORE UPDATE ON "public"."okrs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_org_alignment_requests_updated_at" BEFORE UPDATE ON "public"."org_alignment_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_progress_logs_updated_at" BEFORE UPDATE ON "public"."progress_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_propagate_company_change" AFTER UPDATE OF "company_id" ON "public"."strategy_data" FOR EACH ROW EXECUTE FUNCTION "public"."propagate_company_change"();



CREATE OR REPLACE TRIGGER "trg_set_company_id_answers" BEFORE INSERT OR UPDATE OF "strategy_id" ON "public"."story_answers2" FOR EACH ROW EXECUTE FUNCTION "public"."set_company_id_from_strategy"();



CREATE OR REPLACE TRIGGER "trg_set_company_id_final" BEFORE INSERT OR UPDATE OF "strategy_id" ON "public"."final_stories" FOR EACH ROW EXECUTE FUNCTION "public"."set_company_id_from_strategy"();



CREATE OR REPLACE TRIGGER "trg_story_answers2_updated_at" BEFORE UPDATE ON "public"."story_answers2" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_strategy_data_updated_at" BEFORE UPDATE ON "public"."strategy_data" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_update_org_alignment_stage_reflection_candidates_updated_at" BEFORE UPDATE ON "public"."org_alignment_stage_reflection_candidates" FOR EACH ROW EXECUTE FUNCTION "public"."update_org_alignment_stage_reflection_candidates_updated_at"();



ALTER TABLE ONLY "public"."agent_logs"
    ADD CONSTRAINT "agent_logs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategy_data"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_logs"
    ADD CONSTRAINT "agent_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."final_stories"
    ADD CONSTRAINT "final_stories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."final_stories"
    ADD CONSTRAINT "fk_final_stories_company" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."org_alignment_shared_topics"
    ADD CONSTRAINT "fk_org_alignment_shared_topics_source_alignment_insight_id" FOREIGN KEY ("source_alignment_insight_id") REFERENCES "public"."org_alignment_insights"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."story_answers2"
    ADD CONSTRAINT "fk_story_answers2_company" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."org_alignment_insight_sources"
    ADD CONSTRAINT "org_alignment_insight_sources_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."org_alignment_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_alignment_insight_sources"
    ADD CONSTRAINT "org_alignment_insight_sources_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "public"."org_alignment_insights"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_alignment_requests"
    ADD CONSTRAINT "org_alignment_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."org_alignment_cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_alignment_requests"
    ADD CONSTRAINT "org_alignment_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_alignment_requests"
    ADD CONSTRAINT "org_alignment_requests_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_alignment_requests"
    ADD CONSTRAINT "org_alignment_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_alignment_shared_topics"
    ADD CONSTRAINT "org_alignment_shared_topics_announcement_updated_by_fkey" FOREIGN KEY ("announcement_updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."org_alignment_stage_reflection_candidates"
    ADD CONSTRAINT "org_alignment_stage_reflection_candidates_shared_topic_id_fkey" FOREIGN KEY ("shared_topic_id") REFERENCES "public"."org_alignment_shared_topics"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progress_logs"
    ADD CONSTRAINT "progress_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."progress_logs"
    ADD CONSTRAINT "progress_logs_okr_id_fkey" FOREIGN KEY ("okr_id") REFERENCES "public"."okrs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."progress_logs"
    ADD CONSTRAINT "progress_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."story_answers2"
    ADD CONSTRAINT "story_answers2_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."story_histories"
    ADD CONSTRAINT "story_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_data"
    ADD CONSTRAINT "strategy_data_company_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."strategy_data"
    ADD CONSTRAINT "strategy_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



CREATE POLICY "Admins can manage shared topics" ON "public"."org_alignment_shared_topics" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "org_alignment_shared_topics"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "org_alignment_shared_topics"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text")))));



CREATE POLICY "Members can read published shared topics" ON "public"."org_alignment_shared_topics" FOR SELECT USING ((("status" = ANY (ARRAY['published'::"text", 'in_alignment'::"text", 'action_planned'::"text", 'reflected'::"text", 'closed'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "org_alignment_shared_topics"."company_id") AND ("cm"."user_id" = "auth"."uid"()))))));



CREATE POLICY "admin_update_org_alignment_requests" ON "public"."org_alignment_requests" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "org_alignment_requests"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "org_alignment_requests"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text")))));



ALTER TABLE "public"."agent_logs" ENABLE ROW LEVEL SECURITY;


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



ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dept_insert_admin" ON "public"."departments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "departments"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text")))));



CREATE POLICY "dept_select_company" ON "public"."departments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "departments"."company_id") AND ("m"."user_id" = "auth"."uid"())))));



CREATE POLICY "dept_update_admin" ON "public"."departments" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "departments"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."company_id" = "departments"."company_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'admin'::"text")))));



ALTER TABLE "public"."final_stories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "final_stories_delete" ON "public"."final_stories" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "final_stories"."company_id")))));



CREATE POLICY "final_stories_insert" ON "public"."final_stories" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "final_stories"."company_id")))));



CREATE POLICY "final_stories_select" ON "public"."final_stories" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "final_stories"."company_id")))));



CREATE POLICY "final_stories_update" ON "public"."final_stories" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "final_stories"."company_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "final_stories"."company_id")))));



CREATE POLICY "ins_own_sessions" ON "public"."strategy_sessions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "member_insert_org_alignment_requests" ON "public"."org_alignment_requests" FOR INSERT WITH CHECK ((("requested_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "org_alignment_requests"."company_id") AND ("cm"."user_id" = "auth"."uid"())))) AND (EXISTS ( SELECT 1
   FROM "public"."org_alignment_cases" "c"
  WHERE (("c"."id" = "org_alignment_requests"."case_id") AND ("c"."company_id" = "org_alignment_requests"."company_id"))))));



CREATE POLICY "member_select_own_org_alignment_requests" ON "public"."org_alignment_requests" FOR SELECT USING ((("requested_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "org_alignment_requests"."company_id") AND ("cm"."user_id" = "auth"."uid"()) AND ("cm"."role" = 'admin'::"text"))))));



CREATE POLICY "members_select_self" ON "public"."company_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."okrs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "okrs_delete_policy" ON "public"."okrs" FOR DELETE USING (((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "okrs"."company_id") AND ("cm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."companies" "c"
  WHERE (("c"."id" = "okrs"."company_id") AND ("c"."created_by" = "auth"."uid"()))))));



CREATE POLICY "okrs_insert_policy" ON "public"."okrs" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "okrs"."company_id") AND ("cm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."companies" "c"
  WHERE (("c"."id" = "okrs"."company_id") AND ("c"."created_by" = "auth"."uid"()))))));



CREATE POLICY "okrs_select_policy" ON "public"."okrs" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "okrs"."company_id") AND ("cm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."companies" "c"
  WHERE (("c"."id" = "okrs"."company_id") AND ("c"."created_by" = "auth"."uid"()))))));



CREATE POLICY "okrs_update_policy" ON "public"."okrs" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "okrs"."company_id") AND ("cm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."companies" "c"
  WHERE (("c"."id" = "okrs"."company_id") AND ("c"."created_by" = "auth"."uid"())))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."company_members" "cm"
  WHERE (("cm"."company_id" = "okrs"."company_id") AND ("cm"."user_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."companies" "c"
  WHERE (("c"."id" = "okrs"."company_id") AND ("c"."created_by" = "auth"."uid"()))))));



ALTER TABLE "public"."org_alignment_cases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_alignment_cases_delete_company_scoped" ON "public"."org_alignment_cases" FOR DELETE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."fn_is_company_admin"("company_id")));



CREATE POLICY "org_alignment_cases_insert_own_company" ON "public"."org_alignment_cases" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = "auth"."uid"()) AND "public"."is_company_member"("company_id", ARRAY['admin'::"text", 'member'::"text"])));



CREATE POLICY "org_alignment_cases_select_company_scoped" ON "public"."org_alignment_cases" FOR SELECT TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."fn_is_company_admin"("company_id")));



CREATE POLICY "org_alignment_cases_update_company_scoped" ON "public"."org_alignment_cases" FOR UPDATE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."fn_is_company_admin"("company_id"))) WITH CHECK ((("created_by" = "auth"."uid"()) OR "public"."fn_is_company_admin"("company_id")));



ALTER TABLE "public"."org_alignment_insight_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_alignment_insights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_alignment_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_alignment_shared_topics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."org_alignment_stage_reflection_candidates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."progress_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "progress_logs_delete" ON "public"."progress_logs" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "progress_logs"."company_id")))));



CREATE POLICY "progress_logs_insert" ON "public"."progress_logs" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "progress_logs"."company_id")))));



CREATE POLICY "progress_logs_select" ON "public"."progress_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "progress_logs"."company_id")))));



CREATE POLICY "progress_logs_update" ON "public"."progress_logs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "progress_logs"."company_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "progress_logs"."company_id")))));



CREATE POLICY "sel_own_sessions" ON "public"."strategy_sessions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "sh_ins" ON "public"."story_histories" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "sh_sel" ON "public"."story_histories" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."story_answers2" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "story_answers_delete" ON "public"."story_answers2" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "story_answers2"."company_id")))));



CREATE POLICY "story_answers_insert" ON "public"."story_answers2" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "story_answers2"."company_id")))));



CREATE POLICY "story_answers_select" ON "public"."story_answers2" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "story_answers2"."company_id")))));



CREATE POLICY "story_answers_update" ON "public"."story_answers2" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "story_answers2"."company_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "story_answers2"."company_id")))));



ALTER TABLE "public"."story_histories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."story_versions" ENABLE ROW LEVEL SECURITY;


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



ALTER TABLE "public"."strategy_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategy_update" ON "public"."strategy_data" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "strategy_data"."company_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."company_members" "m"
  WHERE (("m"."user_id" = "auth"."uid"()) AND ("m"."company_id" = "strategy_data"."company_id")))));



CREATE POLICY "upd_own_sessions" ON "public"."strategy_sessions" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_strategy_data_revision"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_strategy_data_revision"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_strategy_data_revision"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_company_role"("c_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_company_role"("c_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_company_role"("c_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_is_company_admin"("c_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_is_company_admin"("c_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_is_company_admin"("c_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_role_at_least"("actual" "text", "min_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_role_at_least"("actual" "text", "min_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_role_at_least"("actual" "text", "min_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_same_company_user"("target_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_same_company_user"("target_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_same_company_user"("target_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."forbid_delete_companies"() TO "anon";
GRANT ALL ON FUNCTION "public"."forbid_delete_companies"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."forbid_delete_companies"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_block_story_erase"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_block_story_erase"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_block_story_erase"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_edit_role"("c_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_edit_role"("c_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_edit_role"("c_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_company_admin"("c_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_company_admin"("c_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_company_admin"("c_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_company_member"("p_company_id" "uuid", "p_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_company_member"("p_company_id" "uuid", "p_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_company_member"("p_company_id" "uuid", "p_roles" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."propagate_company_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."propagate_company_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."propagate_company_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."provision_company"("p_user_id" "uuid", "p_company_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."provision_company"("p_user_id" "uuid", "p_company_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."safe_jsonb"("txt" "text", "fallback" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."safe_jsonb"("txt" "text", "fallback" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."safe_jsonb"("txt" "text", "fallback" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_company_id_from_strategy"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_company_id_from_strategy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_company_id_from_strategy"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_org_alignment_stage_reflection_candidates_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_org_alignment_stage_reflection_candidates_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_org_alignment_stage_reflection_candidates_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."companies" TO "authenticated";



GRANT ALL ON TABLE "public"."final_stories" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."final_stories" TO "authenticated";



GRANT ALL ON TABLE "public"."progress_logs" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."progress_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."story_answers2" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."story_answers2" TO "authenticated";



GRANT ALL ON TABLE "public"."strategy_data" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."strategy_data" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_audit_overview" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."admin_audit_overview" TO "authenticated";



GRANT ALL ON TABLE "public"."agent_logs" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."audit_logs" TO "authenticated";



GRANT ALL ON TABLE "public"."company_invites" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_invites" TO "authenticated";



GRANT ALL ON TABLE "public"."company_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_members" TO "authenticated";



GRANT ALL ON TABLE "public"."departments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."departments" TO "authenticated";



GRANT ALL ON TABLE "public"."okrs" TO "anon";
GRANT ALL ON TABLE "public"."okrs" TO "authenticated";
GRANT ALL ON TABLE "public"."okrs" TO "service_role";



GRANT ALL ON TABLE "public"."org_alignment_cases" TO "anon";
GRANT ALL ON TABLE "public"."org_alignment_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."org_alignment_cases" TO "service_role";



GRANT ALL ON TABLE "public"."org_alignment_insight_sources" TO "anon";
GRANT ALL ON TABLE "public"."org_alignment_insight_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."org_alignment_insight_sources" TO "service_role";



GRANT ALL ON TABLE "public"."org_alignment_insights" TO "anon";
GRANT ALL ON TABLE "public"."org_alignment_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."org_alignment_insights" TO "service_role";



GRANT ALL ON TABLE "public"."org_alignment_requests" TO "anon";
GRANT ALL ON TABLE "public"."org_alignment_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."org_alignment_requests" TO "service_role";



GRANT ALL ON TABLE "public"."org_alignment_shared_topics" TO "anon";
GRANT ALL ON TABLE "public"."org_alignment_shared_topics" TO "authenticated";
GRANT ALL ON TABLE "public"."org_alignment_shared_topics" TO "service_role";



GRANT ALL ON TABLE "public"."org_alignment_stage_reflection_candidates" TO "anon";
GRANT ALL ON TABLE "public"."org_alignment_stage_reflection_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."org_alignment_stage_reflection_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."story_histories" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."story_histories" TO "authenticated";



GRANT ALL ON TABLE "public"."story_versions" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_sessions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."strategy_sessions" TO "authenticated";



GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."users" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






