# RBAC PHASE C - Manager 自部門制限の確認

**Date**: 2026-02-11
**Status**: Specification Fixed
**Requirement**: Manager は自部門のみ編集可（admin は全部門OK、member は不可）

---

## 📋 仕様確認

### 仕様定義（固定）

| Role | Department Edit | Department Delete | 管理範囲 |
|------|----------------|------------------|---------|
| **admin** | ✅ YES (全部門) | ✅ YES | 全企業全部門 |
| **manager** | ✅ YES (自部門のみ) | ❌ NO | 自身に割り当てられた部門のみ |
| **member** | ❌ NO | ❌ NO | 部門編集不可 |

---

## 🔒 Guard Function: assertDepartmentScope

### 定義位置
**File**: `/lib/server/rbacGuard.ts`
**Lines**: 348-372

### 実装仕様

```typescript
export function assertDepartmentScope(
  membership: Membership,
  targetDepartmentId: string | null | undefined
): void {
  // Rule 1: Admin は常に OK
  if (membership.role === 'admin') {
    return;  // ← Allow
  }

  // Rule 2: Manager は自部門のみ OK
  if (membership.role === 'manager') {
    // Rule 2a: Manager に department_id が無ければ NG（安全側）
    if (!membership.departmentId) {
      throw new Error('forbidden');  // ← Deny
    }
    // Rule 2b: Target が自身の department_id と異なれば NG
    if (targetDepartmentId !== membership.departmentId) {
      throw new Error('forbidden');  // ← Deny
    }
    return;  // ← Allow
  }

  // Rule 3: Member は常に NG
  throw new Error('forbidden');  // ← Deny
}
```

### 仕様の検証

#### ✅ Rule 1: Admin は全部門 OK
```typescript
membership = { role: 'admin', departmentId: null, ... }
targetDepartmentId = 'dept-002'
assertDepartmentScope(membership, targetDepartmentId)
// → No error (Allow) ✅
```

#### ✅ Rule 2a: Manager が department_id を持たない場合は NG
```typescript
membership = { role: 'manager', departmentId: null, ... }  // DB列が無い或いは NULL
targetDepartmentId = 'dept-001'
assertDepartmentScope(membership, targetDepartmentId)
// → Error('forbidden') (Deny) ✅
```

#### ✅ Rule 2b: Manager が自部門を編集 OK
```typescript
membership = { role: 'manager', departmentId: 'dept-001', ... }
targetDepartmentId = 'dept-001'
assertDepartmentScope(membership, targetDepartmentId)
// → No error (Allow) ✅
```

#### ✅ Rule 2c: Manager が他部門を編集しようとすると NG
```typescript
membership = { role: 'manager', departmentId: 'dept-001', ... }
targetDepartmentId = 'dept-002'  // ≠ 'dept-001'
assertDepartmentScope(membership, targetDepartmentId)
// → Error('forbidden') (Deny) ✅
```

#### ✅ Rule 3: Member は常に NG
```typescript
membership = { role: 'member', departmentId: null, ... }
targetDepartmentId = 'dept-001'
assertDepartmentScope(membership, targetDepartmentId)
// → Error('forbidden') (Deny) ✅
```

---

## 📍 適用箇所の監査

### 現在実装済みの API

#### ✅ `assertDepartmentScope` が適用可能な API

| API | Type | Department参 | 編集可否 | 適用状況 |
|-----|------|------------|--------|---------|
| 未実装 | PATCH | departmentId | ✅ | ⏳ Future |
| 未実装 | DELETE | departmentId | ✅ | ⏳ Future |

### 現在の API で department を扱う箇所

#### 1. `/api/admin/invite` - departmentId を持つが「**編集ではなく割り当て**」

| Check | Status | Evidence |
|-------|--------|----------|
| Receives departmentId | ✅ YES | Line 75: `const departmentId = body.departmentId ?? null;` |
| Creates member with dept | ✅ YES | Line 143: `{ ..., department_id: departmentId }` |
| Is admin-only | ✅ YES | Line 111: `if (callerMembership.role !== 'admin')` return 403 |
| Needs assertDepartmentScope | ❌ NO | Admin のみ → すべての部門に割り当て可能 |

**Conclusion**: ✅ OK - Admin-only だから department scope 不要

#### 2. `/api/members` - departmentId を持つが「**新規作成のみ**」

| Check | Status | Evidence |
|-------|--------|----------|
| Receives departmentId | ✅ YES | Line 135: `const departmentId: string \| null = body?.departmentId ?? null;` |
| Operation | POST (create) | - |
| Is admin-only | ✅ YES | Line 96: `if (mine.role !== 'admin')` return 403 |
| Needs assertDepartmentScope | ❌ NO | Admin のみ |

**Conclusion**: ✅ OK - Admin-only

#### 3. `/api/companies/provision` - departmentId を持つが「**特殊: 会社作成**」

| Check | Status | Evidence |
|-------|--------|----------|
| Receives departmentId | ✅ YES | Line 18: `type Body = { departmentId?: string \| null; }` |
| Operation | Company setup | - |
| Auth model | Session-based | Uses getServerUser() |
| Needs assertDepartmentScope | ❌ NO | 新規会社作成 → scope 概念なし |

**Conclusion**: ✅ OK - Onboarding API、scope なし

---

## 🚀 Future Implementation Guide

### 将来、以下の API が追加される場合

```typescript
// PATCH /api/department/update
// 部門情報を更新
export async function PATCH(req: NextRequest) {
  // 1) Bearer token validation
  const userId = await getAuthUserIdFromBearer(admin, req);

  // 2) Membership verification
  const membership = await requireMembership(admin, userId);

  // 3) Request parsing
  const body = await req.json();
  const { departmentId, name, description } = body;

  // 4) ★ Department scope guard (新規）
  assertDepartmentScope(membership, departmentId);

  // 5) DB update (company_id でスコープ）
  const result = await admin
    .from('departments')
    .update({ name, description })
    .eq('company_id', membership.companyId)
    .eq('id', departmentId);

  return NextResponse.json(result);
}
```

### または

```typescript
// DELETE /api/department/:departmentId
// 部門削除（admin のみ可）
export async function DELETE(req: NextRequest) {
  // ... Bearer + Membership ...

  const { departmentId } = params;

  // Admin-only + department scope validation
  if (membership.role !== 'admin') return 403;
  assertDepartmentScope(membership, departmentId);  // admin は必ず pass

  // DB delete
  const result = await admin
    .from('departments')
    .delete()
    .eq('company_id', membership.companyId)
    .eq('id', departmentId);

  return NextResponse.json(result);
}
```

---

## ✅ Certification: Manager 自部門制限

### 仕様確認
- [x] assertDepartmentScope() が正しく実装されている
- [x] Admin rule: 全部門 OK
- [x] Manager rule: 自部門のみ OK
- [x] Member rule: 常に NG

### 適用確認
- [x] 現在の write API は admin-only → 自動的に全部門 OK
- [x] 今後、department編集 API 追加時の適用場所を把握

### 実装チェックリスト（将来）

部門編集 API 追加時：
- [ ] assertDepartmentScope() をインポート
- [ ] Bearer token 検証を実装
- [ ] Membership 検証を実装
- [ ] **assertDepartmentScope(membership, targetDeptId) を呼び出し**
- [ ] DB操作を membership.companyId でスコープ
- [ ] Test: Manager が他部門編集 → 403
- [ ] Test: Manager が自部門編集 → 200
- [ ] Test: Admin が全部門編集 → 200

---

## 📝 仕様補記

### Q: Manager に department_id がない場合、部門編集はどうなる？
**A**: assertDepartmentScope() は Error('forbidden') をスロー。Manager に department_id が無ければ、部門編集機能を使用できない（安全側）。

### Q: Department 削除は？
**A**: 仕様で admin-only に固定（canActionInDepartment() line 165 参照）。Manager は削除不可。

### Q: 複数部門担当 Manager?
**A**: 現在の design は1Manager = 1Department のみ（department_id は単一値）。将来、多対多にする場合は別仕様書で対応。

### Q: Department の作成は？
**A**: 仕様未定。Admin-only にするか、Manager も可にするかは future task。

---

## 🔐 Security Rationale

**なぜ Manager を部門スコープで制限するのか？**

1. **責任分散**: Each manager handles own department
2. **データ漏洩防止**: Manager が他部門データを誤編集できない
3. **監査可能**: Who changed what department → audit logs clear
4. **最小権限の原則**: Manager は必要最小限の権限のみ

---

## 📊 Summary

| Item | Status | Evidence |
|------|--------|----------|
| assertDepartmentScope() 実装 | ✅ | rbacGuard.ts:348-372 |
| Admin rule (全部門) | ✅ | Line 353-355 |
| Manager rule (自部門のみ) | ✅ | Line 358-367 |
| Member rule (NG) | ✅ | Line 370-371 |
| 現在の適用 API | ✅ | Admin-only → 自動OK |
| 将来の適用点 | ✅ | /api/department/* 作成時 |

---

**Generated**: 2026-02-11
**Status**: PHASE C Complete ✅
**Next**: PHASE D - Final Regression Checks
