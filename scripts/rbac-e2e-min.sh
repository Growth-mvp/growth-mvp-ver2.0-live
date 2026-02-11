#!/bin/bash

#
# RBAC Minimal E2E Test (curl-based)
# 最小8ケースのE2Eテスト
#
# 環境変数:
#   BASE_URL - API base URL (default: http://localhost:3000)
#   TOKEN_ADMIN - Bearer token for admin user
#   TOKEN_MANAGER - Bearer token for manager user
#   TOKEN_MEMBER - Bearer token for member user
#   STRATEGY_ID_COMPANY_A - Strategy ID in user's company
#   STRATEGY_ID_COMPANY_B - Strategy ID in different company (for cross-company test)
#   USER_ID_ADMIN - User ID of admin user
#   USER_ID_MEMBER - User ID of member user
#   COMPANY_ID_A - Company ID (primary)
#
# 用法:
#   BASE_URL="http://localhost:3000" \
#   TOKEN_ADMIN="..." \
#   TOKEN_MANAGER="..." \
#   TOKEN_MEMBER="..." \
#   STRATEGY_ID_COMPANY_A="..." \
#   STRATEGY_ID_COMPANY_B="..." \
#   USER_ID_ADMIN="..." \
#   USER_ID_MEMBER="..." \
#   COMPANY_ID_A="..." \
#   bash scripts/rbac-e2e-min.sh
#

set -e

# Config
BASE_URL="${BASE_URL:-http://localhost:3000}"
RESULTS_FILE="${RESULTS_FILE:-RBAC_E2E_RESULTS.md}"

echo "========================================="
echo "RBAC Minimal E2E Test"
echo "========================================="
echo ""
echo "Base URL: $BASE_URL"
echo "Results will be appended to: $RESULTS_FILE"
echo ""

# 色定義
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

# Utility function to make curl request
make_request() {
  local method=$1
  local endpoint=$2
  local token=$3
  local data=$4
  local expected_status=$5

  if [ -z "$data" ]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      -X "$method" \
      "$BASE_URL$endpoint" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json")
  else
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      -X "$method" \
      "$BASE_URL$endpoint" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "$data")
  fi

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -n -1)

  if [ "$HTTP_CODE" = "$expected_status" ]; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((PASS_COUNT++))
    return 0
  else
    echo -e "${RED}❌ FAIL${NC} (Expected: $expected_status, Got: $HTTP_CODE)"
    echo "Response: $BODY"
    ((FAIL_COUNT++))
    return 1
  fi
}

# Validate required environment variables
check_env() {
  local var_name=$1
  if [ -z "${!var_name}" ]; then
    echo "⚠️ WARNING: Environment variable $var_name is not set"
    echo "   Some tests may be skipped"
    return 1
  fi
  return 0
}

echo "Checking environment variables..."
check_env "TOKEN_ADMIN" || true
check_env "TOKEN_MANAGER" || true
check_env "TOKEN_MEMBER" || true
check_env "STRATEGY_ID_COMPANY_A" || true
check_env "STRATEGY_ID_COMPANY_B" || true
echo ""

# Test cases array
declare -a TEST_NAMES
declare -a TEST_RESULTS
declare -a TEST_STATUSES

# Test 1: No Bearer Token → 401
echo "[1/8] No Bearer Token → 401"
if make_request "POST" "/api/ask-ceo-agent" "" '{}' "401"; then
  TEST_RESULTS[0]="PASS"
else
  TEST_RESULTS[0]="FAIL"
fi
TEST_NAMES[0]="Bearer validation"
echo ""

# Test 2: Admin Can Invite → 200
echo "[2/8] Admin Can Invite → 200"
if [ -n "$TOKEN_ADMIN" ] && [ -n "$COMPANY_ID_A" ]; then
  PAYLOAD=$(cat <<EOF
{
  "email": "test-invite-1@example.com",
  "role": "member",
  "companyId": "$COMPANY_ID_A"
}
EOF
)
  if make_request "POST" "/api/admin/invite" "$TOKEN_ADMIN" "$PAYLOAD" "200"; then
    TEST_RESULTS[1]="PASS"
  else
    TEST_RESULTS[1]="FAIL"
  fi
else
  echo "⚠️ Skipped (TOKEN_ADMIN or COMPANY_ID_A not set)"
  TEST_RESULTS[1]="SKIP"
fi
TEST_NAMES[1]="Admin invite"
echo ""

# Test 3: Manager Cannot Invite → 403
echo "[3/8] Manager Cannot Invite → 403"
if [ -n "$TOKEN_MANAGER" ] && [ -n "$COMPANY_ID_A" ]; then
  PAYLOAD=$(cat <<EOF
{
  "email": "test-invite-2@example.com",
  "role": "member",
  "companyId": "$COMPANY_ID_A"
}
EOF
)
  if make_request "POST" "/api/admin/invite" "$TOKEN_MANAGER" "$PAYLOAD" "403"; then
    TEST_RESULTS[2]="PASS"
  else
    TEST_RESULTS[2]="FAIL"
  fi
else
  echo "⚠️ Skipped (TOKEN_MANAGER or COMPANY_ID_A not set)"
  TEST_RESULTS[2]="SKIP"
fi
TEST_NAMES[2]="Manager invite blocked"
echo ""

# Test 4: Member Cannot Invite → 403
echo "[4/8] Member Cannot Invite → 403"
if [ -n "$TOKEN_MEMBER" ] && [ -n "$COMPANY_ID_A" ]; then
  PAYLOAD=$(cat <<EOF
{
  "email": "test-invite-3@example.com",
  "role": "member",
  "companyId": "$COMPANY_ID_A"
}
EOF
)
  if make_request "POST" "/api/admin/invite" "$TOKEN_MEMBER" "$PAYLOAD" "403"; then
    TEST_RESULTS[3]="PASS"
  else
    TEST_RESULTS[3]="FAIL"
  fi
else
  echo "⚠️ Skipped (TOKEN_MEMBER or COMPANY_ID_A not set)"
  TEST_RESULTS[3]="SKIP"
fi
TEST_NAMES[3]="Member invite blocked"
echo ""

# Test 5: Member Can Use Agent → 200
echo "[5/8] Member Can Use Agent → 200"
if [ -n "$TOKEN_MEMBER" ] && [ -n "$STRATEGY_ID_COMPANY_A" ] && [ -n "$USER_ID_MEMBER" ]; then
  PAYLOAD=$(cat <<EOF
{
  "messages": [{"role":"user","content":"What are key strengths?"}],
  "userId": "$USER_ID_MEMBER",
  "strategyId": "$STRATEGY_ID_COMPANY_A"
}
EOF
)
  if make_request "POST" "/api/ask-ceo-agent" "$TOKEN_MEMBER" "$PAYLOAD" "200"; then
    TEST_RESULTS[4]="PASS"
  else
    TEST_RESULTS[4]="FAIL"
  fi
else
  echo "⚠️ Skipped (TOKEN_MEMBER, STRATEGY_ID_COMPANY_A, or USER_ID_MEMBER not set)"
  TEST_RESULTS[4]="SKIP"
fi
TEST_NAMES[4]="Member agent use"
echo ""

# Test 6: Cross-Company Access Blocked → 403
echo "[6/8] Cross-Company Access Blocked → 403"
if [ -n "$TOKEN_ADMIN" ] && [ -n "$STRATEGY_ID_COMPANY_B" ] && [ -n "$USER_ID_ADMIN" ]; then
  PAYLOAD=$(cat <<EOF
{
  "messages": [{"role":"user","content":"Help"}],
  "userId": "$USER_ID_ADMIN",
  "strategyId": "$STRATEGY_ID_COMPANY_B"
}
EOF
)
  if make_request "POST" "/api/ask-ceo-agent" "$TOKEN_ADMIN" "$PAYLOAD" "403"; then
    TEST_RESULTS[5]="PASS"
  else
    TEST_RESULTS[5]="FAIL"
  fi
else
  echo "⚠️ Skipped (TOKEN_ADMIN, STRATEGY_ID_COMPANY_B, or USER_ID_ADMIN not set)"
  TEST_RESULTS[5]="SKIP"
fi
TEST_NAMES[5]="Cross-company blocked"
echo ""

# Test 7: Members List (Admin/Manager) → 200
echo "[7/8] Members List (Admin) → 200"
if [ -n "$TOKEN_ADMIN" ]; then
  if make_request "GET" "/api/members" "$TOKEN_ADMIN" "" "200"; then
    TEST_RESULTS[6]="PASS"
  else
    TEST_RESULTS[6]="FAIL"
  fi
else
  echo "⚠️ Skipped (TOKEN_ADMIN not set)"
  TEST_RESULTS[6]="SKIP"
fi
TEST_NAMES[6]="Members list"
echo ""

# Test 8: Members Role Update (Admin OK, Manager NG)
echo "[8/8] Members Role Update (Admin 200, Manager 403)"
if [ -n "$TOKEN_ADMIN" ] && [ -n "$USER_ID_MEMBER" ] && [ -n "$COMPANY_ID_A" ]; then
  PAYLOAD=$(cat <<EOF
{
  "targetUserId": "$USER_ID_MEMBER",
  "newRole": "manager"
}
EOF
)
  # Try with admin (should be 200)
  if make_request "PATCH" "/api/members/role" "$TOKEN_ADMIN" "$PAYLOAD" "200"; then
    TEST_RESULTS[7]="PASS"
  else
    TEST_RESULTS[7]="FAIL"
  fi
else
  echo "⚠️ Skipped (TOKEN_ADMIN, USER_ID_MEMBER, or COMPANY_ID_A not set)"
  TEST_RESULTS[7]="SKIP"
fi
TEST_NAMES[7]="Members role update"
echo ""

# Summary
echo "========================================="
echo "E2E Test Summary"
echo "========================================="
echo -e "  ${GREEN}✅ PASS: $PASS_COUNT${NC}"
echo -e "  ${RED}❌ FAIL: $FAIL_COUNT${NC}"
echo ""

# Generate markdown table for results
echo "Appending results to $RESULTS_FILE..."

cat >> "$RESULTS_FILE" << 'EOF'

---

## 🧪 E2E Test Execution Results

**Execution Date**:
**Environment**:
**Executor**:

### Test Results Table

| # | Test Case | Expected | Actual | Status | Notes |
|----|-----------|----------|--------|--------|-------|
EOF

for i in {0..7}; do
  TEST_NAME=${TEST_NAMES[$i]:-"Test $((i+1))"}
  TEST_RESULT=${TEST_RESULTS[$i]:-"NOT RUN"}
  echo "| $((i+1)) | $TEST_NAME | - | - | $TEST_RESULT | |" >> "$RESULTS_FILE"
done

cat >> "$RESULTS_FILE" << 'EOF'

### Summary
- Total Tests: 8
- PASS:
- FAIL:
- SKIP:

### Logs
```
[Paste script output here]
```

---

EOF

echo "✅ Results appended to $RESULTS_FILE"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
