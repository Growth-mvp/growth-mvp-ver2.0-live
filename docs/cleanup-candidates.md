# クリーンアップ候補ファイル一覧

**調査日**: 2025-01-19
**対象ブランチ**: `fix/stage6-not-hydrated`
**調査方法**: ripgrep / Glob / 手動参照確認

---

## 📋 概要

本リポジトリの不要ファイルを調査し、削除候補を分類しました。
**重要**: このドキュメントは調査結果であり、削除は実施していません。

### 調査スコープ

- **対象**: 176+ TypeScript/TSX ファイル、30+ API エンドポイント、archive ディレクトリ、バックアップファイル
- **検出方法**:
  - 静的参照検出（import / require / fetch calls）
  - ディレクトリ構造分析
  - API 呼び出し元の逆引き
  - 旧ステージ/レガシーマーク確認
- **確認内容**: 参照がないかどうか、動的インポート、router.push() での文字列参照

---

## 🎯 削除候補分類表

### 【カテゴリ: 安全（SAFE）】削除リスク最小

| ファイル/ディレクトリ | 理由 | 参照確認状況 | リスク | 推奨 |
|---|---|---|---|---|
| `archive/2025-08-10_unused/AddProjectForm.tsx` | 旧コンポーネント（archive 日付付き） | ✓ 参照ゼロ | 低 | **削除可** |
| `archive/2025-08-10_unused/DepartmentBlock.tsx` | 旧コンポーネント（archive 日付付き） | ✓ 参照ゼロ | 低 | **削除可** |
| `archive/2025-08-10_unused/EditableProjectCard.tsx` | 旧コンポーネント（archive 日付付き） | ✓ 参照ゼロ | 低 | **削除可** |
| `archive/2025-08-10_unused/ProjectBlock.tsx` | 旧コンポーネント（archive 日付付き） | ✓ 参照ゼロ | 低 | **削除可** |
| `archive/2025-08-10_unused/utils/supabase.ts` | 旧 Supabase ユーティル（archive 日付付き） | ✓ 参照ゼロ | 低 | **削除可** |
| `utils/supabase/strategy.ts.bak` | バックアップファイル（.bak）| ✓ 参照ゼロ | 低 | **削除可** |
| `package.json.bak` | バックアップファイル（.bak） | ✓ 参照ゼロ | 低 | **削除可** |
| `package.json.tmp` | 一時ファイル（.tmp） | ✓ 参照ゼロ | 低 | **削除可** |
| `tmpclaude-*-cwd` (50+ files) | Claude Code の一時作業ディレクトリ | ✓ 参照ゼロ | 低 | **削除可** |
| `growth-project-structure.txt` | 旧プロジェクト構造ドキュメント（重複） | ✓ 参照ゼロ | 低 | **削除可** |
| `DEBUG_GUARD_CHANGES.md` | デバッグ用ドキュメント（一時的） | ✓ 参照ゼロ | 低 | **削除可** |

**合計: 11 ファイル/グループ** → 約 60+ ファイル相当の容量削減

---

### 【カテゴリ: 要注意（CAUTION）】API/ルーティング関連

| ファイル | 理由 | 参照確認状況 | リスク | 推奨 |
|---|---|---|---|---|
| `app/api/debug/strategy/route.ts` | デバッグエンドポイント（/api/debug/*） | ✓ 参照ゼロ（開発用） | **中** | 開発環境で保持、本番環境では削除検討 |
| `app/api/generate-projects-only/route.ts` | API エンドポイント（参照なし）| ✓ 参照ゼロ（ドキュメント記載のみ）| **中** | 仕様確認後に削除検討 |
| `app/stage3/page.tsx` | リダイレクト専用ページ（/cascade へ） | ✓ リダイレクトのみ | **中** | 削除可だが、後方互換性確保後 |

**理由**: Next.js App Router のルーティングファイルは、参照がなくても削除は慎重に対応が必要です。
**実施前チェック**:
- [ ] 本番環境の URL パターンで使用されていないか確認
- [ ] `router.push()` や `Link` での文字列参照をより詳細に検索
- [ ] 初期リンクやブックマークから直接アクセスされないか確認
- [ ] `next/navigation` での動的ルーティング参照確認

---

### 【カテゴリ: 削除不可（DO NOT DELETE）】

| ファイル/ディレクトリ | 理由 | 現在の使用状況 |
|---|---|---|
| `app/stage1/page.tsx` | 現在開発中のステージ | ✓ 使用中（データ取込ステージ） |
| `app/stage2/page.tsx` | ストラテジー生成ステージ | ✓ 使用中（fetch 呼び出し確認） |
| `app/stage4/page.tsx` | 動的ステージ | ✓ 使用中（strategyStore で参照） |
| `app/stage6/page.tsx` | シミュレーション（現在修正中） | ✓ 使用中（hydration 修正対象） |
| `app/okr/page.tsx` (141K) | OKR 管理ページ | ✓ 使用中（主要ページ） |
| `app/cascade/page.tsx` (128K) | カスケードページ | ✓ 使用中（stage3 リダイレクト先） |
| `app/api/stage1/import/route.ts` | STAGE1 データインポート | ✓ 使用中（fetch 呼び出し確認） |
| `app/api/stage2/generate-*` (2 routes) | STAGE2 生成エンドポイント | ✓ 使用中（fetch 呼び出し確認） |
| `app/api/generate-*/route.ts` (14+ routes) | AI 生成エンドポイント | ✓ 使用中（複数 fetch 呼び出し） |
| `store/strategyStore.ts` (74K) | グローバルストア | ✓ 使用中（core store） |
| `types/strategy.ts` (42K) | 型定義 | ✓ 使用中（主要型） |
| `lib/supabase/*` | Supabase 統合 | ✓ 使用中（認証・DB） |
| `utils/supabase/*` | Supabase ユーティル | ✓ 使用中（DB 操作） |

---

## 🔍 詳細分析結果

### 1. Archive ディレクトリ分析

**位置**: `archive/2025-08-10_unused/`
**発見**: 5 ファイル + 1 ディレクトリ

```
archive/2025-08-10_unused/
├── AddProjectForm.tsx          # 未使用コンポーネント
├── DepartmentBlock.tsx         # 未使用コンポーネント
├── EditableProjectCard.tsx     # 未使用コンポーネント
├── ProjectBlock.tsx            # 未使用コンポーネント
└── utils/
    └── supabase.ts             # 旧 Supabase 実装
```

**分析**: 2025-08-10 時点で削除されたコンポーネントが保管されているもの。
**リスク評価**: **低（削除可能）**

---

### 2. バックアップ/一時ファイル分析

| ファイル | サイズ | 作成推定時期 | 理由 |
|---|---|---|---|
| `utils/supabase/strategy.ts.bak` | ~2KB | 最近 | 修正バックアップ |
| `package.json.bak` | ~1.8KB | 最近 | 依存性修正バックアップ |
| `package.json.tmp` | ~1.8KB | 最近 | 一時ファイル |
| `tmpclaude-0d6d-cwd` (50+ 同様) | 各数KB | セッション用 | Claude Code 作業ディレクトリ |

**分析**: すべてバージョン管理対象外(.gitignore に入れるべき)。
**リスク評価**: **低（削除可能）**

---

### 3. Stage ページ分析

| Stage | ページ | サイズ | 実装状況 | 削除可否 |
|---|---|---|---|---|
| **STAGE1** | `app/stage1/page.tsx` | 2.2K | ✓ 完全実装 | ✗ 削除不可 |
| **STAGE2** | `app/stage2/page.tsx` | 58K | ✓ 完全実装 | ✗ 削除不可 |
| **STAGE3** | `app/stage3/page.tsx` | 767B | ⚠️ リダイレクトのみ | △ 慎重に判断 |
| **STAGE4** | `app/stage4/page.tsx` | 22K | ✓ 完全実装 | ✗ 削除不可 |
| **STAGE5** | - | - | ✗ 存在しない | N/A |
| **STAGE6** | `app/stage6/page.tsx` | 52K | ✓ 実装中（修正中） | ✗ 削除不可 |

**STAGE3 詳細分析**:
```typescript
// /app/stage3/page.tsx
useEffect(() => {
  router.replace('/cascade');  // /cascade にリダイレクト
}, [router]);
```
- **現状**: リダイレクト専用ページ
- **用途**: 旧 STAGE3 URL 互換性維持用？
- **削除可否**: 外部リンクで /stage3 が参照されていなければ削除可能
- **確認項目**:
  - [ ] ドキュメントの /stage3 参照確認
  - [ ] 初期 UI フロー（sidebar, nav）での使用確認
  - [ ] SEO / sitemap.xml での参照確認

---

### 4. API エンドポイント分析

**合計**: 30+ API ルート

#### ✓ 使用中（削除不可）

| API | 呼び出し元 | 用途 |
|---|---|---|
| `/api/stage1/import` | `components/stage1/DocumentImportPanel.tsx` | データ取込 |
| `/api/stage2/generate-draft` | `app/stage2/page.tsx` | ドラフト生成 |
| `/api/stage2/generate-final` | `app/stage2/page.tsx` | 最終生成 |
| `/api/generate-insight` | `components/insight/CoreInsightPanel.tsx` | インサイト生成 |
| `/api/generate-question` | `components/guide/QuestionStepper.tsx`, その他 | 質問生成 |
| `/api/generate-story-draft` | `app/story-process/page.tsx` | ストーリー下書き |
| `/api/generate-cascade` | `app/cascade/page.tsx` | カスケード生成 |
| `/api/market/pbr` | `components/stage1/MetricsPanel.tsx` | 企業指標取得 |
| その他 13+ | 複数 | 各種生成・推奨機能 |

**削除不可**: すべて本番機能で使用中

#### ⚠️ 要確認（参照なし）

| API | 参照状況 | リスク |
|---|---|---|
| `/api/generate-projects-only` | ✗ 参照ゼロ | 仕様書に記載あり、実装未了の可能性 |
| `/api/debug/strategy` | ✗ 参照ゼロ | デバッグ用エンドポイント |

**推奨**: 仕様確認後に検討。現在は開発環境での有用性を考慮し保持推奨

---

### 5. 重複ドキュメント分析

| ファイル | 発見位置 | 理由 | リスク |
|---|---|---|---|
| `growth-project-structure.txt` | プロジェクトルート | `growth-project-map.md` との重複 | 低 |
| `DEBUG_GUARD_CHANGES.md` | プロジェクトルート | 一時的なデバッグドキュメント | 低 |

**推奨**: 削除可能（ただし内容確認後）

---

## 📊 サマリー

### 🟢 即座に削除可能（低リスク）

```
安全な削除対象:
- archive/2025-08-10_unused/  (5 files + utils/)
- utils/supabase/strategy.ts.bak
- package.json.bak / .tmp
- tmpclaude-*-cwd (50+ files)
- growth-project-structure.txt
- DEBUG_GUARD_CHANGES.md

推定容量: 60+ ファイル / 150~200 KB
```

### 🟡 慎重に検討（中リスク）

```
条件付き削除対象:
- app/api/debug/strategy/route.ts
  → 開発環境では保持、本番環境では削除検討

- app/api/generate-projects-only/route.ts
  → 仕様確認後に削除検討

- app/stage3/page.tsx
  → 後方互換性確保後に削除検討
```

### 🔴 削除不可（使用中）

```
- すべての Stage ページ（stage1, stage2, stage4, stage6）
- すべての main API エンドポイント（14+ routes）
- Supabase 統計・データベース関連（lib/supabase/*, utils/supabase/*）
- 状態管理（store/strategyStore.ts）
- 型定義（types/*.ts）
```

---

## ✅ 削除前の前提条件チェックリスト

削除に進む前に、以下を必ず確認してください：

### ステップ 1: ローカル環境確認

- [ ] 現在のブランチを確認: `git branch` → `fix/stage6-not-hydrated` であることを確認
- [ ] ステージングを確認: `git status` → 未コミットの変更がないことを確認
- [ ] 最新コミットログ確認: `git log --oneline -10` → 最近の修正内容を確認

### ステップ 2: ビルド・型チェック確認

- [ ] 型チェック実行: `npm run type-check` または `tsc --noEmit`
  - → **エラーなし**を確認
- [ ] 開発サーバー起動: `npm run dev`
  - → localhost:3000 で起動確認
- [ ] 本番ビルド確認: `npm run build`
  - → **ビルド成功**を確認

### ステップ 3: 主要導線の手動確認

- [ ] STAGE1 ページアクセス: `/stage1` → 正常表示確認
- [ ] STAGE2 ページアクセス: `/stage2` → 正常表示確認
- [ ] STAGE3 ページアクセス: `/stage3` → `/cascade` にリダイレクト確認
- [ ] OKR ページアクセス: `/okr` → 正常表示確認
- [ ] カスケード ページアクセス: `/cascade` → 正常表示確認
- [ ] STAGE6 ページアクセス: `/stage6` → 現在修正中の内容が保持されていることを確認
- [ ] ログイン/ログアウト: 認証フロー正常確認
- [ ] API エンドポイント呼び出し: 開発者ツール (F12) ネットワークタブで確認
  - `/api/stage1/import`, `/api/stage2/generate-*`, `/api/generate-*` が正常にレスポンス

### ステップ 4: 参照先の最終確認

- [ ] `archive/2025-08-10_unused/*` への参照確認:
  ```bash
  grep -r "archive/2025-08-10_unused" --include="*.ts" --include="*.tsx"
  ```
  → **参照ゼロ**を確認

- [ ] `tmpclaude-*` への参照確認:
  ```bash
  grep -r "tmpclaude" --include="*.ts" --include="*.tsx"
  ```
  → **参照ゼロ**を確認

### ステップ 5: バックアップ取得

- [ ] 削除前にブランチのバックアップを作成:
  ```bash
  git checkout -b backup/before-cleanup
  git checkout fix/stage6-not-hydrated
  ```

### ステップ 6: 段階的な削除

- [ ] **第 1 段階**: 安全グループの削除（archive, .bak, .tmp, tmpclaude-*）
  ```bash
  git rm -r archive/2025-08-10_unused/
  git rm utils/supabase/strategy.ts.bak
  git rm package.json.bak package.json.tmp
  git rm tmpclaude-*-cwd
  git rm growth-project-structure.txt
  ```

- [ ] 第 1 段階後に再ビルド・テスト:
  ```bash
  npm install
  npm run build
  npm run dev
  ```
  → **すべて成功**を確認

- [ ] 第 2 段階（慎重に）: API エンドポイント・Stage3 の検討
  - 仕様書を再確認してから判断

---

## 📝 その他の改善提案

### 1. 大規模ファイルの分割推奨

以下のファイルは 50KB 以上で、コンポーネント分割が推奨されます：

```
- app/okr/page.tsx             (141K)  → pages/components に分割
- app/cascade/page.tsx         (128K)  → pages/components に分割
- app/story-process/page.tsx    (59K)  → pages/components に分割
- store/strategyStore.ts        (74K)  → 複数の店舗に分割検討
- types/strategy.ts             (42K)  → サブタイプ定義に分割検討
```

### 2. .gitignore の確認・改善

以下をプロジェクトの `.gitignore` に追加:

```
# Backup files
*.bak
*.tmp

# Claude Code session directories
tmpclaude-*-cwd

# Build artifacts
.next/
dist/
build/
```

### 3. 環境別 API エンドポイント管理

`app/api/debug/` のようなデバッグエンドポイントは、環境別に有効/無効を切り替える仕組みを推奨:

```typescript
// Example: app/api/debug/strategy/route.ts
if (process.env.NODE_ENV !== 'development') {
  return new Response('Not Found', { status: 404 });
}
```

---

## 🔗 参考資料

- **Next.js App Router**: https://nextjs.org/docs/app
- **Zustand**: https://github.com/pmndrs/zustand
- **Supabase**: https://supabase.com/docs

---

**最終更新**: 2025-01-19
**調査者**: Claude Code
**ステータス**: 調査完了 ⏸️ 削除待ち
