# 規約・プライバシー同意機能 実装計画書

**対象文書**:
- /terms - 利用規約（2026年7月31日版 v1.0）
- /privacy - プライバシーポリシー（2026年7月31日版 v1.0）

**版番**: v1.0  
**作成日**: 2026年7月31日

---

## 1. 概要

本計画書は、GROWTH SHIFTの利用者による利用規約・プライバシーポリシーの明示的同意を記録するための実装計画を定めるものです。

### 1.1 実装方針

- **必須記録**: user_id、company_id、terms_version、privacy_version、accepted_at
- **既存ユーザー対応**: 自動同意化しない。初回ログイン時に取得
- **法人契約対象外**: 法人との契約締結だけを理由に同意済みにしない
- **改定対応**: 新バージョン発行時に自動的に再同意を取得

### 1.2 実装スコープ

| 対象 | 実装 | 非対象 |
|------|------|--------|
| /terms と /privacy への正式版掲載 | ✅ | - |
| 同意画面の統一化（/auth/consent） | ✅ | 招待受諾・初回ログインでの重複実装なし |
| 利用規約・プライバシーの一括同意 | ✅ | 別々の API 実装なし |
| 同意チェックボックス | ✅ | - |
| 未同意ユーザーのアクセス制御（middleware + API） | ✅ | 画面のみではなく API へのアクセスも制御 |
| 同意履歴の記録 | ✅ | IPアドレス（不必須） |
| サーバー側バージョン管理 | ✅ | クライアント指定不可 |
| 再同意フロー | ✅ | - |
| 管理者向け同意履歴確認 | ✅ API/手順 | 管理画面は本計画の対象外 |

---

## 2. DBテーブル案

### 2.1 新規テーブル: `user_consents`

**用途**: 利用者の同意履歴を記録（利用規約・プライバシーポリシーを一括記録）

```sql
CREATE TABLE IF NOT EXISTS public.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 識別情報
  user_id UUID NOT NULL REFERENCES auth.users(id),
  company_id UUID NOT NULL REFERENCES public.companies(id),
  
  -- 文書バージョン（両方を一括記録）
  terms_version TEXT NOT NULL,           -- e.g., 'v1.0'
  privacy_version TEXT NOT NULL,         -- e.g., 'v1.0'
  
  -- 同意日時
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- メタデータ
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- 複合ユニーク制約: 同じバージョン組合せへの重複同意を防止
  UNIQUE(user_id, company_id, terms_version, privacy_version)
);

-- インデックス
CREATE INDEX idx_user_consents_user_id ON public.user_consents(user_id);
CREATE INDEX idx_user_consents_company_id ON public.user_consents(company_id);
CREATE INDEX idx_user_consents_accepted_at ON public.user_consents(accepted_at DESC);
```

**カラム説明**:
- `id`: レコードの一意識別子
- `user_id`: 同意したユーザーID
- `company_id`: ユーザーが所属する企業ID
- `terms_version`: 利用規約のバージョン（'v1.0', 'v2.0' 等。サーバー側で管理）
- `privacy_version`: プライバシーポリシーのバージョン（同上）
- `accepted_at`: 同意した日時（ISO 8601 形式）
- `created_at`: レコード作成日時

**重要**: 利用規約とプライバシーポリシー両方を 1 レコードに記録し、原子性を確保。

### 2.2 テーブル設計の特徴

1. **一括同意**: 利用規約・プライバシーポリシーを同時に記録（片方だけ記録される状態を防止）
2. **複合キー**: (user_id, company_id, terms_version, privacy_version) で一意性を確保
3. **Append-only**: 新しい同意レコードを追加し、既存レコードは削除しない（監査証跡）
4. **サーバー側バージョン管理**: クライアントが任意のバージョンを指定できない設計
5. **外部キー**: Append-only ポリシーに合わせて ON DELETE を CASCADE ではなく制限する（要確認）

---

## 3. RLS（Row Level Security）案

### 3.1 RLS 有効化

```sql
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
```

### 3.2 ポリシー1: ユーザーは自身の同意レコードのみ閲覧可能

```sql
CREATE POLICY "user_consents_select_own"
  ON public.user_consents
  FOR SELECT
  USING (user_id = auth.uid());
```

**対象**: authenticated ユーザー  
**条件**: ログイン中のユーザーが自身のレコード（user_id = auth.uid()）のみ SELECT 可能

### 3.3 ポリシー2: 認証ユーザーのみ新規同意を INSERT 可能

```sql
CREATE POLICY "user_consents_insert_authenticated"
  ON public.user_consents
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND company_id IN (
      SELECT company_id FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );
```

**対象**: authenticated ユーザー  
**条件**:
- user_id が現在のログインユーザーと一致
- company_id が company_members テーブルに存在（ユーザーが当該企業に所属している）

### 3.4 ポリシー3: 管理者は所属企業の全同意レコードを閲覧可能

```sql
CREATE POLICY "user_consents_select_admin"
  ON public.user_consents
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.company_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
```

**対象**: 管理者（admin ロール）  
**条件**: 所属企業の全ユーザーの同意レコードを閲覧可能（監査用）

---

## 4. API案

### 4.1 API: POST /api/consents/accept

**目的**: 利用規約・プライバシーポリシー両方の同意を一括記録

**認証**: Bearer トークン必須

**リクエスト**:
```json
{
  // リクエストボディは空（バージョンはサーバー側で管理）
}
```

**現行バージョンはサーバー側で管理**:
```typescript
// 環境変数またはコンフィグから取得
const CURRENT_TERMS_VERSION = "v1.0";
const CURRENT_PRIVACY_VERSION = "v1.0";
```

**レスポンス（成功 201）**:
```json
{
  "success": true,
  "consentId": "uuid",
  "termsVersion": "v1.0",
  "privacyVersion": "v1.0",
  "acceptedAt": "2026-07-31T14:30:00Z"
}
```

**レスポンス（エラー）**:
```json
{
  "success": false,
  "error": "unauthorized",
  "message": "認証が必要です"
}
```

**実装ファイル**: `/app/api/consents/accept/route.ts`

**実装内容**:
1. Bearer トークンから user_id を抽出
2. 現在のログインユーザーの company_id を取得
3. サーバー側の現行バージョンを取得（CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION）
4. user_consents テーブルに 1 レコード INSERT（両方を一括）
5. 重複チェック（既に同じバージョン組合せに同意済みなら冪等）
6. 成功レスポンス返却

**重要**: クライアントからのバージョン指定は受け付けない。

---

### 4.2 API: GET /api/consents/status

**目的**: ユーザーが現行版の利用規約・プライバシーに同意しているか確認

**認証**: Bearer トークン必須

**リクエスト**:
```
GET /api/consents/status
```

**レスポンス（同意済み）**:
```json
{
  "hasConsented": true,
  "acceptedAt": "2026-07-31T14:30:00Z",
  "termsVersion": "v1.0",
  "privacyVersion": "v1.0"
}
```

**レスポンス（未同意）**:
```json
{
  "hasConsented": false,
  "acceptedAt": null,
  "currentTermsVersion": "v1.0",
  "currentPrivacyVersion": "v1.0"
}
```

**実装ファイル**: `/app/api/consents/status/route.ts`

**実装内容**:
1. Bearer トークンから user_id を抽出
2. サーバー側の現行バージョンを取得
3. user_consents テーブルをクエリして、当該バージョン組合せに同意済みか確認
4. **DB障害時は同意済みと誤判定しない**（失敗時は同意なしと判定）
5. レスポンス返却

---

### 4.3 API: GET /api/consents/history（管理者向け）

**目的**: 同意履歴を確認する（管理者用）

**認証**: Bearer トークン必須  
**権限**: admin ロール必須

**クエリパラメータ**:
```
?companyId=uuid&userId=uuid（オプション）
```

**レスポンス**:
```json
{
  "consents": [
    {
      "id": "uuid",
      "userId": "xxxx",
      "companyId": "yyyy",
      "termsVersion": "v1.0",
      "privacyVersion": "v1.0",
      "acceptedAt": "2026-07-31T14:30:00Z"
    }
  ]
}
```

**実装内容**:
1. Bearer トークンから user_id を抽出
2. admin ロール確認
3. 所属企業の同意履歴をクエリ
4. **別会社の履歴は見えない（RLS で保護）**

---

## 5. 同意フローの統一設計

### 5.1 統一フロー（新規・既存利用者）

**共通フロー**（招待受諾・初回ログイン両方）:
```
ログイン完了 → セッション確認
  ↓
/api/consents/status で同意状態をチェック
  ├─ 同意済み → ダッシュボードへ移動
  └─ 未同意 → /auth/consent にリダイレクト
    ↓
  /auth/consent で利用規約・プライバシー同意
    ↓
  POST /api/consents/accept で記録
    ↓
  ダッシュボードへ移動
```

**重要**: 招待受諾フロー（/invite/accept）と初回ログイン時（/dashboard）で異なる画面を実装せず、**統一して /auth/consent を経由する設計**。

### 5.2 招待受諾フロー（/invite/accept）の修正

**修正内容**:
- `/invite/accept` ではパスワード設定のみ実施
- 招待完了後、自動的に `/auth/consent` へリダイレクト
- `/auth/consent` で同意を取得

**実装方法**:
```typescript
// /app/invite/accept/InviteAcceptClient.tsx

// パスワード設定完了時
await fetch('/api/invites/complete', {...});

// 招待完了後、/auth/consent へリダイレクト
router.push('/auth/consent');  // 同意画面へ
```

---

### 5.3 初回ログイン時の修正

**UI変更箇所**: `/app/auth/consent/page.tsx`（新規、新規・既存利用者共用）

**同意画面の実装**:
統一された /auth/consent ページで、新規・既存利用者を区別せず実装。
```typescript
// /app/auth/consent/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

export default function ConsentPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
      } else {
        setUser(session.user);
      }
    };
    checkAuth();
  }, [router]);

  const handleSubmit = async () => {
    if (!agreeTerms || !agreePrivacy) {
      setError('両方に同意してください');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 利用規約・プライバシーポリシー両方を一度に記録
      const res = await fetch('/api/consents/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})  // ボディは空（バージョンはサーバー側で管理）
      });

      if (!res.ok) throw new Error('同意の記録に失敗しました');

      // ダッシュボードへリダイレクト
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '同意の記録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return <div>ロード中...</div>;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold mb-4">サービス利用開始前のご確認</h1>
        
        <p className="text-gray-600 mb-6">
          GROWTH SHIFT をご利用いただく前に、以下の文書にご同意ください。
        </p>

        <div className="space-y-4 mb-6">
          <label className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <a href="/terms" target="_blank" rel="noopener" className="underline text-blue-600">
                利用規約
              </a>
              に同意します <span className="text-red-600">*</span>
            </span>
          </label>

          <label className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={agreePrivacy}
              onChange={(e) => setAgreePrivacy(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <a href="/privacy" target="_blank" rel="noopener" className="underline text-blue-600">
                プライバシーポリシー
              </a>
              に同意します <span className="text-red-600">*</span>
            </span>
          </label>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex-1 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            ログアウト
          </button>
          <button
            onClick={handleSubmit}
            disabled={!agreeTerms || !agreePrivacy || loading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '処理中...' : 'サービスを利用開始'}
          </button>
        </div>
      </div>
    </main>
  );
}
```

---

## 6. 未同意利用者のアクセス制御（middleware + API層）

### 6.1 保護対象の明示的列挙

```typescript
// 保護対象ページ（同意が必須）
const PROTECTED_PATHS = [
  '/dashboard',
  '/strategy',
  '/cascade',
  '/execution',
  '/admin',
  '/okr',
  '/org-alignment'
];

// 免除対象（同意チェック不要）
const EXEMPT_PATHS = [
  '/login',
  '/auth/consent',
  '/auth/link-invited-user',
  '/invite/accept',
  '/terms',
  '/privacy'
];
```

### 6.2 Middleware での制御（画面レベル）

```typescript
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 免除ページはそのまま通す
  if (EXEMPT_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 保護対象ページへのアクセス時
  if (PROTECTED_PATHS.some(p => pathname.startsWith(p))) {
    const session = getSession(request);
    
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // /api/consents/status で確認
    const consentStatus = await checkConsentStatus(session.user.id);
    
    if (!consentStatus.hasConsented) {
      return NextResponse.redirect(new URL('/auth/consent', request.url));
    }
  }

  return NextResponse.next();
}

async function checkConsentStatus(userId: string) {
  // Cookie に認証情報がない場合の処理
  // サーバー側で安全に確認する
}
```

### 6.3 API層での制御（直接アクセス防止）

**保護対象 API**（生成系、管理系等）:
```typescript
// /app/api/generate/route.ts, /app/api/strategy/route.ts 等

export async function POST(req: Request) {
  const userId = await getAuthUserId(req);  // 認証確認
  
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 同意状態を確認
  const consentStatus = await fetch('http://localhost:3000/api/consents/status', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${authToken}`
    }
  });

  const status = await consentStatus.json();
  
  if (!status.hasConsented) {
    return NextResponse.json(
      { error: 'consent_required', message: '利用規約に同意が必要です' },
      { status: 403 }
    );
  }

  // 通常処理
  // ...
}
```

**重要**: DB 障害時は同意済みと誤判定しない（HTTP 5xx が返される場合は安全側に制御）。

---

## 7. 試験項目

### 7.1 正常系（新規ユーザー：招待受諾）

| # | テスト項目 | 期待結果 | 合格条件 |
|----|----------|--------|--------|
| 1 | 招待リンクをクリック | /invite/accept ページが表示 | ページ表示成功 |
| 2 | パスワード設定完了 | /auth/consent へリダイレクト | 同意画面に移動 |
| 3 | 利用規約・プライバシー両方をチェック | 「サービス利用開始」ボタン enabled | ボタンが clickable |
| 4 | 「サービス利用開始」をクリック | ダッシュボード遷移 | 遷移成功 |
| 5 | user_consents テーブル確認 | **1レコード**（terms_version='v1.0', privacy_version='v1.0'） | **両方が同時に記録** |
| 6 | 次のログイン時 | ダッシュボード直接表示（同意画面スキップ） | 同意画面表示されず |

### 7.2 正常系（既存ユーザー：初回ログイン）

| # | テスト項目 | 期待結果 | 合格条件 |
|----|----------|--------|--------|
| 1 | ログイン完了 | middleware の同意チェック実行 | リダイレクト無し |
| 2 | /dashboard にアクセス | /auth/consent にリダイレクト | リダイレクト成功 |
| 3 | 同意画面で両チェック | ボタン enabled | ボタンが clickable |
| 4 | 「サービス利用開始」をクリック | ダッシュボード遷移 | 遷移成功 |
| 5 | user_consents テーブル確認 | **1レコード新規作成** | 新規レコード存在 |

### 7.3 未同意ユーザーのアクセス制御

| # | テスト項目 | 期待結果 | 合格条件 |
|----|----------|--------|--------|
| 1 | 未同意状態で /dashboard アクセス | /auth/consent にリダイレクト | リダイレクト成功 |
| 2 | 未同意状態で API を直接呼び出し（curl等） | 403 エラー返却（consent_required） | **403 status** |
| 3 | DB障害時に同意状態をチェック | 同意済みと誤判定されない（安全側に制御） | 同意画面へリダイレクト |
| 4 | 別会社の同意履歴を参照しようとする | RLS で拒否（403） | **アクセス不可** |
| 5 | 片方だけ同意チェック | ボタン disabled のまま | clickable ではない |
| 6 | 両方チェック後にクリック | POST /api/consents/accept 成功 | 201 レスポンス |

### 7.4 規約改定時（v1.0 → v1.1）

| # | テスト項目 | 期待結果 | 合格条件 |
|----|----------|--------|--------|
| 1 | サーバー側バージョン更新（env変更） | /api/consents/status が v1.1 を返す | currentTermsVersion='v1.1' |
| 2 | v1.0 に同意済みユーザーがアクセス | /auth/consent にリダイレクト（再同意要求） | リダイレクト成功 |
| 3 | v1.1 に同意 | **新レコード（v1.0とv1.1両方存在）** | Append-only で保持 |
| 4 | 同意履歴確認API | v1.0, v1.1 のレコード両方取得 | 2レコード存在 |
| 5 | ログアウト後、再ログイン | ダッシュボード直接表示（v1.1済み） | 同意画面スキップ |

### 7.5 原子性・バージョン管理

| # | テスト項目 | 期待結果 | 合格条件 |
|----|----------|--------|--------|
| 1 | **利用規約とプライバシーが一度に記録** | POST /api/consents/accept で両方が記録 | **1回の API呼び出しで完了** |
| 2 | **片方だけ記録される状態が発生しない** | TX 失敗時は両方登録されない | **All-or-nothing** |
| 3 | **クライアントが旧バージョンを送信** | サーバー側の現行版で記録される（送信内容は無視） | 現行版で記録 |
| 4 | **クライアントが任意バージョンを指定** | 無視される（サーバー側バージョン優先） | 現行版で記録 |

---

## 8. ロールバック方針

### 8.1 本番デプロイ後のロールバック

**シナリオ**: 同意機能に不具合が発生した場合

**ロールバック手順**:

```
1. 本番コードをロールバック（git revert または前バージョンへの restore）

2. Vercel を前デプロイ状態へ戻す
   - Vercel ダッシュボードで「Previous Deployment」を復元
   - または git タグから再デプロイ

3. 新規利用を一時停止
   - 既存ログイン中のユーザーは利用継続可（セッション保持）
   - 新規招待・ログインは不可に制御

4. 修正版または前版のデプロイまで待機

5. 同意機能が正常になるまで、未同意ユーザーはサービスへ通さない
   - 同意チェックを外すことは禁止（セキュリティリスク）

6. ロールバック完了を PoC 提供先企業に報告
```

### 8.2 user_consents テーブルの取り扱い

**ロールバック時**:
- user_consents テーブルは削除しない
- 既に記録されたデータは保持（監査証跡）
- 本番アプリから user_consents を参照しなくなるだけ

**本運用化時**:
- user_consents テーブルはPoC終了後も保持し、本運用時のユーザー同意履歴の基礎データとしても活用可能

### 8.3 禁止事項

**以下は禁止**:
- ❌ 同意チェックをコメントアウトまたは削除して、未同意ユーザーを通す
- ❌ user_consents テーブルを削除
- ❌ RLS を無効化

**代替手段**:
- ✅ 新規利用を一時停止
- ✅ 修正版をデプロイ待機
- ✅ 同意機能が正常になるまで市場に提供しない

---

## 9. 文書の正式版掲載

### 9.1 ファイル名・バージョン管理

**正式文書の保存先と命名規則**:

| 文書 | ファイル名 | バージョン | 公開先ページ |
|------|----------|----------|----------|
| 利用規約 | `TERMS_OF_SERVICE_v1.0_20260731.md` | v1.0（2026年7月31日） | `/terms` |
| プライバシーポリシー | `PRIVACY_POLICY_v1.0_20260731.md` | v1.0（2026年7月31日） | `/privacy` |

**ファイル保存位置**: `/docs/legal/`

**サーバー側バージョン管理**（env または config）:
```typescript
export const CURRENT_TERMS_VERSION = "v1.0";
export const CURRENT_PRIVACY_VERSION = "v1.0";
export const TERMS_UPDATED_DATE = "2026-07-31";
export const PRIVACY_UPDATED_DATE = "2026-07-31";
```

### 9.2 /terms ページの実装

**現在**: プレースホルダー  
**変更後**: `/docs/legal/TERMS_OF_SERVICE_v1.0_20260731.md` の正式文書

**実装方法**（推奨オプションA）:

```typescript
// /app/terms/page.tsx

export default function TermsPage() {
  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1>利用規約</h1>
      <p>版: v1.0（2026年7月31日）</p>
      {/* /docs/legal/TERMS_OF_SERVICE_v1.0_20260731.md の内容をここに記載 */}
      ...
    </main>
  );
}
```

### 9.3 /privacy ページの実装

/terms と同様（`PRIVACY_POLICY_v1.0_20260731.md` を使用）

### 9.4 バージョン改定時の対応

新バージョン公開時:
1. 新ファイル作成: `TERMS_OF_SERVICE_v2.0_YYYYMMDD.md`
2. サーバー側バージョン更新: `CURRENT_TERMS_VERSION = "v2.0"`
3. `/terms` ページ更新
4. 既存ユーザーへ再同意を要求（middleware が自動的にリダイレクト）

---

## 10. 実装の最小スコープ（優先順位）

### 10.1 実装前の確認事項（PoC開始前に必須）

- [ ] **既存 company_members テーブルで role 値を確認** - RLS ポリシーで参照する値（'admin', 'manager', 'member'）
- [ ] **外部キー制約の方向性を確認** - Append-only ポリシーに合わせて ON DELETE を制限するか確認
- [ ] **既存 auth.users テーブル構造確認** - RLS ポリシーで使用する auth.uid() とのマッピング確認

### 10.2 必須実装（P0）

- [ ] user_consents テーブル作成（ON DELETE 制約を確認後）
- [ ] RLS ポリシー設定（company_members テーブルスキーマに基づいて）
- [ ] POST /api/consents/accept 実装（両文書一括記録）
- [ ] GET /api/consents/status 実装（現行バージョン確認）
- [ ] /auth/consent ページ実装（新規・既存利用者統一）
- [ ] middleware の同意チェック追加（保護対象パス明示）
- [ ] API層での同意チェック追加（403 エラー返却）
- [ ] /terms, /privacy に正式文書掲載（v1.0_20260731）
- [ ] サーバー側バージョン管理設定（env または config）

### 10.3 オプション（P1）

- [ ] GET /api/consents/history 実装（管理者向け同意履歴確認）
- [ ] 同意履歴管理画面（管理者向け、本計画の対象外）

---

## 11. まとめ

本計画書は、GROWTH SHIFT の利用者による利用規約・プライバシーポリシーへの明示的同意を、**最小限の実装**で記録するための設計を提供しています。

### 11.1 設計の重要な特徴

| 項目 | 実装方法 | 理由 |
|------|---------|------|
| **一括同意** | 1レコード（terms_version + privacy_version） | 原子性の確保、片方だけ記録される状態を防止 |
| **バージョン管理** | サーバー側で管理（env/config） | クライアント側の任意指定を防止 |
| **統一フロー** | /auth/consent に一本化 | 新規・既存利用者の区別なし |
| **二重制御** | middleware + API層 | 画面からの逃避路防止、直接API呼び出し防止 |
| **安全側設定** | DB障害時は同意なしと判定 | 誤判定を防止 |
| **Append-only** | レコード削除なし、新規追加のみ | 監査証跡の完全性 |

### 11.2 ロールバック方針

- ❌ 同意チェック外し・削除（禁止）
- ✅ 新規利用一時停止
- ✅ コード修正版デプロイ待機
- ✅ 同意機能が正常になるまで市場提供なし

