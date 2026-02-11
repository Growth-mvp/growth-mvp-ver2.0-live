#!/bin/bash

#
# RBAC Final Regression Checks
# 回帰防止のための最小限の自動チェック
#
# 用法: bash scripts/rbac-check.sh
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "RBAC Final Regression Checks"
echo "========================================="
echo ""

# 色定義
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# ========================================
# CHECK 1: Service Role Key Isolation
# ========================================
echo "[1/4] Checking Service Role Key isolation..."

COUNT=$(grep -r "SUPABASE_SERVICE_ROLE_KEY" "$PROJECT_ROOT" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=.next 2>/dev/null | \
  grep -v "app/api" | grep -v "lib/server" | grep -v "lib/supabaseAdmin" | grep -v "utils/supabase" | wc -l)

if [ "$COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ PASS${NC}: Service Role Key not in client code"
  ((PASS_COUNT++))
else
  echo -e "${RED}❌ FAIL${NC}: Service Role Key found in $COUNT locations"
  ((FAIL_COUNT++))
fi
echo ""

# ========================================
# CHECK 2: Bearer Token in APIs
# ========================================
echo "[2/4] Checking Bearer token in write APIs..."

CHECK_PASS=0
for api_path in "admin/invite" "members" "ask-ceo-agent"; do
  file="$PROJECT_ROOT/app/api/$api_path/route.ts"
  if grep -q "getAuthUserIdFromBearer\|bearer(" "$file" 2>/dev/null; then
    ((CHECK_PASS++))
  fi
done

if [ "$CHECK_PASS" -ge 2 ]; then
  echo -e "${GREEN}✅ PASS${NC}: Bearer validation in $CHECK_PASS/3 APIs"
  ((PASS_COUNT++))
else
  echo -e "${YELLOW}⚠️ WARN${NC}: Bearer validation in only $CHECK_PASS/3 APIs"
  ((WARN_COUNT++))
fi
echo ""

# ========================================
# CHECK 3: Company Scope Filtering
# ========================================
echo "[3/4] Checking company_id filtering..."

COMPANY_ID_COUNT=$(grep -r "eq('company_id'" "$PROJECT_ROOT/app/api" --include="*.ts" 2>/dev/null | wc -l)

if [ "$COMPANY_ID_COUNT" -ge 5 ]; then
  echo -e "${GREEN}✅ PASS${NC}: Company filtering found ($COMPANY_ID_COUNT instances)"
  ((PASS_COUNT++))
else
  echo -e "${YELLOW}⚠️ WARN${NC}: Company filtering ($COMPANY_ID_COUNT instances, expected 5+)"
  ((WARN_COUNT++))
fi
echo ""

# ========================================
# CHECK 4: server-only Directives
# ========================================
echo "[4/4] Checking server-only directives..."

SERVER_ONLY_COUNT=$(grep -r "import 'server-only'" "$PROJECT_ROOT/app/api" --include="*.ts" 2>/dev/null | wc -l)

if [ "$SERVER_ONLY_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✅ PASS${NC}: server-only found in $SERVER_ONLY_COUNT API files"
  ((PASS_COUNT++))
else
  echo -e "${YELLOW}⚠️ WARN${NC}: No server-only directives found"
  ((WARN_COUNT++))
fi
echo ""

# ========================================
# Summary
# ========================================
echo "========================================="
echo "Regression Check Summary"
echo "========================================="
echo -e "  ${GREEN}✅ PASS: $PASS_COUNT${NC}"
echo -e "  ${YELLOW}⚠️  WARN: $WARN_COUNT${NC}"
echo -e "  ${RED}❌ FAIL: $FAIL_COUNT${NC}"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed${NC}"
  exit 0
else
  echo -e "${RED}❌ Some checks failed${NC}"
  exit 1
fi
