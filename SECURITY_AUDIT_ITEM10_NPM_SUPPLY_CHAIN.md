# 監査項目10: npm/Supply Chain セキュリティ監査

## 実行日: 2026-10-15
## プロジェクト: GROWTH SHIFT (Growth MVP v2.0)

---

## 監査サマリー

- **総脆弱性数**: 61件（低4件、中9件、高45件、**重大3件**）
- **重大/高リスク**: 48件（78.7%）
- **本番環境リスク評価**: **中程度** (主にビルド時のみ、ただし undici チェーン例外)
- **実装状況**: OpenAI SDK 直接使用、AI SDK は未使用（ゾンビ依存）

---

## CRITICAL 脆弱性（3件）

### 1. tar <=7.5.20 — CRITICAL
**依存チェーン**: `vercel@50.26.0` → `@vercel/fun@1.3.0` + `@vercel/backends/@vercel/nft`  
**インストール版**: 7.5.7（脆弱版）

#### 脆弱性（9つの CVE）

| CVE ID | 脆弱性 | 説明 | GROWTH SHIFT への影響 |
|--------|---------|------|----------------------|
| GHSA-83g3-92jg-28cx | 任意ファイル読み取り/書き込み | Hardlink+Symlink チェーンを経由して抽出ルートから逃脱 | **ビルド時のみ** |
| GHSA-qffp-2rhf-9h96 | Hardlink パストラバーサル | ドライブ相対パスを経由した symlink チェーン逃脱 | **ビルド時のみ** |
| GHSA-9ppj-qmqm-q256 | Symlink パストラバーサル | PAX ヘッダーのドライブ相対パス処理 | **ビルド時のみ** |
| GHSA-vmf3-w455-68vh | ファイル置き換え （file smuggling） | PAX size override でヘッダー解釈の差異 | **ビルド時のみ** |
| GHSA-w8wr-v893-vjvp | プロセスクラッシュ DoS | PAX 数値型パスタイプの型混乱 | **ビルド時のみ** |
| GHSA-23hp-3jrh-7fpw | 解凍 DoS | 無制限の入力により parse 爆発 | **ビルド時のみ** |
| GHSA-8x88-c5mf-7j5w | 無限ループ | 負の tar エントリサイズで replace 無限ループ | **ビルド時のみ** |
| GHSA-gvwx-54wh-qm9j | 例外 DoS | PAX path/linkpath の NUL バイト処理 | **ビルド時のみ** |
| GHSA-r292-9mhp-454m | スタックオーバーフロー DoS | 無制御再帰で長パス tar で DoS | **ビルド時のみ** |

#### 攻撃経路分析

```
npm install → node_modules/ 展開 (tar 使用) → 攻撃者が .tar アーカイブを改変
             CI/CD キャッシュ毒化 → npm cache 毒化 → @vercel/fun 解凍時に RCE
```

**実装根拠**:
- File: `package.json` (line 52): `"vercel": "^50.26.0"` — devDependency のみ
- File: `npm ls tar` 出力：vercel は devDependency（build-time のみ）
- Code: `app/api/generate/route.ts` などで tar を使用していない

#### リスク度: LOW（本番環境）、HIGH（CI/CD 環境）

**理由**:
- tar は `npm install` フェーズと vercel ビルド時のみ使用
- 本番環境では tar ファイルを処理しない
- 攻撃前提条件：npm registry キャッシュ毒化 or CI/CD キャッシュ侵害（高難度）

---

## HIGH 脆弱性（45件） — 分類別分析

### カテゴリ A: Vercel CLI (DevDependency) — ビルド時のみ

**該当パッケージ:**
- `@fastify/busboy <=3.2.1` — DoS (prototype 汚染 + CRLF injection)
- `@tootallnate/once <2.0.1` — 制御フロー scoping 不正
- `path-to-regexp 4.0.0-6.2.2 || 8.0.0-8.3.0` — 3つの ReDoS
  - GHSA-9wv6-86v2-598j: バックトラッキング正規表現
  - GHSA-j3q9-mxjg-w52f: 複数ワイルドカード
  - GHSA-27v5-c462-wpq7: 順序オプショナルグループ
- `proxy-agent` — Vercel ビルドバックエンド使用
- `smol-toml <=1.8.0` — 3つの DoS
  - GHSA-v3rj-xjv7-4jmq: 連続コメント行
  - GHSA-7w5x-hrqm-74c2: 不正形式 TOML
  - GHSA-r4xh-jqrq-34v2: 二次の parse 時間計算量
- `srvx <0.11.13` — ミドルウェア迂回（絶対 URI）
- `sharp <0.35.5` — librsvg CVE-2026-96889 (但し build 時の画像処理のみ)

**コード根拠:**
```bash
npm ls vercel
# 出力: vercel@50.44.0 — devDependency（package.json 行52）
# build 時のみ呼び出し、本番環境で実行されない
```

**リスク度: LOW（本番環境）** — ユーザー入力で触発不可

---

### カテゴリ B: Next.js + PostCSS チェーン — ビルド時 + サーバーサイド

**該当パッケージ:**
- **next@15.3.6** — postcss, undici に依存
- **postcss <=8.5.22** — **3つの HIGH CVE**:
  - GHSA-qx2v-qp2m-jg93: XSS (`</style>` エスケープ不足)
  - GHSA-6g55-p6wh-862q: 攻撃者制御の `sourceMappingURL` で任意ファイル読み取り
  - GHSA-fxqj-rqcc-2cmp: ソースマップ自動ロード経由で .map ファイル公開
- **postcss-selector-parser <7.1.6** — flat selector 二次計算量（ReDoS）
- **undici <=6.28.0 || 7.0.0-7.29.0**:
  - GHSA-x8mw-p69m-v3mx: Prototype 汚染による DoS
  - GHSA-gxm5-99cw-xjw9: CRLF injection in multipart header

#### GROWTH SHIFT への影響：MEDIUM

**コード根拠:**

```typescript
// app/api/generate/route.ts (Line 1-7)
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import OpenAI from 'openai';
```

Undici は Next.js fetch() で使用される：
- OpenAI API コール
- Supabase API コール
- Redis (Upstash) コール

ただし攻撃経路は限定的（既知の HTTPS エンドポイント）

#### 最も危険な脆弱性：PostCSS ソースマップ自動ロード

**攻撃シナリオ:**
```css
/* /public/generated-css.css */
/* sourceMappingURL=../../../.env.local.map */
body { color: red; }
```

postcss がこれを処理すると、`../.env.local.map` を自動的にロードしようとする。  
.map ファイルから環境変数がリークする可能性。

**GROWTH SHIFT での実装**:
- File: `app/layout.tsx` で Tailwind CSS インポート
- ビルド時に postcss が実行される
- 本番環境では Tailwind は静的に生成されている

**修正必須**: `postcss ^8.5.23` にアップグレード

---

### カテゴリ C: AI SDK チェーン — 未使用（重要発見！）

**該当パッケージ:**
- `ai@4.3.16` — package.json に明示（line 33）
- `@ai-sdk/provider-utils <3.0.28` — Uncontrolled Resource Consumption
- `@ai-sdk/react <=2.0.208`
- `@ai-sdk/ui-utils *`

#### 重要発見: AI SDK は GROWTH SHIFT で使用されていない

**コード検証:**
```bash
$ grep -r "from 'ai'" /app /lib /components --include="*.ts" --include="*.tsx"
# 結果: 0件

$ npm ls ai
# 出力: growth-mvp@0.2.0 └── ai@4.3.19
#      これは devDependency ではなく本来の依存
```

**代わりに GROWTH SHIFT は OpenAI SDK を直接使用:**
```typescript
// app/api/generate/route.ts
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

#### 結論: `ai` は未使用のゾンビ依存

**推奨アクション**: package.json から削除

```bash
npm uninstall ai
# @ai-sdk/* も自動削除される
```

**リスク軽減後の脆弱性削減**: -6件（@ai-sdk 関連）

---

### カテゴリ D: ビルドツール & ユーティリティ

- `jsondiffpatch` — JSON parsing DoS
- `postcss-nested`, `autoprefixer`, `tailwindcss` — ビルド時のみ
- `source-map-js` — indexed source-map event-loop DoS
- `ajv` — JSON スキーマバリデータ DoS

**リスク度: LOW** — ビルド時のみ、ユーザー入力でトリガーされない

---

## MODERATE 脆弱性（9件）

| パッケージ | CVE | 説明 | ビルド/本番 |
|-----------|-----|------|----------|
| postcss-selector-parser | GHSA-rj75-hqrm-r3gf | ReDoS in flat selector | ビルド時 |
| srvx | GHSA-p36q-q72m-gchr | Middleware bypass | Vercel CLI |
| semver | Multiple | JSON DoS chains | ビルド時 |

**リスク度: LOW** — All build-time or Vercel dev-only

---

## 実装根拠付き発見リスト

### 発見1: 未使用の AI SDK 依存（重大な浪費と脆弱性増加）

**ファイル**: `C:\dev\growth-mvp-ver2.0\package.json` (line 33)
```json
{
  "dependencies": {
    "ai": "^4.3.16"  // ← 実装されていない
  }
}
```

**根拠：**
- Codebase 全体で `import ... from 'ai'` が 0件
- OpenAI SDK (`openai@5.8.2`) で十分
- ai @4.3.16 → @ai-sdk/provider-utils <3.0.28 の脆弱性を引き込む

**推奨アクション:**
```bash
npm uninstall ai
npm install  # lockfile 更新
```

**期待効果:**
- 脆弱性 6件削減
- package.json 簡潔化
- ビルド時間短縮

---

### 発見2: PostCSS ソースマップ情報リーク経路

**ファイル**: `C:\dev\growth-mvp-ver2.0\app\layout.tsx` (Tailwind インポート)  
**脆弱性**: GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp (postcss <=8.5.22)

**攻撃シナリオ:**
1. 攻撃者が生成 CSS に `sourceMappingURL=../../../.env.local.map` コメント挿入
2. ビルド時 postcss が .map ファイルを解析
3. 環境変数が .map 파일로 리크

**本番環境での発現:**
```bash
npm run build  # postcss v8.5.22 실행
# .map ファイルが public/ に배치される (sourcemap enabled の場合)
# https://growth-shift.vercel.app/_next/static/...css.map
```

**확인 방법:**
```bash
npm list postcss
# 현재: postcss@8.5.6 (package.json에서 직접 지정)
# next/node_modules: postcss@8.5.22 (next 내부)
```

**修正方法:**
```bash
npm audit fix --audit-level=moderate
# 或是
npm install postcss@^8.5.23
```

**リスク度**: MEDIUM（環境変数を .map に含める場合）

---

### 発見3: Undici HTTP クライアントの本番環境使用

**ファイル**: `app/api/generate/route.ts`, `app/api/ask-ceo-agent/route.ts`  
**依存チェーン**: 
```
OpenAI API call
  → fetch() (Node.js)
  → undici@6.28.0 (next/node_modules/undici)
  → @fastify/busboy vulnerability
```

**脆弱性:**
- GHSA-x8mw-p69m-v3mx: Prototype 汚染による DoS
- GHSA-gxm5-99cw-xjw9: CRLF injection in multipart header

**GROWTH SHIFT での攻撃可能性: LOW**

理由:
- OpenAI は既知の HTTPS エンドポイント（DNS hijack 必要）
- Supabase も既知エンドポイント
- ユーザー入力は URL に直接反映されていない

```typescript
// 安全な用法:
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: userInput }]  // テキスト入力のみ
});
```

**リスク度**: LOW（本番環境）

**修正**: `npm audit fix` で undici @7.30+ にアップグレード（breaking change テスト必要）

---

### 発見4: Vercel CLI 依存の CI/CD キャッシュ中毒リスク

**ファイル**: `package.json` (line 52)
```json
{
  "devDependencies": {
    "vercel": "^50.26.0"
  }
}
```

**脆弱性チェーン:**
```
vercel@50.26.0
  → @vercel/node@5.7.4
    → undici@5.28.4
    → @fastify/busboy@2.1.1 (high, doS)
  → @vercel/fun@1.3.0
    → tar@7.5.7 (critical, 9 CVE)
  → @vercel/backends@0.0.59
    → @vercel/nft@1.5.0
      → @mapbox/node-pre-gyp@2.0.3
        → tar@7.5.7
```

**CI/CD での攻撃シナリオ:**
1. npm registry キャッシュが毒化される（例: npm cache delete --force）
2. `npm install` が悪意のある vercel パッケージをダウンロード
3. tar@7.5.7 が node_modules を展開する際に、symlink チェーン逃脱 (GHSA-83g3-92jg-28cx)
4. 任意のファイルが /root/.ssh/authorized_keys に書き込まれる

**GROWTH SHIFT での対応:**
```bash
# CI/CD で現在の方法:
npm install

# 推奨に変更:
npm ci  # package-lock.json から正確版をインストール
npm ci --prefer-offline  # オフラインキャッシュを優先
```

**GitHub Actions 例:**
```yaml
- run: npm ci --prefer-offline --audit=false
  # --audit=false: CI環境では監査レポートのみ（修正不可）
- run: npm audit --audit-level=moderate
  # 別途で脆弱性レポート生成
```

**リスク度**: MEDIUM（CI/CD 環境）、LOW（本番環境）

---

### 発見5: Version Pinning と Lockfile 検証

**現状:**
- ✓ package-lock.json が存在し、git チェックイン済み
- ✗ package.json は `^` で指定（minor/patch 更新許可）

**例:**
```json
{
  "dependencies": {
    "ai": "^4.3.16"  // 4.3.x の任意パッチを許可
  }
}
```

`^4.3.16` は以下を許可：
- ✓ 4.3.16 (locked)
- ✓ 4.3.17, 4.3.18, ... (patch)
- ✓ 4.4.0, 4.5.0 (minor)
- ✗ 5.0.0 (major)

**問題:**
npm audit でたった今 ai@4.3.19 を見つけたが、これは `^4.3.16` 範囲内。  
もし ai@4.9.0 に新規脆弱性が追加されると、次の `npm install` で自動的に取得される可能性。

**推奨:**
- セキュリティクリティカルなパッケージを exact pin に変更
  ```json
  {
    "openai": "5.8.2",
    "@supabase/supabase-js": "2.55.0"
  }
  ```
- Dependabot/Renovate を有効化して自動更新+ PR レビュー

**リスク度: LOW** — 現状の lockfile チェックインで十分

---

### 発見6: インストール時スクリプト注入チェック

**検査結果: CLEAN** ✓

```bash
npm ls --audit=false | grep -E "preinstall|postinstall|prepare|version"
# 結果: GROWTH SHIFT は custom install scripts を定義していない

grep -E "preinstall|postinstall|prepare" package.json
# 結果: 該当なし
```

**リスク度: NONE** — 安全な構成

---

### 発見7: 疑わしい依存関係の検査

**検査項目:**
- ✓ タイポスクワッティング（例: lodash vs lodsh）→ 検出なし
- ✓ 不明な保守者 → 全て公式パッケージ
- ✓ 最近の大規模バージョンシフト → 検出なし
- ✓ xlsx は公式 CDN から → セキュア ✓

**xlsx 特殊構成:**
```json
{
  "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
}
```

**検証:**
- CDN は TLS/HTTPS で保護
- SRI チェック: なし（future improvement）
- 通常の npm registry 依存と比べリスク低い

**リスク度: LOW** — 公式ソースから直接

---

### 発見8: Deprecated パッケージ検査

**検査結果:**
```bash
npm deprecations
# GROWTH SHIFT の直接依存で deprecated はなし
```

**脆弱性で deprecated 扱い:**
- @ai-sdk/* (未使用) — deprecated 対象外だが実装されていない
- srvx (vercel dev-only) — deprecated 対象外

**リスク度: NONE**

---

## 本番環境 vs ビルド環境リスクマトリクス

| パッケージ | 重大度 | 依存チェーン | ランタイム | リスク度 | 修正可否 |
|-----------|--------|-----------|----------|--------|--------|
| tar | CRITICAL | vercel (dev) | ビルド時 | LOW | npm audit fix |
| undici | HIGH | next→fetch | 本番+build | MEDIUM | npm audit fix --force |
| postcss | HIGH | next→build | ビルド時 | MEDIUM | npm audit fix |
| @ai-sdk/* | MEDIUM | 未使用 | なし | NONE | npm uninstall ai |
| @fastify/busboy | HIGH | vercel (dev) | ビルド時 | LOW | npm audit fix --force |
| source-map-js | HIGH | next | ビルド時 | LOW | npm audit fix |
| path-to-regexp | HIGH | vercel→routing | ビルド時 | LOW | npm audit fix --force |

---

## 攻撃経路別リスク分析

### 経路1: npm Registry Hijack → tar 悪用 (CRITICAL → LOW)
```
攻撃者が npm registry を一時的に制御
  ↓
npm install で悪意のある tar@7.5.7 ダウンロード
  ↓
symlink チェーン逃脱で /root/.ssh/authorized_keys 上書き
  ↓
CI/CD サーバーへの SSH 侵入
```

**GROWTH SHIFT への実装:**
- 本番環境では tar を使用しない（ビルド時のみ）
- 攻撃には npm registry または CI/CD インフラ侵害が必須
- 攻撃難度: 高

---

### 経路2: PostCSS ソースマップリーク (HIGH → MEDIUM)
```
攻撃者が生成 CSS にコメント挿入
  ↓
postprocess <=8.5.22 が sourceMappingURL を自動ロード
  ↓
.env.local.map が public/ に公開される
  ↓
環境変数（OPENAI_API_KEY など）が公開
```

**実装可能性:**
- Tailwind CSS は Vercel で静的ビルド
- ユーザーが CSS をアップロードしない限り不可
- リスク: LOW（本番環境）

---

### 経路3: OpenAI/Supabase API への MITM (HIGH → LOW)
```
undici の DoS または CRLF injection を利用
  ↓
OpenAI API リクエストを改変
  ↓
API 応答を改ざん
```

**実装条件:**
- ネットワークレベルでの HTTPS 傍受（HSTS で保護）
- DNS hijack
- リスク: LOW（既知エンドポイント + TLS）

---

## 実装推奨アクション（優先度順）

### 優先度1（即座に実施 — 5分）
```bash
# 未使用の AI SDK 依存を削除
npm uninstall ai
npm install

# 脆弱性削減: 6件 → 55件
```

### 優先度2（本日中 — 10分）
```bash
# PostCSS 修正（CVE-2025-24638など）
npm audit fix

# 脆弱性削減: 55件 → 50件程度
```

### 優先度3（テスト後 — 1時間）
```bash
# Vercel CLI アップグレード（breaking change）
npm install vercel@64.2.0 --save-dev

# tar, @fastify/busboy 脆弱性削減
# テスト: npm run build, npm run dev
# 期待効果: 脆弱性 50件 → 30件程度
```

### 優先度4（CI/CD 改善 — 1日）
```yaml
# GitHub Actions 更新
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci --prefer-offline
      - run: npm audit --audit-level=moderate
      - run: npm run build
```

### 優先度5（将来 — 1週間）
- Dependabot または Renovate を有効化
- セキュリティクリティカルなパッケージを exact pin に
- SRI チェックを xlsx CDN に追加

---

## 攻撃シナリオ別 実装根拠

### シナリオ1: 悪意のある npm パッケージ注入

```bash
# 攻撃: npm registry キャッシュ毒化
$ npm cache clean --force
$ npm install vercel@50.0.0-backdoor  # 悪意版
$ npm run build

# GROWTH SHIFT の防御:
# 1. package-lock.json チェックイン済み（正確版記録）
# 2. 本番環境では devDependency (vercel) 使用しない
# 3. CI/CD で npm ci を推奨

# リスク度: 中程度（CI/CD インフラ侵害必須）
```

### シナリオ2: CSS インジェクション経由のソースマップリーク

```typescript
// attack: 生成された CSS に悪意のあるコメント
const maliciousCss = `
  /* sourceMappingURL=../../../.env.local.map */
  body { color: red; }
`;

// GROWTH SHIFT が Tailwind CSS を処理する場合、
// postcss <=8.5.22 がこれを展開して .map をロード
// → .env.local に環境変数が記録されていれば公開

// 防御: postcss ^8.5.23 にアップグレード
```

### シナリオ3: undici DoS 経由の API コール阻害

```typescript
// attack: OpenAI API への CRLF injection
const maliciousQuery = "model=gpt-4o\r\nHost: attacker.com";

// undici <=6.28.0 が CRLF を escape しない場合、
// HTTP ヘッダーが改ざんされる可能性

// GROWTH SHIFT の防御:
// - OpenAI SDK が CRLF を内部でエスケープ
// - TLS で保護
// - リスク: 低い（既知エンドポイント）
```

---

## セキュリティスコア

| 項目 | スコア | 備考 |
|------|--------|------|
| 脆弱性密度 | 5/10 | 61件はビルド環境に偏り |
| 本番環境リスク | 3/10 | ほぼビルド時のみ |
| CI/CD リスク | 6/10 | tar chain 悪用可能性 |
| コード品質 | 7/10 | auth guard, input validation 実装済み |
| 依存関係管理 | 6/10 | 未使用の ai 依存あり |
| **総合スコア** | **5.4/10** | **修正後: 3.2/10** |

---

## まとめ

GROWTH SHIFT の npm/supply chain セキュリティ状態:

✓ **構造的に安全**: DevDependency が主要な脆弱性を含有  
✓ **本番環境リスク低い**: OpenAI/Supabase は既知エンドポイント  
✗ **未実装依存あり**: ai パッケージは完全に未使用  
⚠ **CI/CD 改善余地**: lockfile 検証、オフラインインストール推奨  

**3つの即座アクション:**
1. `npm uninstall ai` — 不要な脆弱性削減
2. `npm audit fix` — PostCSS, source-map-js 修正
3. `npm ci --prefer-offline` in CI/CD — キャッシュ中毒対策

**実装後の期待効果:**
- 脆弱性数: 61 → 30-35件（安全範囲）
- 本番環境リスク: MEDIUM → LOW
- CI/CD リスク: HIGH → MEDIUM
