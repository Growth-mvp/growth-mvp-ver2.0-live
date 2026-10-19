# API/UI 実装チェックリスト

> **廃止（旧版）**: この文書は GET 方式・クライアント送信の本文を前提としており、現在の設計と一致しません。
> 最新の設計は `DESIGN_PLAN_STORAGE.md`、実装参考は `IMPLEMENTATION_TEMPLATE.md`、承認事項は `FINAL_DESIGN_REVIEW.md` を参照してください。

**目的**: 経営計画書の保存・復元機能の実装対象ファイルを明確化

**実装段階**: 設計確認後のコード実装 → テスト → デプロイ

---

## 1. 新規ファイル作成

### 1-1. `utils/supabase/generated-plans.ts`

**役割**: Supabase `generated_plans` テーブルへのアクセス層

**主要関数**:
- `getSavedPlan()`: 保存済み計画書を取得（SELECT）
- `savePlan()`: 計画書を保存または更新（UPSERT）
- 型定義: `SavedPlanRequest`, `GeneratedPlanRequest`, `SavedPlanResponse`

**依存ライブラリ**:
- `@supabase/supabase-js`
- `zod`

**実装例**: `IMPLEMENTATION_TEMPLATE.md` 参照

---

### 1-2. `app/api/plans/[audience]/saved/route.ts`

**役割**: 保存済み計画書取得 API

**HTTP メソッド**: `POST` （理由: companyId/strategyId/audience を body で検証）

**リクエスト**:
```json
{
  "companyId": "UUID",
  "strategyId": "UUID",
  "audience": "bank" | "shareholder" | "employee"
}
```

**レスポンス (200 OK)**:
```json
{
  "id": "UUID",
  "generatedText": "...",
  "sections": ["...", "..."],
  "generatedAt": "2026-10-19T10:30:00Z",
  "sourceRevision": 5,
  "createdBy": "user-uuid"
}
```

**エラーレスポンス**:
- 401: Unauthorized (未認証)
- 403: Forbidden (権限なし、別企業)
- 404: Not Found (計画書が存在しない)
- 400: Bad Request (入力値エラー)

**実装手順**:
1. Bearer トークンで認証 → `getAuthUserIdFromBearer()`
2. `requireMembership()` で会社スコープ確認
3. strategy_data の company_id 確認
4. `getSavedPlan()` で取得
5. RLS により自動フィルタリング

---

### 1-3. `app/api/plans/[audience]/save/route.ts`

**役割**: 計画書保存 API

**HTTP メソッド**: `POST`

**リクエスト**:
```json
{
  "companyId": "UUID",
  "strategyId": "UUID",
  "audience": "bank" | "shareholder" | "employee",
  "generatedText": "...",
  "sections": ["...", "..."],
  "generatedAt": "2026-10-19T10:30:00Z",
  "sourceRevision": 5
}
```

**レスポンス (200 OK)**:
```json
{
  "id": "UUID",
  "createdAt": "2026-10-19T10:30:00Z",
  "updatedAt": "2026-10-19T10:31:00Z"
}
```

**エラーレスポンス**:
- 401: Unauthorized
- 403: Forbidden (admin/manager ロール必須)
- 400: Bad Request
- 500: Internal Server Error（DB エラー）

**実装手順**:
1. 認証 → `getAuthUserIdFromBearer()`
2. `requireMembership()` + ロール確認（admin/manager）
3. strategy_data の company_id 確認
4. Zod スキーマ検証
5. `savePlan()` で UPSERT → PostgreSQL ON CONFLICT を使用
6. 監査ログ記録 → `logAuditEvent()`

**重要**: service_role 利用時でも membership を厳密に検証

---

## 2. 既存ファイル修正

### 2-1. `app/report/bank-plan/page.tsx`

**変更内容**: 保存済み計画書の自動復元、再生成ボタンの表示制御

#### 追加 State

```typescript
// L26 の下に追加
const [savedAt, setSavedAt] = useState<string | null>(null);
const [isRestoring, setIsRestoring] = useState(false);
const [saveError, setSaveError] = useState<string | null>(null);
```

#### 追加 Effect（マウント時に保存済み計画書を復元）

```typescript
// L47 の useEffect の後に追加
useEffect(() => {
  if (!strategyState.companyId || !strategyState.strategyId || isRestoring) {
    return;
  }

  const fetchSavedPlan = async () => {
    setIsRestoring(true);
    setSaveError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;

      const response = await fetch(`/api/plans/${audience}/saved`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          companyId: strategyState.companyId,
          strategyId: strategyState.strategyId,
          audience,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setGeneratedSections(result.sections);
        setSavedAt(result.generatedAt);
      }
      // 404 は "未生成" として扱う（エラーではない）
    } catch (err) {
      console.log('Saved plan not found (expected on first generation)');
    } finally {
      setIsRestoring(false);
    }
  };

  fetchSavedPlan();
}, [strategyState.companyId, strategyState.strategyId, audience]);
```

#### 修正 handleGeneratePlan（生成成功時に自動保存）

現在のコード（L49-98）の末尾に追加：

```typescript
  // ★ 生成成功時に自動保存
  try {
    const saveResponse = await fetch(`/api/plans/${audience}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        companyId: strategyState.companyId,
        strategyId: strategyState.strategyId,
        audience,
        generatedText: result.generatedText,
        sections: result.sections,
        generatedAt: result.generatedAt,
      }),
    });

    if (saveResponse.ok) {
      setSavedAt(result.generatedAt);
      setSaveError(null);
    } else {
      // 保存に失敗しても、生成本文は表示する（未保存と表示）
      const errorData = await saveResponse.json().catch(() => ({}));
      setSaveError(
        errorData.error || '計画書の保存に失敗しました。再度お試しください。'
      );
    }
  } catch (saveErr) {
    console.warn('Failed to save plan:', saveErr);
    setSaveError(
      '計画書の保存に失敗しました。再度お試しください。'
    );
  }
```

#### 修正 UI ボタン表示（L150-166）

```typescript
<div className="flex flex-wrap items-center gap-3">
  {!generatedSections ? (
    <button
      onClick={handleGeneratePlan}
      disabled={isGenerating || isRestoring}
      className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      {isGenerating ? '生成中...' : isRestoring ? '復元中...' : 'AI本文を生成'}
    </button>
  ) : (
    <>
      <button
        onClick={handleGeneratePlan}
        disabled={isGenerating}
        className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isGenerating ? '再生成中...' : 'AIで再生成'}
      </button>
      {savedAt && !saveError && (
        <span className="text-xs text-gray-500">
          生成済み: {new Date(savedAt).toLocaleString('ja-JP')}
        </span>
      )}
      {saveError && (
        <span className="text-xs text-amber-600">
          ⚠️ 保存失敗: {saveError}
        </span>
      )}
    </>
  )}
  <button
    onClick={() => window.print()}
    className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900"
  >
    📥 PDFダウンロード
  </button>
</div>
```

#### 追加 会社切替時のリセット

layoutClient.tsx の companyId 変化を監視し、計画書をリセット：

```typescript
// 別ファイルで実装する場合は、useEffect で companyId 変化を監視
useEffect(() => {
  // companyId が変わった → 計画書をリセット
  if (previousCompanyId.current && previousCompanyId.current !== strategyState.companyId) {
    setGeneratedSections(null);
    setSavedAt(null);
    setSaveError(null);
  }
  previousCompanyId.current = strategyState.companyId;
}, [strategyState.companyId]);
```

---

### 2-2. `components/export/PlanPreview.tsx`

**変更内容**: 生成日時の表示

#### Props 追加

```typescript
export interface PlanPreviewProps {
  data: PlanData;
  audience: AudienceType;
  generatedSections?: string[];
  isGenerating?: boolean;
  onGenerate?: () => Promise<void>;
  savedAt?: string; // ★ 追加
}
```

#### ヘッダーに生成日時を表示（L118-120 の後）

```typescript
{savedAt && (
  <p className="text-xs text-gray-500 mt-1">
    生成日時: {new Date(savedAt).toLocaleString('ja-JP')}
  </p>
)}
```

---

### 2-3. `app/report/bank-plan/page.tsx` のコンポーネント呼び出し修正

```typescript
// L180-186 の <PlanPreview> 呼び出しに savedAt を渡す
<PlanPreview
  data={planData}
  audience={audience}
  generatedSections={generatedSections || undefined}
  isGenerating={isGenerating}
  onGenerate={handleGeneratePlan}
  savedAt={savedAt || undefined}  // ★ 追加
/>
```

---

## 3. 既存ファイル確認（修正不要）

| ファイル | 確認項目 | 理由 |
|---------|--------|------|
| `lib/server/rbacGuard.ts` | `requireMembership()` 使用可能 | 既存で API 認証実装済み |
| `lib/supabaseAdmin.ts` | service_role 取得 | 既存で実装済み |
| `lib/server/auditLog.ts` | `logAuditEvent()` 使用可能 | 監査ログ記録 |
| `utils/supabase/strategy.ts` | strategy_data 外部キー確認 | ON DELETE CASCADE 動作確認 |

---

## 4. 実装時の重要チェックポイント

### 4-1. 認証・権限

- [ ] Bearer トークン検証（`getAuthUserIdFromBearer()`）
- [ ] membership 検証（`requireMembership(admin, userId, companyId)`）
- [ ] ロール確認（admin/manager のみ保存可）
- [ ] 他企業データアクセス拒否
- [ ] 他戦略 ID アクセス拒否

### 4-2. データ整合性

- [ ] UPSERT で duplicate key エラー対応
- [ ] company_id の変更禁止
- [ ] audience の値チェック（bank/shareholder/employee のみ）
- [ ] generated_text が空でない
- [ ] generated_at が有効な ISO 形式

### 4-3. エラーハンドリング

- [ ] 保存失敗時に生成本文は表示したまま（ユーザーは失敗に気づく）
- [ ] 再保存可能（ボタンは活性のまま）
- [ ] 404 は "未生成" として処理（エラーメッセージ非表示）
- [ ] 401/403 は明確なメッセージ

### 4-4. UI/UX

- [ ] 初回: 「AI本文を生成」ボタン
- [ ] 生成済み: 「AIで再生成」ボタン + 生成日時表示
- [ ] 保存失敗: ⚠️ エラーメッセージ表示、再保存可能
- [ ] 復元中: ローディング状態表示

### 4-5. RLS・セキュリティ

- [ ] RLS 有効化（テーブル作成後）
- [ ] SELECT ポリシーで company_members 確認
- [ ] INSERT/UPDATE/DELETE で ロール確認
- [ ] api/UI 側でも membership 二重確認
- [ ] service_role 利用時も厳密に検証

---

## 5. テスト計画（実装後）

### 5-1. 単体テスト（API）

```typescript
describe('POST /api/plans/bank/saved', () => {
  it('should return 404 when no plan exists', async () => {...});
  it('should return 401 when unauthorized', async () => {...});
  it('should return saved plan when exists', async () => {...});
});

describe('POST /api/plans/bank/save', () => {
  it('should save plan for admin/manager', async () => {...});
  it('should reject for viewer role', async () => {...});
  it('should reject for different company', async () => {...});
  it('should UPSERT on duplicate key', async () => {...});
});
```

### 5-2. 統合テスト（UI）

1. ✅ 初回アクセス → 「生成」ボタン表示
2. ✅ AI生成成功 → 自動保存 + 「再生成」ボタン表示
3. ✅ F5 リロード → 計画書復元
4. ✅ 別ページ移動 → データ消えない
5. ✅ 会社切替 → 旧企業計画書消える
6. ✅ 保存失敗 → 本文表示、再保存可能
7. ✅ 別ユーザー（同社） → 計画書参照可
8. ✅ 別ユーザー（別社） → 計画書参照不可

---

## 6. デプロイ手順（実装後）

1. マイグレーション SQL 実行（Supabase Console）
2. 型チェック・ビルド確認
3. ステージング環境でテスト
4. 本番反映

---

## 7. ロールバック計画

万が一問題が発生した場合：

```sql
-- テーブル削除
DROP TABLE IF EXISTS generated_plans CASCADE;

-- API/UI は機能disabled（old branch にリバート）
```

---

**実装準備完了。次フェーズで設計書をもとにコード実装を開始します。**

