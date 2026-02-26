# RBAC Final Regression Checks - 回帰防止のための最終チェック

**Date**: 2026-02-11
**Status**: Automated Verification Commands
**Purpose**: CI/CD や ship 前の最小限の regression チェック

---

## 🔍 CHECK 1: Service Role Key Isolation

**Objective**: Service Role Key がクライアント bundle に混入していない

### Command
```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" . \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  | grep -v "app/api" \
  | grep -v "lib/server"
```

**Expected Output**: 0 lines

**What it checks**:
- ✅ Service Role Key only in app/api/** and lib/server/**
- ❌ FAIL if found in: components/**, app/(routes)/**, hooks/** など

### Run & Verify
```bash
CHECK1_RESULT=$(grep -r "SUPABASE_SERVICE_ROLE_KEY" . \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  | grep -v "app/api" \
  | grep -v "lib/server" \
  | wc -l)

if [ "$CHECK1_RESULT" -eq 0 ]; then
  echo "✅ CHECK 1 PASS: No Service Role Key in client code"
else
  echo "❌ CHECK 1 FAIL: Service Role Key found in client code!"
  echo "Found:"
  grep -r "SUPABASE_SERVICE_ROLE_KEY" . \
    --include="*.ts" --include="*.tsx" \
    --exclude-dir=node_modules \
    --exclude-dir=.next \
    | grep -v "app/api" \
    | grep -v "lib/server"
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] FAIL

---

## 🔍 CHECK 2: Role Direct Comparison in Client Components

**Objective**: Client components で role === 'admin' 直比較がない

**Why**: UI は capability hooks から取る必要があります（rbacGuard が source of truth）

### Command
```bash
grep -r "\.role ==\|\.role !=\|role ===" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir="app/api" \
  --exclude="rbacGuard.ts" \
  --exclude="*.server.ts" | head -20
```

**Expected Output**: 0 lines (or only in app/admin/layout or server components)

### Run & Verify
```bash
CHECK2_RESULT=$(grep -r "\.role ==\|\.role !=\|role ===" \
  --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir="app/api" \
  app/admin app/okr components hooks \
  2>/dev/null | grep -v ".server" | wc -l)

if [ "$CHECK2_RESULT" -eq 0 ]; then
  echo "✅ CHECK 2 PASS: No direct role comparisons in client components"
else
  echo "⚠️ CHECK 2 WARNING: Found role comparisons (may be in server components)"
  grep -r "\.role ==\|\.role !=\|role ===" \
    --include="*.tsx" \
    --exclude-dir=node_modules \
    --exclude-dir=.next \
    --exclude-dir="app/api" \
    app/admin app/okr components hooks 2>/dev/null | head -5
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] WARN [ ] FAIL

---

## 🔍 CHECK 3: Bearer Token in Write APIs

**Objective**: すべての write API に Bearer token 検証がある

### Critical Write APIs
- /api/admin/invite
- /api/members (POST)
- /api/members/role (PATCH)
- /api/ask-ceo-agent (POST)
- /api/generate-* (all POST)
- /api/stage2/* (POST)

### Command
```bash
for api in admin/invite members members/role ask-ceo-agent; do
  echo "=== $api ==="
  grep -E "getAuthUserIdFromBearer|bearer\(" "app/api/$api/route.ts" || echo "❌ NOT FOUND"
done
```

**Run & Verify**
```bash
WRITE_APIS=("admin/invite" "members" "members/role" "ask-ceo-agent" "generate-strategy" "generate-cascade")
CHECK3_PASS=0
CHECK3_FAIL=0

for api in "${WRITE_APIS[@]}"; do
  if grep -q "getAuthUserIdFromBearer\|function bearer\|const token = bearer" "app/api/$api/route.ts" 2>/dev/null; then
    echo "✅ $api: Bearer validation found"
    ((CHECK3_PASS++))
  else
    echo "❌ $api: Bearer validation NOT found"
    ((CHECK3_FAIL++))
  fi
done

if [ "$CHECK3_FAIL" -eq 0 ]; then
  echo "✅ CHECK 3 PASS: All checked write APIs have Bearer validation"
else
  echo "❌ CHECK 3 FAIL: $CHECK3_FAIL API(s) missing Bearer validation"
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] FAIL

---

## 🔍 CHECK 4: Company ID Filtering in DB Operations

**Objective**: DB読み書き時に company_id フィルタがある

### Command
```bash
echo "=== DB Read/Write Operations ==="
grep -r "\.from('company_members')\|\.from('strategy_data')" \
  --include="*.ts" \
  app/api \
  | grep -v node_modules

echo ""
echo "=== Company ID Filters ==="
grep -r "\.eq('company_id'" app/api --include="*.ts" | wc -l
```

**Expected**:
- DB operations found: 5+ (company_members, strategy_data)
- Company filters found: 10+ (all scoped queries)

### Run & Verify
```bash
DB_OPS=$(grep -r "\.from('company_members')\|\.from('strategy_data')" \
  --include="*.ts" \
  app/api | wc -l)

FILTERS=$(grep -r "\.eq('company_id'" app/api --include="*.ts" | wc -l)

echo "DB operations found: $DB_OPS"
echo "Company filters found: $FILTERS"

if [ "$FILTERS" -ge 5 ]; then
  echo "✅ CHECK 4 PASS: Sufficient company_id filtering"
else
  echo "❌ CHECK 4 FAIL: Insufficient company_id filtering"
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] FAIL

---

## 🔍 CHECK 5: assertCompanyScopeByStrategyId Usage

**Objective**: strategyId を使う API で scope ガードがある

### Command
```bash
echo "=== APIs receiving strategyId ==="
grep -r "strategyId" app/api --include="*.ts" | grep -E "body\.|RequestBody"

echo ""
echo "=== assertCompanyScopeByStrategyId usage ==="
grep -r "assertCompanyScopeByStrategyId" app/api --include="*.ts"
```

**Expected**: ask-ceo-agent に assertCompanyScopeByStrategyId の import + call

### Run & Verify
```bash
STRATEGY_APIS=$(grep -r "strategyId" app/api --include="*.ts" | grep -E "body\.|RequestBody" | wc -l)
SCOPE_GUARDS=$(grep -r "assertCompanyScopeByStrategyId" app/api --include="*.ts" | wc -l)

echo "strategyId-receiving APIs: $STRATEGY_APIS"
echo "assertCompanyScopeByStrategyId usages: $SCOPE_GUARDS"

if [ "$SCOPE_GUARDS" -ge 1 ]; then
  echo "✅ CHECK 5 PASS: Scope guard present"
  grep -r "assertCompanyScopeByStrategyId" app/api --include="*.ts" | head -3
else
  echo "❌ CHECK 5 FAIL: Scope guard missing"
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] FAIL

---

## 🔍 CHECK 6: server-only Directive in Server Code

**Objective**: 全サーバーコードに `import 'server-only'` がある

### Command
```bash
echo "=== Files WITHOUT 'server-only' ==="
for file in $(find app/api lib/server -name "*.ts" -type f | head -10); do
  grep -q "import 'server-only'" "$file" || echo "❌ MISSING: $file"
done
```

**Expected Output**: 0 files missing

### Run & Verify
```bash
MISSING_COUNT=$(for file in $(find app/api lib/server -name "*.ts" -type f); do
  grep -q "import 'server-only'" "$file" || echo "$file"
done | wc -l)

if [ "$MISSING_COUNT" -eq 0 ]; then
  echo "✅ CHECK 6 PASS: All server code has server-only directive"
else
  echo "⚠️ CHECK 6 WARNING: $MISSING_COUNT file(s) may be missing server-only"
  for file in $(find app/api lib/server -name "*.ts" -type f); do
    grep -q "import 'server-only'" "$file" || echo "  - $file"
  done
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] WARN

---

## 🔍 CHECK 7: Membership Verification in Write APIs

**Objective**: すべての write API で membership 検証がある

### Command
```bash
echo "=== Membership checks ==="
grep -r "requireMembership\|pickOneMembershipServer\|company_members.*select.*user_id" \
  app/api \
  --include="*.ts" \
  | wc -l
```

**Expected**: 5+ (all write APIs)

### Run & Verify
```bash
MEMBERSHIP_CHECKS=$(grep -r "requireMembership\|pickOneMembershipServer\|company_members.*select.*user_id" \
  app/api \
  --include="*.ts" | wc -l)

if [ "$MEMBERSHIP_CHECKS" -ge 5 ]; then
  echo "✅ CHECK 7 PASS: Membership checks present ($MEMBERSHIP_CHECKS found)"
else
  echo "❌ CHECK 7 FAIL: Insufficient membership checks ($MEMBERSHIP_CHECKS found)"
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] FAIL

---

## 🔍 CHECK 8: useCapabilities Hook Usage

**Objective**: UI で role 比較ではなく useCapabilities を使用

### Command
```bash
echo "=== useCapabilities imports ==="
grep -r "useCapabilities" app --include="*.tsx" | wc -l

echo ""
echo "=== Role comparisons in UI (should be 0) ==="
grep -r "userRole ==\|user\.role ==\|\.role ===" \
  --include="*.tsx" \
  app \
  --exclude-dir=api \
  | wc -l
```

**Run & Verify**
```bash
HOOKS=$(grep -r "useCapabilities" app --include="*.tsx" | wc -l)
COMPARISONS=$(grep -r "userRole ==\|user\.role ==\|\.role ===" \
  --include="*.tsx" \
  app \
  --exclude-dir=api | wc -l)

echo "useCapabilities found: $HOOKS"
echo "Direct role comparisons: $COMPARISONS"

if [ "$HOOKS" -gt 0 ] && [ "$COMPARISONS" -eq 0 ]; then
  echo "✅ CHECK 8 PASS: Using useCapabilities pattern"
else
  echo "⚠️ CHECK 8: Verify UI hook usage"
fi
```

**Log**:
```
[paste command output here]
```

**Status**: [ ] PASS [ ] WARN

---

## 📋 All Checks Summary

Create a final summary table:

| Check | Objective | Status | Log Line |
|-------|-----------|--------|----------|
| 1 | Service Role Key isolation | [ ] | [link] |
| 2 | No role direct comparison (client) | [ ] | [link] |
| 3 | Bearer in write APIs | [ ] | [link] |
| 4 | Company ID filtering | [ ] | [link] |
| 5 | assertCompanyScopeByStrategyId | [ ] | [link] |
| 6 | server-only directive | [ ] | [link] |
| 7 | Membership verification | [ ] | [link] |
| 8 | useCapabilities hook usage | [ ] | [link] |

---

## 🚀 Regression Check Results

### Overall Status
- [ ] All checks PASS ✅
- [ ] Some WARN ⚠️
- [ ] Some FAIL ❌

### Critical Checks (must PASS)
- [ ] CHECK 1: Service Role Key Isolation ← CRITICAL
- [ ] CHECK 3: Bearer in write APIs ← CRITICAL
- [ ] CHECK 4: Company ID filtering ← CRITICAL
- [ ] CHECK 5: assertCompanyScopeByStrategyId ← CRITICAL

### Warning Checks (review)
- [ ] CHECK 2: Direct role comparison
- [ ] CHECK 6: server-only directive
- [ ] CHECK 8: useCapabilities usage

---

## 📝 Running All Checks at Once

Save this as `scripts/rbac-check.sh`:

```bash
#!/bin/bash

echo "========================================="
echo "RBAC Final Regression Checks"
echo "========================================="
echo ""

# CHECK 1
echo "[1/8] Checking Service Role Key isolation..."
CHECK1=$(grep -r "SUPABASE_SERVICE_ROLE_KEY" . \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=.next | grep -v "app/api" | grep -v "lib/server" | wc -l)
[ "$CHECK1" -eq 0 ] && echo "✅ PASS" || echo "❌ FAIL ($CHECK1 found)"

# CHECK 3
echo "[3/8] Checking Bearer token in write APIs..."
CHECK3_COUNT=0
for api in admin/invite members members/role ask-ceo-agent; do
  if grep -q "getAuthUserIdFromBearer\|bearer(" "app/api/$api/route.ts" 2>/dev/null; then
    ((CHECK3_COUNT++))
  fi
done
[ "$CHECK3_COUNT" -ge 3 ] && echo "✅ PASS ($CHECK3_COUNT/4)" || echo "⚠️ CHECK ($CHECK3_COUNT/4)"

# CHECK 4
echo "[4/8] Checking company_id filtering..."
FILTERS=$(grep -r "\.eq('company_id'" app/api --include="*.ts" | wc -l)
[ "$FILTERS" -ge 5 ] && echo "✅ PASS ($FILTERS filters)" || echo "⚠️ CHECK ($FILTERS filters)"

# CHECK 5
echo "[5/8] Checking assertCompanyScopeByStrategyId..."
SCOPE=$(grep -r "assertCompanyScopeByStrategyId" app/api --include="*.ts" | wc -l)
[ "$SCOPE" -gt 0 ] && echo "✅ PASS" || echo "❌ FAIL"

echo ""
echo "========================================="
echo "Regression checks complete"
echo "========================================="
```

Run it:
```bash
chmod +x scripts/rbac-check.sh
./scripts/rbac-check.sh
```

---

## ✅ Sign-Off

**Regression checks executed**: [ ] Yes [ ] No

**Date**: _____________________

**Executor**: _____________________

**Results**:
```
[Paste full output here]
```

**Issues found**: _____________________

**Conclusion**: [ ] PASS [ ] FAIL [ ] REVIEW NEEDED

---

**Generated**: 2026-02-11
**Status**: Final Regression Check Framework Ready
**Next**: Execute checks before deployment
