# RBAC Phase 3 - Manual E2E Testing Plan

**Date**: 2026-02-11
**Status**: Phase 3 - Test Plan & Setup Guide
**Focus**: Manual E2E testing with 3 test accounts to verify RBAC enforcement

---

## 🧪 Phase 3 Objective

Verify that the RBAC system correctly enforces:
1. **Bearer token validation**: 401 for missing/invalid tokens
2. **Member permissions**: 403 for unauthorized operations
3. **Admin-only operations**: 403 for non-admin users
4. **Company scope isolation**: Users cannot access other companies' data
5. **Manager self-department enforcement**: Managers cannot edit other departments

---

## 📋 Test Account Setup

### Prerequisites
- Access to Supabase project admin console
- cURL or Postman installed for API testing
- Same company assigned to all 3 test accounts

### Test Account Configuration

Create exactly 3 user accounts in the same company:

```
Company: "TEST-RBAC-2026-02"
├── User A: admin
│   ├── email: admin-rbac@test.example.com
│   ├── role: admin
│   └── department_id: NULL (no department assignment)
│
├── User B: manager
│   ├── email: manager-rbac@test.example.com
│   ├── role: manager
│   └── department_id: dept-001
│
└── User C: member
    ├── email: member-rbac@test.example.com
    ├── role: member
    └── department_id: NULL
```

### Test Setup Checklist

- [ ] Create company "TEST-RBAC-2026-02" via /api/companies/provision
- [ ] Create User A (admin) and invite to company
- [ ] Create User B (manager, dept-001) and invite to company
- [ ] Create User C (member) and invite to company
- [ ] Verify all 3 users can login
- [ ] Obtain bearer tokens for each user (via Supabase auth)

---

## 🧪 Test Case Scenarios

### Test Group 1: Bearer Token Validation

#### Test 1.1: No Token → 401 Unauthorized
**Case**: Request without Bearer token

```bash
curl -X POST http://localhost:3000/api/admin/invite \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@test.example.com","role":"member"}'
```

**Expected**:
```json
Status: 401
{
  "error": "unauthorized"
}
```

**Evidence**: Line 62-63 in `/app/api/admin/invite/route.ts`
```typescript
if (!callerId) {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
```

---

#### Test 1.2: Malformed Token → 401 Unauthorized
**Case**: Request with invalid Bearer token

```bash
curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer invalid-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@test.example.com","role":"member"}'
```

**Expected**:
```json
Status: 401
{
  "error": "unauthorized"
}
```

**Evidence**: getAuthUserIdFromBearer validates token via Supabase auth

---

### Test Group 2: Admin-Only Operations

#### Test 2.1: Admin Can Invite Members → 200 OK
**Case**: User A (admin) invites new member

```bash
TOKEN_A="<User A's bearer token>"

curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newmember@test.example.com",
    "role": "member"
  }'
```

**Expected**:
```json
Status: 200
{
  "ok": true,
  "added": true,
  "invited": true,
  "companyId": "TEST-RBAC-2026-02"
}
```

**Evidence**: Lines 111-113 in `/app/api/admin/invite/route.ts` - admin role check passes

---

#### Test 2.2: Manager CANNOT Invite Members → 403 Forbidden
**Case**: User B (manager) attempts to invite

```bash
TOKEN_B="<User B's bearer token>"

curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "another@test.example.com",
    "role": "member"
  }'
```

**Expected**:
```json
Status: 403
{
  "error": "admin_only"
}
```

**Evidence**: Line 111 in `/app/api/admin/invite/route.ts`
```typescript
if (callerMembership.role !== 'admin') {
  return NextResponse.json({ error: 'admin_only' }, { status: 403 });
}
```

---

#### Test 2.3: Member CANNOT Invite Members → 403 Forbidden
**Case**: User C (member) attempts to invite

```bash
TOKEN_C="<User C's bearer token>"

curl -X POST http://localhost:3000/api/admin/invite \
  -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "another@test.example.com",
    "role": "member"
  }'
```

**Expected**:
```json
Status: 403
{
  "error": "admin_only" or "forbidden"
}
```

---

### Test Group 3: Company Scope Isolation

#### Test 3.1: User Cannot Access Other Company's Strategy (ask-ceo-agent)

**Setup**:
- Create a second company "TEST-RBAC-OTHER"
- Create a strategy in company TEST-RBAC-OTHER
- Note the strategyId

**Case**: User A (from TEST-RBAC-2026-02) tries to access TEST-RBAC-OTHER's strategy

```bash
TOKEN_A="<User A's bearer token from TEST-RBAC-2026-02>"
OTHER_STRATEGY_ID="<strategyId from TEST-RBAC-OTHER company>"

curl -X POST http://localhost:3000/api/ask-ceo-agent \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "test"}],
    "userId": "<User A's id>",
    "strategyId": "'$OTHER_STRATEGY_ID'"
  }'
```

**Expected**:
```json
Status: 403 or 404
{
  "error": "forbidden" or "strategy not found"
}
```

**Evidence**: Line 264 in `/app/api/ask-ceo-agent/route.ts`
```typescript
const companyId = await assertCompanyScopeByStrategyId(admin, membership, strategyId);
```

This validates that strategyId belongs to membership.companyId

---

### Test Group 4: Member Permission Restrictions

#### Test 4.1: Member Can Use Agent (progress:write + agent:use)

**Case**: User C (member) uses ask-ceo-agent with own company's strategy

```bash
TOKEN_C="<User C's bearer token>"
STRATEGY_ID="<strategy from TEST-RBAC-2026-02>"
USER_C_ID="<User C's user id>"

curl -X POST http://localhost:3000/api/ask-ceo-agent \
  -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Strategy improvement suggestions"}
    ],
    "userId": "'$USER_C_ID'",
    "strategyId": "'$STRATEGY_ID'"
  }'
```

**Expected**:
```json
Status: 200
{
  "content": "<AI-generated response>",
  "role": "assistant"
}
```

**Evidence**: Member has capabilities 'progress:write': true and 'agent:use': true (rbac.ts line 69-70)

---

#### Test 4.2: Member CANNOT Edit Strategy (strategy:edit=false)

**Prerequisite**: Create a member editing interface to attempt strategy modification

**Expected**: UI should disable edit buttons for members (based on useCapabilities hook)

**Evidence**: rbac.ts line 66
```typescript
'strategy:edit': false,  // Member cannot edit
```

---

### Test Group 5: Role-Based Capability Matrix

#### Test 5.1: Verify Member Cannot Call members:invite

**Case**: User C (member) attempts to access capability-gated endpoint

If you create an endpoint that requires 'members:invite' capability:

```bash
TOKEN_C="<User C's bearer token>"

curl -X POST http://localhost:3000/api/members \
  -H "Authorization: Bearer $TOKEN_C" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","role":"member"}'
```

**Expected**:
```json
Status: 403
{
  "error": "forbidden" or "admin_only"
}
```

**Evidence**: rbac.ts lines 63
```typescript
'members:invite': false,  // Member cannot invite
```

---

### Test Group 6: Manager Self-Department Restriction

#### Test 6.1: Manager Can Only Edit Own Department

**Prerequisite**: Create department editing endpoint (currently not exposed as API)

When implemented, test that User B (manager with dept-001) cannot edit dept-002:

```typescript
// This would be the enforcement in a future department editing API:
assertDepartmentScope(membership, targetDepartmentId);
// If membership.departmentId='dept-001' and targetDepartmentId='dept-002',
// throws Error('forbidden')
```

**Expected**:
```json
Status: 403
{
  "error": "forbidden"
}
```

**Evidence**: `/lib/server/rbacGuard.ts` lines 358-366
```typescript
if (membership.role === 'manager') {
  if (!membership.departmentId) {
    throw new Error('forbidden');
  }
  if (targetDepartmentId !== membership.departmentId) {
    throw new Error('forbidden');
  }
  return;
}
```

---

## ✅ Test Execution Checklist

### Bearer Token Tests
- [ ] Test 1.1: No token → 401
- [ ] Test 1.2: Invalid token → 401

### Admin Operation Tests
- [ ] Test 2.1: Admin invite → 200 OK
- [ ] Test 2.2: Manager invite → 403 Forbidden
- [ ] Test 2.3: Member invite → 403 Forbidden

### Company Scope Tests
- [ ] Test 3.1: Cross-company access denied

### Member Permission Tests
- [ ] Test 4.1: Member can use agent
- [ ] Test 4.2: Member cannot edit strategy (UI verification)

### Capability Tests
- [ ] Test 5.1: Member cannot call members:invite

### Manager Restriction Tests
- [ ] Test 6.1: Manager self-department enforcement (when API exists)

---

## 🔍 Troubleshooting

### Bearer Token Not Working
1. Verify token is valid: `curl -X GET https://your-project.supabase.co/auth/v1/user -H "Authorization: Bearer $TOKEN"`
2. Check token hasn't expired
3. Verify Authorization header format: `Authorization: Bearer <token>`

### 500 Errors Instead of 403
1. Check server logs for exception details
2. Verify Bearer token validation is happening (see /lib/server/rbacGuard.ts line 44)
3. Verify membership validation is happening (line 108-161)

### Tests Passing When They Shouldn't
1. Verify user roles are correctly set in database
2. Check company_members table for correct company_id assignment
3. Verify getCapabilities() is returning correct boolean values

---

## 📊 Test Results Summary

| Test Case | Expected | Actual | Status | Evidence |
|-----------|----------|--------|--------|----------|
| 1.1 - No token | 401 | ☐ | ☐ PASS / ☐ FAIL | |
| 1.2 - Invalid token | 401 | ☐ | ☐ PASS / ☐ FAIL | |
| 2.1 - Admin invite | 200 | ☐ | ☐ PASS / ☐ FAIL | |
| 2.2 - Manager invite | 403 | ☐ | ☐ PASS / ☐ FAIL | |
| 2.3 - Member invite | 403 | ☐ | ☐ PASS / ☐ FAIL | |
| 3.1 - Cross-company | 403/404 | ☐ | ☐ PASS / ☐ FAIL | |
| 4.1 - Member agent | 200 | ☐ | ☐ PASS / ☐ FAIL | |
| 4.2 - Member edit | UI disabled | ☐ | ☐ PASS / ☐ FAIL | |
| 5.1 - Member invite call | 403 | ☐ | ☐ PASS / ☐ FAIL | |

---

## 📝 Test Completion Status

**Phase 3 E2E Test Plan**: ✅ Complete

This document provides:
- ✅ 3-account test setup instructions
- ✅ 9+ detailed test cases with expected results
- ✅ Curl commands for each test
- ✅ Code evidence references for each expected behavior
- ✅ Troubleshooting guide
- ✅ Results tracking table

**Ready for Execution**: ✅ Manual testing can proceed

---

**Next Phase**: Phase 4 - Create RBAC_DEPLOY_CHECKLIST.md with final verification commands

**Generated**: 2026-02-11
**Status**: Phase 3 Plan Complete ✅
