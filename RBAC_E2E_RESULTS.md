# RBAC E2E Test Results - 実施記録

**Execution Date**: 2026-02-11
**Status**: Ready for Test Execution

---

## 📋 テスト前提

### テストアカウント（同一企業内）

```
Company: "RBAC-TEST-2026-02-11"
├─ User A (admin): admin@rbac-test.example.com
├─ User B (manager, dept-001): manager@rbac-test.example.com
└─ User C (member): member@rbac-test.example.com
```

### 環境変数の準備

E2E テストを実行する前に、以下の情報を確認：

```bash
# API base URL
BASE_URL="http://localhost:3000"

# Bearer tokens (Supabase auth から取得)
TOKEN_ADMIN="<paste admin user's access token>"
TOKEN_MANAGER="<paste manager user's access token>"
TOKEN_MEMBER="<paste member user's access token>"

# Strategy IDs
STRATEGY_ID_COMPANY_A="<strategy ID from same company>"
STRATEGY_ID_COMPANY_B="<strategy ID from different company for cross-company test>"

# User IDs
USER_ID_ADMIN="<admin user ID>"
USER_ID_MEMBER="<member user ID>"

# Company ID
COMPANY_ID_A="<company ID>"
```

### Bearer Token 取得方法

```bash
# Supabase auth endpoint
curl -X POST "https://<project>.supabase.co/auth/v1/token?grant_type=password" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@rbac-test.example.com",
    "password": "<password>"
  }' | jq '.access_token'
```

---

## 🧪 最小E2E テスト（8ケース）

### 実行コマンド

```bash
BASE_URL="http://localhost:3000" \
TOKEN_ADMIN="<token>" \
TOKEN_MANAGER="<token>" \
TOKEN_MEMBER="<token>" \
STRATEGY_ID_COMPANY_A="<id>" \
STRATEGY_ID_COMPANY_B="<id>" \
USER_ID_ADMIN="<id>" \
USER_ID_MEMBER="<id>" \
COMPANY_ID_A="<id>" \
bash scripts/rbac-e2e-min.sh
```

### テストケース一覧

| # | Test Case | API | Method | Expected | Details |
|---|-----------|-----|--------|----------|---------|
| 1 | Bearer Token なし | /api/ask-ceo-agent | POST | 401 | No Authorization header |
| 2 | Admin Invite | /api/admin/invite | POST | 200 | Admin can invite members |
| 3 | Manager Invite | /api/admin/invite | POST | 403 | Manager cannot invite (admin-only) |
| 4 | Member Invite | /api/admin/invite | POST | 403 | Member cannot invite |
| 5 | Member Agent Use | /api/ask-ceo-agent | POST | 200 | Member can use agent (agent:use capability) |
| 6 | Cross-Company Access | /api/ask-ceo-agent | POST | 403 | Cannot access strategy from other company |
| 7 | Members List | /api/members | GET | 200 | Admin/Manager can list members |
| 8 | Members Role Update | /api/members/role | PATCH | 200/403 | Admin=200, Manager=403 |

---

## 📊 実行結果（テンプレート）

### テスト実施情報

- **実施日**: ____________________
- **実施環境**: [ ] Local [ ] Staging [ ] Production
- **実施者**: ____________________

### テスト結果テーブル

| # | Test Case | Expected | Actual Status | Actual Body | Result | Notes |
|---|-----------|----------|---------------|-------------|--------|-------|
| 1 | Bearer なし | 401 | ___ | ___ | [ ] PASS [ ] FAIL | |
| 2 | Admin Invite | 200 | ___ | ___ | [ ] PASS [ ] FAIL | |
| 3 | Manager Invite | 403 | ___ | ___ | [ ] PASS [ ] FAIL | |
| 4 | Member Invite | 403 | ___ | ___ | [ ] PASS [ ] FAIL | |
| 5 | Member Agent | 200 | ___ | ___ | [ ] PASS [ ] FAIL | |
| 6 | Cross-Company | 403 | ___ | ___ | [ ] PASS [ ] FAIL | |
| 7 | Members List | 200 | ___ | ___ | [ ] PASS [ ] FAIL | |
| 8 | Role Update | 200/403 | ___ | ___ | [ ] PASS [ ] FAIL | |

---

## 📝 Detailed Test Cases（curl 実行例）

### Test 1: Bearer Token Validation → 401

**Command**:
```bash
curl -X POST http://localhost:3000/api/ask-ceo-agent \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"test"}],
    "userId": "test",
    "strategyId": "test"
  }'
```

**Expected**:
```
HTTP Status: 401
Body: { "error": "unauthorized" }
```

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

### Test 2: Admin Can Invite → 200

**Setup**:
```bash
COMPANY_ID="<company-id>"
ADMIN_TOKEN="<Bearer token>"
```

**Command**:
```bash
curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "role": "member",
    "companyId": "'$COMPANY_ID'"
  }'
```

**Expected**:
```
HTTP Status: 200
Body: { "ok": true, "added": true or false, "invited": true, "companyId": "..." }
```

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

### Test 3: Manager Cannot Invite → 403

**Command**:
```bash
curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "another@example.com",
    "role": "member",
    "companyId": "'$COMPANY_ID'"
  }'
```

**Expected**: 403

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

### Test 4: Member Cannot Invite → 403

**Command**:
```bash
curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "another@example.com",
    "role": "member",
    "companyId": "'$COMPANY_ID'"
  }'
```

**Expected**: 403

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

### Test 5: Member Can Use Agent → 200

**Command**:
```bash
curl -X POST http://localhost:3000/api/ask-ceo-agent \
  -H "Authorization: Bearer $MEMBER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"What are key opportunities?"}],
    "userId": "'$USER_ID_MEMBER'",
    "strategyId": "'$STRATEGY_ID_OWN_COMPANY'"
  }'
```

**Expected**:
```
HTTP Status: 200
Body: { "content": "<ai response>", "role": "assistant" }
```

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

### Test 6: Cross-Company Access Blocked → 403

**Setup**:
1. Create strategy in Company-B
2. Use User from Company-A
3. Try to access Company-B's strategy

**Command**:
```bash
curl -X POST http://localhost:3000/api/ask-ceo-agent \
  -H "Authorization: Bearer $ADMIN_TOKEN_COMPANY_A" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"Help"}],
    "userId": "'$USER_ID_ADMIN'",
    "strategyId": "'$STRATEGY_ID_COMPANY_B'"
  }'
```

**Expected**: 403 or 404 (Cannot access other company's data)

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

### Test 7: Members List → 200

**Command**:
```bash
curl -X GET http://localhost:3000/api/members \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected**:
```
HTTP Status: 200
Body: Array of company members
```

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

### Test 8: Members Role Update → Admin 200, Manager 403

#### Test 8a: Admin Update Role → 200

**Command**:
```bash
curl -X PATCH http://localhost:3000/api/members/role \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetUserId": "'$USER_ID_MEMBER'",
    "newRole": "manager"
  }'
```

**Expected**: 200

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

#### Test 8b: Manager Update Role → 403

**Command**:
```bash
curl -X PATCH http://localhost:3000/api/members/role \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetUserId": "'$SOME_OTHER_USER_ID'",
    "newRole": "admin"
  }'
```

**Expected**: 403 (Admin-only)

**Actual Response**:
```
Status: ___
Body: ___
```

**Result**: [ ] PASS [ ] FAIL

---

## 📋 Summary

### Overall Result
- [ ] All 8 tests PASS ✅
- [ ] Some tests FAIL ⚠️
- [ ] Not executed

### Breakdown
- **PASS**: ___/8
- **FAIL**: ___/8
- **SKIP**: ___/8

### Critical Tests
- [ ] Bearer validation: PASS/FAIL
- [ ] Admin enforcement: PASS/FAIL
- [ ] Company scope: PASS/FAIL

### Issues Found (if any)
```
[Describe any failures here]
```

---

## ✅ Sign-Off

**Status**: [ ] READY FOR SHIP [ ] NEEDS FIXES [ ] NOT YET EXECUTED

**Sign-off**:
- Tester: _____________________
- Date: _____________________
- Approval: [ ] Approved [ ] Needs Review

**Comments**:
```
[Add comments here]
```

---

**Template Generated**: 2026-02-11
**Status**: Ready for E2E Test Execution

### ✅ Test: ask-ceo-agent user mismatch (authUserId !== userId)
- Request: POST /api/ask-ceo-agent (valid bearer, wrong userId)
- Expected: 403 + "user mismatch"
- Actual: 403 {"content":"権限がありません（ユーザー不一致）。","error":"user mismatch"}
- Result: PASS
### ✅ Test: ask-ceo-agent without bearer
- Request: POST /api/ask-ceo-agent (no Authorization header)
- Expected: 401 + "no bearer"
- Actual: 401 {"content":"認証が必要です。","error":"no bearer"}
- Result: PASS
### ✅ Test: ask-ceo-agent happy path
- Request: POST /api/ask-ceo-agent (valid bearer, correct userId + strategyId)
- Expected: 200
- Actual: 200 (response JSON returned)
- Result: PASS
