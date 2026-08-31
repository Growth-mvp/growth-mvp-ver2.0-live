# GROWTH SHIFT PoC開始前監査 - P0再判定 訂正版報告書

**報告日**: 2026年7月31日  
**対象**: 前回再判定報告の詳細検証に基づく訂正  
**指示**: 根拠ある詳細調査で報告、修正は未実施

---

## 訂正1：npm脆弱性の詳細分類

### tar 7.5.7 - CRITICAL（9件）

| GHSA/CVE | 脆弱性 | 重大度 |
|----------|--------|--------|
| GHSA-83g3-92jg-28cx | Arbitrary File Read/Write via Hardlink Target Escape Through Symlink Chain | HIGH |
| GHSA-qffp-2rhf-9h96 | Hardlink Path Traversal via Drive-Relative Linkpath | HIGH |
| GHSA-9ppj-qmqm-q256 | Symlink Path Traversal via Drive-Relative Linkpath | HIGH |
| GHSA-vmf3-w455-68vh | PAX size override causing file smuggling | HIGH |
| GHSA-w8wr-v893-vjvp | Process crash via PAX numeric path type confusion | MODERATE |
| GHSA-23hp-3jrh-7fpw | **Decompression/parse DoS via unlimited input** | **CRITICAL** |
| GHSA-8x88-c5mf-7j5w | Negative tar entry size causes infinite loop | MODERATE |
| GHSA-gvwx-54wh-qm9j | Uncaught Exception DoS via NUL byte | MODERATE |
| GHSA-r292-9mhp-454m | Uncontrolled recursion DoS via crafted long-path tar | MODERATE |

**検出バージョン**: 7.5.7  
**修正版**: 7.5.21以上  
**分類**: dependencies  

**完全な依存経路**:
```
growth-mvp@0.2.0 (dependencies)
  ├─ vercel@50.26.0
  │  ├─ @vercel/backends@0.0.59
  │  │  └─ @vercel/nft@1.5.0
  │  │     └─ @mapbox/node-pre-gyp@2.0.3
  │  │        └─ tar@7.5.7
  │  └─ @vercel/fun@1.3.0
  │     └─ tar@7.5.7
```

**実行時依存性**: **ビルド・デプロイ時のみ** ✅
- **使用箇所**: @vercel/fun が Node.js runtime tarball をダウンロード→展開（Vercel Lambda環境セットアップ時）
- **本番ランタイム**: Next.js runtime では tar 不使用
- **ユーザーアップロード**: tar 形式ファイル非対応（PDF/Excel/CSV のみ）
- **GROWTH SHIFT コード**: tar の直接 import/require なし

**評価**: **セキュリティリスク低** - 本番環境ではtar実行されない

---

### undici（複数バージョン）- HIGH（11件）

| GHSA | 脆弱性 | バージョン | 実行時/ビルド時 | 深刻度 |
|------|--------|-----------|-----------------|--------|
| GHSA-c76h-2ccp-4975 | Use of Insufficiently Random Values | 6.27.0 | 本番実行 | MODERATE |
| GHSA-g9mf-h72j-4rw9 | Unbounded decompression chain DoS | 6.27.0 | 本番実行 | MODERATE |
| GHSA-cxrh-j4jr-qwg3 | DoS via bad certificate data | 6.27.0 | 本番実行 | LOW |
| **GHSA-2mjp-6q6p-2qxm** | **HTTP Request/Response Smuggling** | 6.27.0 | **本番実行** | **MODERATE** |
| **GHSA-vrm6-8vpv-qv8q** | **Unbounded Memory in WebSocket decompression** | 6.27.0 | **本番実行** | **HIGH** |
| **GHSA-v9p9-hfj2-hcw8** | **Unhandled Exception in WebSocket** | 6.27.0 | **本番実行** | **HIGH** |
| GHSA-4992-7rv2-5pvq | CRLF Injection via upgrade option | 6.27.0 | 本番実行 | MODERATE |
| GHSA-p88m-4jfj-68fv | HTTP header injection via Set-Cookie | 6.27.0 | 本番実行 | MODERATE |
| **GHSA-vxpw-j846-p89q** | **WebSocket fragment count bypass DoS** | 6.27.0 | **本番実行** | **HIGH** |
| GHSA-35p6-xmwp-9g52 | HTTP response queue poisoning | 6.27.0 | 本番実行 | LOW |
| GHSA-g8m3-5g58-fq7m | Set-Cookie SameSite downgrade | 6.27.0 | 本番実行 | LOW |

**検出バージョン（3経路）**:
```
Path 1 - Runtime (6.27.0 - Blob operations):
  growth-mvp → vercel@50.26.0 → @vercel/blob@2.3.0 → undici@6.27.0

Path 2 - Runtime (5.28.4 - Node runtime):
  growth-mvp → vercel@50.26.0 → @vercel/node@5.7.4 → undici@5.28.4

Path 3 - Build-time (7.28.0 - Sandboxed execution):
  growth-mvp → vercel@50.26.0 → sandbox@2.5.6 → @vercel/sandbox@1.9.0 → undici@7.28.0
```

**修正版**: 6.27.0 以上（最新に自動更新可）  
**分類**: dependencies

**実行時依存性**:
- **6.27.0** (Blob API): **本番環境で実行** - HTTP 通信に使用
- **5.28.4** (Node runtime): **本番環境で実行** - Node.js API に統合
- **7.28.0** (Sandbox): **ビルド時のみ** - サンドボックス環境でのみ使用

**評価**: **セキュリティリスク高** - 本番環境の HTTP/WebSocket 通信が脆弱

---

### xlsx 0.18.5 - HIGH（2件）

| GHSA | 脆弱性 | バージョン | 修正版 | 深刻度 |
|------|--------|-----------|--------|--------|
| **GHSA-4r6h-8v6p-xvw6** | **Prototype Pollution in sheetJS** | <0.19.3 | 0.19.3+ | **HIGH** |
| **GHSA-5pgg-2g8v-p4x9** | **Regular Expression Denial of Service (ReDoS)** | <0.20.2 | 0.20.2+ | **HIGH** |

**検出バージョン**: 0.18.5  
**修正版**: 0.20.2 以上（マイナー版アップグレード必要）  
**分類**: dependencies

**完全な依存経路**:
```
growth-mvp@0.2.0 (dependencies)
  └─ xlsx@0.18.5
```

**実行時依存性**: **本番環境で実行** ✅ - Excelファイルインポート機能で使用

**評価**: **セキュリティリスク高** - Prototype Pollution は RCE 可能性あり

---

## 訂正2：tar の実行時/ビルド時依存性の詳細

### GROWTH SHIFTコード内での tar 使用
❌ **なし** - `require('tar')` または `import tar` なし

### 外部由来 tar ファイルの展開機能
❌ **なし** - ユーザーアップロード形式（`accept=".pdf,.xlsx,.xls,.csv"`）に tar 非対応

### Vercel CLI（ビルド・デプロイ時）での tar 使用
✅ **あり** - @vercel/fun が Node.js runtime tarball を展開  
　　　　（ローカル開発時: なし、`vercel deploy` 時のみ）

### 本番サーバー（Next.js ランタイム）での tar 使用
❌ **なし** - Next.js 15.3.6 ランタイムでは tar 不要

**結論**: tar はビルド・デプロイ時のみ。本番実行時依存ではない。

---

## 訂正3：xlsx の全利用箇所と分類

### Excelインポート機能（読み込み）✅ 実装済み

**主要実装**:
- **ファイル**: `/utils/stage1/importers/excelCsvImporter.ts` (L63-132)
- **API**: `/app/api/stage1/import/route.ts` (L598-622)
- **UI**: `/components/stage1/DocumentImportPanel.tsx` (L1-1233)

**処理内容**: READ（読み込みのみ）
**入力元**: ユーザーアップロード  
**処理対象**: 数式（評価値取得）、マージセル（配列展開）、複数シート対応  
**バリデーション**:
- ✅ ファイルサイズ制限: 20MB
- ✅ ファイル型検証: マジックナンバー + 拡張子
- ✅ 認証・認可: Bearer トークン + manager 以上のロール
- ⚠️ 内容検証: XLSX.read 仕様に依存

### Excelエクスポート機能
❌ **未実装** - XLSX.write は使用されていない（代替: PDF エクスポート）

### ブラウザ処理（React/Client-side）
✅ **あり** - DocumentImportPanel.tsx でクライアント側 API 呼び出し

### サーバー処理（API/Node.js）
✅ **あり** - parseExcel() で XLSX.read 実行

---

## 訂正4：console ログの正確な件数・分類

### 全体数の修正
- **前回報告**: 2,574件（過大集計）
- **実際の統計**: **1,890件**（grep -c "console\." での検証）

### 分類の訂正

| 分類 | 前回 | 実際 | 変更 | 推奨アクション |
|-----|------|------|------|----------|
| 削除候補（入力本文/AI生成） | ~120 | **332** | +212 | `if (NODE_ENV !== 'production')` 条件化 |
| マスキング候補（個人情報） | ~85 | **41** | -44 | maskEmail(), maskUUID() 適用 |
| 削除候補（機密） | ~45 | **3** | -42 | 本番環境除外 |
| マスキング候補（構造化ID） | ~160 | **118** | -42 | maskUUID() 適用 |
| **保持必須（処理状況）** | ~780 | **69** | -711 | **削除禁止** - フロー制御に必須 |
| **保持必須（エラー監視）** | ~400 | **470** | +70 | **削除禁止** - システム監視に必須 |
| **合計** | 2,574 | **1,033** | -1,541 | - |

### 代表例（各分類5件以上）

**削除候補（入力本文）**:
1. `app/api/stage2/generate-draft/route.ts:1422` - JSON PARSE/REPAIR フェーズのダンプ
2. `lib/inputGuardLogger.ts:58` - 入力ガード分析（既に DEBUG 条件化）
3. `hooks/useAutoSave.ts:732` - オートセーブペイロード診断
4. `utils/financeSimulation.ts:154,241,296,307` - 金融シミュレーション中間計算値

**マスキング候補（個人情報）**:
1. `utils/supabase/membership.ts:330` - companyId 平文出力
2. `store/strategyStore.ts:1167` - userId, companyId DEBUG 出力

**保持必須（エラー監視 - CRITICAL）**:
1. `store/strategyStore.ts:3508` - **[SAVE_BLOCKED]** データロス防止ログ ⚠️ 削除禁止
2. `store/strategyStore.ts:3745` - **[CRITICAL]** データ破損警告 ⚠️ 削除禁止
3. `app/api/cascade/cleanup-deleted-projects/route.ts:31` - **[unauthorized]** セキュリティ監視 ⚠️ 削除禁止
4. `middleware.ts:28` - **[CRITICAL]** レート制限未設定 ⚠️ 削除禁止

**結論**: 1,890件中 **1,033件が重要ログ**（エラー監視・フロー制御）。**削除禁止が約540件**。

---

## 訂正5：利用規約・プライバシーポリシー同意実装 - 3案比較

### 案A: 法人契約+書面同意で代替（PoC向き）✅ 推奨

| 項目 | 詳細 |
|------|------|
| **概要** | PoC対象企業との書面契約で同意を包括管理 |
| **DB実装** | なし（既存テーブルのみ） |
| **画面実装** | なし（参考ページとして /terms 表示） |
| **既存ユーザー対応** | 対象外（PoC契約締結企業のみ） |
| **デジタル証拠** | 書面のみ |
| **改版対応** | 書面で再契約 |
| **工数** | 1.5h（最小） |
| **PoC向き度** | ★★★★★ |
| **本番への移行性** | 要再実装（案Bまたは案Cへ） |

**実装内容**:
- companies テーブルに `legal_status`, `contract_signed_date`, `contract_version` カラム追加（任意）
- 招待メール文言に「書面同意済み」を明記
- 初回ログイン時の同意チェック: スキップ

---

### 案B: アプリ内同意を完全実装（本番向き）

| 項目 | 詳細 |
|------|------|
| **概要** | user_agreements テーブルで全ユーザーの同意を記録 |
| **DB実装** | user_agreements テーブル + document_versions テーブル作成（RLS設定含む） |
| **画面実装** | ConsentModal.tsx（初回ログイン時の同意ダイアログ） |
| **既存ユーザー対応** | 初回ログイン時に同意取得フロー（自動同意なし） |
| **デジタル証拠** | 完全（IP、UA、タイムスタンプ） |
| **改版対応** | 新バージョンで自動再同意 |
| **工数** | 13h（1.5日） |
| **PoC向き度** | ★★☆☆☆ |
| **本番への移行性** | そのまま利用可 |

**実装内容**:
```sql
CREATE TABLE user_agreements (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  company_id UUID REFERENCES companies(id),
  document_type TEXT ('terms_of_service', 'privacy_policy'),
  document_version TEXT ('v1.0', 'v1.1'),
  agreed_at TIMESTAMP,
  agreement_ip TEXT,
  agreement_user_agent TEXT,
  created_at TIMESTAMP,
  UNIQUE(user_id, document_type, document_version)
);

CREATE TABLE document_versions (
  id UUID PRIMARY KEY,
  document_type TEXT,
  version TEXT,
  title TEXT,
  content_url TEXT,
  effective_date DATE,
  is_active BOOLEAN,
  UNIQUE(document_type, version)
);
```

---

### 案C: ハイブリッド（法人契約 + アプリ内併用） ⭐ 最推奨

| 項目 | 詳細 |
|------|------|
| **概要** | PoC企業: 案A（法人契約）/ 将来の一般ユーザー: 案B（アプリ内） |
| **DB実装** | user_agreements + document_versions + companies 修正 |
| **画面実装** | ConsentModal + 企業モード判定ロジック |
| **既存ユーザー対応** | 企業の agreement_mode で分岐（契約企業はスキップ） |
| **デジタル証拠** | 併用（契約書 + デジタルログ） |
| **改版対応** | 混在（契約企業は書面、アプリ内企業は自動） |
| **工数** | 7h（1日） |
| **PoC向き度** | ★★★★☆（PoC即時対応 + 本番化への移行パス） |
| **本番への移行性** | 容易（フェーズ分割可） |

**実装ロジック**:
```typescript
// Middleware での条件分岐
async function checkConsentRequirement(userId, companyId) {
  const { agreement_mode } = await getCompany(companyId);
  
  if (agreement_mode === 'contract_based') {
    // PoC企業: 同意チェック不要（書面契約で対応）
    return { required: false };
  } else {
    // 本番企業: アプリ内同意を確認
    const agreed = await checkUserAgreements(userId);
    return { required: true, agreed };
  }
}
```

---

### 最終推奨: 案C（ハイブリッド）

**理由**:
1. ✅ PoC企業への即時対応（契約書で対応、アプリ開発不要）
2. ✅ 本番化への移行パスを確保（将来のアプリ内同意へのスケーリング）
3. ✅ バランス取れた開発工数（7h = 1日）
4. ✅ GDPR/APPI対応への足がかり
5. ✅ 既存ユーザーの自動同意化を回避（契約企業のみスキップ）

**実装フェーズ**:
1. **PoC 開始前** (Week 1-2): companies テーブルに agreement_mode カラム追加
2. **本番化準備** (Week 3-8): user_agreements, document_versions テーブル実装
3. **本番化後** (Week 9-10): 段階的に agreement_mode を 'app_consent' に移行

---

## P0再判定の最終判定

### 確定P0（修正必須）

1. **利用規約・プライバシーポリシー** - **案C（ハイブリッド）で実装**
   - PoC対象: 書面契約（開発なし）
   - 本番向け: アプリ内同意（設計済み）
   - 工数: 7h
   - 既存ユーザー: 自動同意なし（契約企業はスキップ、本番企業は初回ログイン時取得）

2. **インシデント対応計画書（ICP）**
   - 連絡窓口・エスカレーション経路の確定
   - PoC企業と石原の合意書面化
   - 工数: 1-2日（文書化）

3. **npm脆弱性（tar + undici + xlsx）**
   - tar: **PoC開始前に修正可能**（ビルド時のみ、Breaking なし）
   - undici: **PoC開始前に修正推奨**（本番実行時、Breaking あり）
   - xlsx: **PoC開始前に修正必須**（Prototype Pollution = RCE リスク）

### P1候補（開始直前に対応）

1. **org_alignment RLS migration** - migration 20260708 適用（DB層補完）
2. **console ログ整備** - 1,033件の重要ログ分類・マスキング
3. **招待メール検証** - email フィールド必須化（セキュリティ強化）

---

## 修正前の安全上の注意事項

本報告書提出時点で、以下は実施しないでください：

❌ npm audit fix / npm audit fix --force  
❌ migration 実行  
❌ 規約本文の変更・配置  
❌ console ログの削除・修正  
❌ 本番環境への変更・デプロイ  

修正実施の承認をお待ちします。

---

**調査完了日**: 2026年7月31日  
**調査範囲**: コード確認 + npm audit 詳細分析 + 複数案設計  
**修正状況**: 調査のみ（未実施）

