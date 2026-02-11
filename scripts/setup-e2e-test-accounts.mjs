#!/usr/bin/env node

/**
 * RBAC E2E Test Account Setup Script
 * テスト用アカウント（admin, manager, member）を作成して Bearer token を取得する
 *
 * 用法:
 *   node scripts/setup-e2e-test-accounts.mjs
 *
 * 環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL - Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service Role Key
 *   NEXT_PUBLIC_SITE_URL - Site URL (default: http://localhost:3000)
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TEST_EMAIL_PREFIX = `rbac-test-${Date.now()}`;
const TEST_PASSWORD = "RbacTest123!@#";

const TEST_ACCOUNTS = [
  {
    email: `${TEST_EMAIL_PREFIX}-admin@test.example.com`,
    password: TEST_PASSWORD,
    role: "admin",
    department_id: null,
  },
  {
    email: `${TEST_EMAIL_PREFIX}-manager@test.example.com`,
    password: TEST_PASSWORD,
    role: "manager",
    department_id: "dept-001",
  },
  {
    email: `${TEST_EMAIL_PREFIX}-member@test.example.com`,
    password: TEST_PASSWORD,
    role: "member",
    department_id: null,
  },
];

async function createTestCompany() {
  console.log("📍 Creating test company...");
  const companyName = `RBAC-TEST-${new Date().toISOString().split("T")[0]}`;

  const { data, error } = await admin
    .from("companies")
    .insert([{ name: companyName }])
    .select("id")
    .single();

  if (error) {
    console.error("❌ Failed to create company:", error.message);
    process.exit(1);
  }

  console.log(`✅ Company created: ${data.id}`);
  return data.id;
}

async function createTestUsers(companyId) {
  console.log("📍 Creating test users...");
  const users = [];

  for (const account of TEST_ACCOUNTS) {
    // 1. Create user
    const { data: authUser, error: authError } = await admin.auth.admin.createUser(
      {
        email: account.email,
        password: account.password,
        email_confirm: true,
      }
    );

    if (authError) {
      console.error(`❌ Failed to create user ${account.email}:`, authError.message);
      process.exit(1);
    }

    console.log(`✅ User created: ${account.email} (${authUser.user.id})`);

    // 2. Create company_member record
    const { error: memberError } = await admin
      .from("company_members")
      .insert([
        {
          user_id: authUser.user.id,
          company_id: companyId,
          role: account.role,
          department_id: account.department_id,
        },
      ]);

    if (memberError) {
      console.error(
        `❌ Failed to create membership for ${account.email}:`,
        memberError.message
      );
      process.exit(1);
    }

    users.push({
      email: account.email,
      userId: authUser.user.id,
      password: account.password,
      role: account.role,
      departmentId: account.department_id,
    });
  }

  return users;
}

async function getTokens(users) {
  console.log("📍 Obtaining Bearer tokens...");
  const tokens = [];

  for (const user of users) {
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_URL.split(".")[0], // anon key would be better but we have service role
        },
        body: JSON.stringify({
          email: user.email,
          password: user.password,
        }),
      }
    );

    const data = await response.json();

    if (!data.access_token) {
      console.error(
        `❌ Failed to get token for ${user.email}:`,
        data.error_description || data.error
      );
      process.exit(1);
    }

    console.log(`✅ Token obtained: ${user.email} (${user.role})`);
    tokens.push({
      email: user.email,
      role: user.role,
      userId: user.userId,
      token: data.access_token,
    });
  }

  return tokens;
}

async function createStrategy(companyId, companyNumber = 1) {
  console.log(`📍 Creating strategy for company ${companyNumber}...`);

  const { data, error } = await admin
    .from("strategies")
    .insert([
      {
        company_id: companyId,
        title: `Test Strategy Company ${companyNumber}`,
        description: "Test strategy for RBAC E2E testing",
        status: "draft",
      },
    ])
    .select("id")
    .single();

  if (error) {
    console.error(
      `❌ Failed to create strategy for company ${companyNumber}:`,
      error.message
    );
    process.exit(1);
  }

  console.log(`✅ Strategy created: ${data.id}`);
  return data.id;
}

async function main() {
  console.log("========================================");
  console.log("RBAC E2E Test Account Setup");
  console.log("========================================");
  console.log("");

  // Create primary company and test users
  const companyA_id = await createTestCompany();
  const users = await createTestUsers(companyA_id);
  const tokens = await getTokens(users);

  // Create strategy for primary company
  const strategyA_id = await createStrategy(companyA_id, 1);

  // Create secondary company with strategy (for cross-company test)
  const companyB_id = await createTestCompany();
  const strategyB_id = await createStrategy(companyB_id, 2);

  console.log("");
  console.log("========================================");
  console.log("✅ Setup Complete!");
  console.log("========================================");
  console.log("");

  // Output environment variables
  console.log("📋 Copy and paste the following to set environment variables:");
  console.log("");
  console.log("=== For bash/zsh ===");
  console.log(`export BASE_URL="http://localhost:3000"`);
  console.log(
    `export TOKEN_ADMIN="${tokens.find((t) => t.role === "admin")?.token}"`
  );
  console.log(
    `export TOKEN_MANAGER="${tokens.find((t) => t.role === "manager")?.token}"`
  );
  console.log(
    `export TOKEN_MEMBER="${tokens.find((t) => t.role === "member")?.token}"`
  );
  console.log(`export STRATEGY_ID_COMPANY_A="${strategyA_id}"`);
  console.log(`export STRATEGY_ID_COMPANY_B="${strategyB_id}"`);
  console.log(
    `export USER_ID_ADMIN="${tokens.find((t) => t.role === "admin")?.userId}"`
  );
  console.log(
    `export USER_ID_MEMBER="${tokens.find((t) => t.role === "member")?.userId}"`
  );
  console.log(`export COMPANY_ID_A="${companyA_id}"`);
  console.log("");

  console.log("=== For PowerShell (Windows) ===");
  console.log(`$env:BASE_URL = "http://localhost:3000"`);
  console.log(
    `$env:TOKEN_ADMIN = "${tokens.find((t) => t.role === "admin")?.token}"`
  );
  console.log(
    `$env:TOKEN_MANAGER = "${tokens.find((t) => t.role === "manager")?.token}"`
  );
  console.log(
    `$env:TOKEN_MEMBER = "${tokens.find((t) => t.role === "member")?.token}"`
  );
  console.log(`$env:STRATEGY_ID_COMPANY_A = "${strategyA_id}"`);
  console.log(`$env:STRATEGY_ID_COMPANY_B = "${strategyB_id}"`);
  console.log(
    `$env:USER_ID_ADMIN = "${tokens.find((t) => t.role === "admin")?.userId}"`
  );
  console.log(
    `$env:USER_ID_MEMBER = "${tokens.find((t) => t.role === "member")?.userId}"`
  );
  console.log(`$env:COMPANY_ID_A = "${companyA_id}"`);
  console.log("");

  // Save to .env.e2e file
  const envContent = `# RBAC E2E Test Environment Variables
# Generated: ${new Date().toISOString()}
BASE_URL="http://localhost:3000"
TOKEN_ADMIN="${tokens.find((t) => t.role === "admin")?.token}"
TOKEN_MANAGER="${tokens.find((t) => t.role === "manager")?.token}"
TOKEN_MEMBER="${tokens.find((t) => t.role === "member")?.token}"
STRATEGY_ID_COMPANY_A="${strategyA_id}"
STRATEGY_ID_COMPANY_B="${strategyB_id}"
USER_ID_ADMIN="${tokens.find((t) => t.role === "admin")?.userId}"
USER_ID_MEMBER="${tokens.find((t) => t.role === "member")?.userId}"
COMPANY_ID_A="${companyA_id}"
`;

  const envPath = path.join(process.cwd(), ".env.e2e");
  fs.writeFileSync(envPath, envContent, "utf-8");
  console.log(`💾 Saved to: .env.e2e`);
  console.log("");

  // Output summary
  console.log("📊 Test Setup Summary:");
  console.log(`  Company A (primary): ${companyA_id}`);
  console.log(`  Company B (for cross-company test): ${companyB_id}`);
  console.log(`  Strategy A: ${strategyA_id}`);
  console.log(`  Strategy B: ${strategyB_id}`);
  console.log("");
  console.log("👤 Test Accounts:");
  for (const token of tokens) {
    console.log(`  - ${token.email} (${token.role})`);
  }
  console.log("");
  console.log("📝 Next Steps:");
  console.log("  1. Copy environment variables from above");
  console.log("  2. Run: npm run rbac:e2e:min");
  console.log("  3. Check results in RBAC_E2E_RESULTS.md");
  console.log("");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
