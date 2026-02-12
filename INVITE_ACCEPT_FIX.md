# /invite/accept ページの二重実行 + provision 混入問題: 修正完了

## 🎯 問題の症状
1. `/api/invites/accept` が2回実行される（React StrictMode による二重実行）
2. `/api/companies/provision` が混入される（不要な会社再生成）

## ✅ 修正内容

### TASK 1: `/app/invite/accept/page.tsx` を修正

#### 修正 1: React StrictMode による二重実行を防止
```typescript
const initDoneRef = useRef(false);

useEffect(() => {
  if (initDoneRef.current) return;  // ← 既に実行済みなら何もしない
  initDoneRef.current = true;

  // ... 処理 ...
}, [token, router]);
```

**効果**: 開発環境で useEffect が二重実行されても、API は1回だけ呼ばれる

#### 修正 2: 詳細なログを追加
```typescript
console.log('[invite/accept] Initialize: checking auth and session');
console.log('[invite/accept] acceptInvite called with token: ...');
console.log('[invite/accept] API response:', { status, ok, error });
console.error('[invite/accept] Error: ...', errorMessage);
console.log('[invite/accept] Success! Invite accepted.');
```

**効果**: ブラウザ/サーバコンソールで流れを追える

#### 修正 3: email_mismatch エラー時のUX 改善
```typescript
{isEmailMismatch && (
  <div className="border-t border-red-200 pt-3 space-y-2">
    <p className="font-semibold text-red-900">対応方法：</p>
    <ol className="list-decimal list-inside space-y-1 text-xs">
      <li>以下のボタンでログアウト</li>
      <li>招待されたメールアドレスでログイン</li>
      <li>招待リンクを再度開く</li>
    </ol>
    <button onClick={handleLogout} className="...">
      ログアウト
    </button>
  </div>
)}
```

**効果**: ユーザーに明確な対応方法を提示

---

### TASK 2: `/app/layoutClient.tsx` で provision を抑制

#### 修正 1: `AUTH_PREFIXES` に `/invite` を追加
```typescript
const AUTH_PREFIXES = [
  '/login',
  '/register',
  '/signup',
  '/signup-admin',
  '/auth',
  '/auth/callback',
  '/auth/welcome',
  '/invite',  // ← 招待フロー（provision 不要）
  '/404',
];
```

**効果**: `/invite/accept` ページでは provision が実行されない

#### 修正 2: provision 抑制時にログ出力
```typescript
if (onAuthScene) {
  if (pathname?.startsWith('/invite/accept')) {
    console.log('[layout] skip provision (on invite accept page, no provision needed)', pathname);
  }
  return;
}
```

**効果**: 本番環境でも provision スキップを確認可能

---

## 📊 修正前後の比較

| 項目 | 修正前 | 修正後 |
|------|--------|--------|
| **acceptInvite 呼び出し回数** | 2回（StrictMode） | 1回（useRef ガード） |
| **provision 実行** | ✓ 実行（混入） | ✗ 実行しない |
| **email_mismatch 時のUI** | 簡潔なメッセージのみ | 詳細な対応方法を表示 |
| **ブラウザコンソール** | ログなし | 詳細ログあり |

---

## 🚀 検証方法

### 1. ローカルテスト（最速確認）
```bash
npm run dev
# DevTools Console を開く（F12 → Console）
# /invite/accept?token=... にアクセス
```

**確認項目**:
```
ブラウザコンソール:
  [invite/accept] Initialize: checking auth and session
  [invite/accept] acceptInvite called with token: ...
  [invite/accept] API response: { status: 200, ok: true, ... }
  [invite/accept] Success! Invite accepted.

サーバコンソール:
  [INVITE_TOKEN_CREATED] New invitation created: ...
  [layout] skip provision (on invite accept page, no provision needed) /invite/accept?token=...

❌ 出るはずのないログ:
  [DEPRECATED_API]
  [DEPRECATED_AUTH_INVITE]
  POST /api/companies/provision
```

### 2. email_mismatch テスト
```
1. User A でログイン
2. User B への招待リンクをアクセス
3. エラー表示:
   "メールアドレスが一致しません"
   "対応方法："
   "1. 以下のボタンでログアウト"
   "2. 招待されたメールアドレスでログイン"
   "3. 招待リンクを再度開く"
   [ログアウト] ボタン
```

### 3. React DevTools で確認（確実な方法）
```
1. React DevTools をインストール
2. /invite/accept?token=... にアクセス
3. Profiler で useEffect の呼び出し回数を確認
   → Development: 2回（マウント時に2回）
   → 実際のAPI: 1回（useRef ガード）
```

---

## 📋 修正ファイル一覧

```
修正:
  ~ app/invite/accept/page.tsx     (useRef ガード + ログ + UX改善)
  ~ app/layoutClient.tsx           (provision 抑制 + ログ)

新規:
  + INVITE_ACCEPT_FIX.md           (このファイル)
```

---

## ✅ 完了チェックリスト

- [x] useRef でacceptInvite の二重実行をガード
- [x] email_mismatch エラー時のUXを改善（対応方法を明確に）
- [x] AUTH_PREFIXES に `/invite` を追加
- [x] provision 実行時にログを追加
- [x] ブラウザ/サーバコンソールのログが追跡可能
- [x] TypeScript 型チェック: ✅ クリア

---

## 🔍 今後の監視

### 本番環境でのデバッグ

`/invite/accept` ページが遅い or エラーが出る場合：

```bash
# サーバログで以下を確認
grep "[INVITE_TOKEN_CREATED]" logs/server.log
grep "[layout] skip provision" logs/server.log

# ブラウザコンソール (F12)
# [invite/accept] ログが1回だけ出ているか
# [invite/accept] Success! が出ているか
```

### React StrictMode による追加検証

開発環境（`next.config.js` で StrictMode 有効）:
```
useEffect の呼び出し: 2回（正常）
API /api/invites/accept の呼び出し: 1回（useRef ガード効果）
```

本番環境（StrictMode 無効）:
```
useEffect の呼び出し: 1回（正常）
API /api/invites/accept の呼び出し: 1回（正常）
```

---

**修正完了日**: 2026-02-12
**ステータス**: 🟢 本番リリース準備完了

次は本番環境でのテストに進んでください！
