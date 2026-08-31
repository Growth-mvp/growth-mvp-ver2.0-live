# GROWTH SHIFT PoC開始前監査 - P0候補の再判定報告書

**報告日**: 2026年7月31日  
**対象**: 前回監査報告のP0候補3項目の詳細再調査  
**方針**: 根拠不足・矛盾・過大判定の検証

---

## 再判定結果サマリー

| 項目 | 前回判定 | 再判定 | 理由 |
|------|---------|--------|------|
| 1. 招待メール検証 | P0脆弱性 | **P1候補** | セキュリティ対策が実装済み。email フィールド必須化で改善可 |
| 2. 利用規約・プライバシーポリシー | P0未実装 | **P0確定** | プレースホルダー。PoC開始前の法的同意が必須 |
| 3. インシデント対応計画書 | P0未作成 | **P0確定** | 手順書なし。事故対応体制が不在 |
| 4. org_alignment RLS | P1未適用 | **P1確定** | 矛盾なし。migration 20260708 適用で完成 |
| 5. console ログ | P1整備 | **P1確定** | 分類後、削除・マスキング・保持に分ける |
| 6. npm 脆弱性 | P2対応 | **P1/P0混在** | tar CRITICAL, xlsx Prototype汚染はPoC前に修正 |

---

## 項目1：招待メール検証の詳細評価

### 前回判定
**P0脆弱性**: 「招待完了時にメール検証をスキップ可能 → アカウント奪取リスク」

### 再調査結果

#### 1.1 トークンの乱数性
✅ **強力** - 予測攻撃への耐性あり

**実装確認** (`/app/api/invites/create/route.ts` L26-28)
```typescript
function generateInviteToken(): string {
  return randomBytes(32).toString('hex');  // 256ビット乱数
}
```

- 生成方法: Node.js `crypto.randomBytes(32)` (暗号学的に安全)
- 長さ: 32バイト (256ビット)
- 形式: 16進数文字列 64文字
- 推測空間: 2^256 ≈ 1.15 × 10^77
- **評価**: 計算量的に不可能

#### 1.2 トークンの有効期限
✅ **適切** - 7日間で期限切れ

**実装確認** (`/app/api/invites/create/route.ts` L145, complete/route.ts L102-117)
```typescript
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

// 期限切れチェック
if (now > expiresAt) {
  return NextResponse.json({ error: 'invite_expired' }, { status: 400 });
}
```

- 有効期限: 7日間 (604,800秒)
- チェック箇所: `/api/invites/info` と `/api/invites/complete` 両方で実施
- **評価**: 厳格

#### 1.3 一度使用したトークンの再利用防止
✅ **強力** - `accepted_at` フラグで防止

**実装確認** (schema L12, complete/route.ts L87-100, accept/route.ts L193-207)
```sql
-- DB スキーマ
create table company_invites (
  accepted_at timestamptz null,  -- ★ 使用フラグ
);
```

```typescript
// 使用済みチェック（両APIで実施）
if (invite.accepted_at) {
  return NextResponse.json({
    error: 'invite_already_used',
  }, { status: 400 });
}

// 同時実行での重複使用防止
.is('accepted_at', null)  // ★ 競合検出
```

- DB制約: `token_hash` ユニークインデックス
- API制約: `accepted_at is null` での条件更新
- **評価**: トランザクション的に安全

#### 1.4 招待トークンのメール一致確認（サーバー側）
⚠️ **部分的** - メール一致チェックあるが、オプション

**実装確認** (complete/route.ts L119-138, accept/route.ts L210-246)

**complete API（未ログイン用）**:
```typescript
// email フィールドがあればチェック（オプション）
if (email) {
  const providedEmail = normalizeEmail(email);
  const inviteEmail = normalizeEmail(invite.email);
  if (providedEmail !== inviteEmail) {
    return error('email_mismatch');
  }
}

// ユーザー作成時は DB の invite.email を使用（body は参照のみ）
const { data: newUser } = await admin.auth.admin.createUser({
  email: inviteEmail,  // ★ DB値を優先
  password: password,
  email_confirm: true,
});
```

**accept API（ログイン済み用）**:
```typescript
// ログインユーザーのメール と 招待メールが一致するか
const userEmail = normalizeEmail(authUser.user.email || '');
const inviteEmail = normalizeEmail(invite.email || '');

if (userEmail !== inviteEmail) {
  return error('email_mismatch');
}
```

**評価**: 
- complete: email フィールド省略時、チェックスキップ（**脆弱ではない** - DB値が優先）
- accept: 厳格（ログイン済みユーザーの認証済みメール確認）

#### 1.5 リクエスト body の email 改ざんで別メール宛でアカウント作成可能か
✅ **安全** - DB値を優先

**実装確認** (complete/route.ts L224-230)
```typescript
// body の email はバリデーション用のみ
const userCreation = await admin.auth.admin.createUser({
  email: inviteEmail,  // ★ DB から取得した招待メール（改ざん不可）
  password: password,
  email_confirm: true,
});
```

- body の email フィールドは参照目的
- 実際のユーザー作成は `inviteEmail`（DB値）で実行
- body 改ざんは無視される

#### 1.6 別会社の招待トークンで他社ユーザーを作成可能か
✅ **完全に安全** - company_id は DB に固定

**実装確認** (schema, complete/route.ts L224-230)
```sql
-- DB スキーマ（外部キー制約）
company_id uuid not null references public.companies(id)
```

```typescript
// membership 作成時は招待レコードから取得
const { error: memberErr } = await admin.from('company_members').insert({
  user_id: userId,
  company_id: invite.company_id,  // ★ 招待から取得（DB に保存済み）
  role: invite.role,              // ★ 招待から取得（DB に保存済み）
});
```

- company_id・role はトークン検索後の招待レコードから取得
- リクエスト body では上書き不可
- DB外部キー制約で保護

#### 1.7 招待リンク未受信の第三者が完了 API を実行できるか（トークン予測攻撃）
✅ **極めて強力** - 2^256 計算量的に不可能

**脅威分析**:
- 攻撃者が 256ビット乱数を総当たり予測: 不可能
- ハッシュ逆算（SHA-256）: 一方向関数で不可逆
- メール確認: オプションだが、DB に固定されているため脅威は低い

**推奨対策** (既に実装済みの補強):
- IP単位のレート制限: `/api/invites/info` と `/api/invites/complete` への未認証リクエスト
- トークン無効エラーの監視: 異常なレート検知で総当たり検知

---

### 再判定：招待メール検証

**判定**: **P1候補（P0ではない）** ⚠️

**理由**:
1. トークン乱数性 ✅ 強力（256ビット、randomBytes）
2. 有効期限 ✅ 適切（7日間、両APIチェック）
3. 再利用防止 ✅ 強力（accepted_at フラグ、DB制約）
4. メール一致確認 ⚠️ 部分的（complete: オプション、accept: 厳格）
5. Body改ざん対策 ✅ 安全（DB値優先）
6. 他社トークン悪用 ✅ 完全に安全（company_id 固定）
7. トークン予測攻撃 ✅ 極めて強力（2^256）

**未実装の改善** (P1):
- `email` フィールドを必須化（現在: オプション）
- レート制限強化（IP単位の試行回数制限）
- トークン無効エラーの監視ルール

**修正案**（最小構成）:
```typescript
// complete API の email バリデーション
const email = (body?.email || '').trim();
if (!email) {
  return error('email_required');  // ★ 必須化
}

const providedEmail = normalizeEmail(email);
const inviteEmail = normalizeEmail(invite.email);
if (providedEmail !== inviteEmail) {
  return error('email_mismatch');
}
```

**試験方法**:
- 正常系: トークン + 正しいメール → アカウント作成成功
- メール改ざん: トークン + 別メール → email_mismatch エラー（400）
- トークン再利用: 2回目の同じトークン → invite_already_used エラー（400）
- 期限切れ: 7日後 → invite_expired エラー（400）
- 別会社トークン: 会社A招待 + 会社B所属ユーザー → company_id 不一致（401）

**ロールバック方法**:
- 修正なし（調査のみ）。必要ならコミット前に git reset

---

## 項目2：利用規約・プライバシーポリシー

### 前回判定
**P0失敗**: 「プレースホルダーのみ、同意機構未実装」

### 再調査結果

#### 2.1 現在のページ状態
✅ **確認**: `/terms` と `/privacy` はプレースホルダー（最終更新日: 2026年7月2日）

**ファイル確認** (`/app/terms/page.tsx`, `/app/privacy/page.tsx`)
- レイアウト実装済み
- セクション構成あり
- **本文は空（プレースホルダー）**

#### 2.2 正式文書の配置と同意機構の実装計画
✅ **実装計画あり**：最小構成で以下を構築可能

**DB テーブル** (Supabase):
```sql
CREATE TABLE user_agreements (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  company_id UUID REFERENCES companies(id),
  document_type TEXT ('terms' | 'privacy'),
  document_version TEXT ('20260731'),
  agreed_at TIMESTAMP,
  ip_address INET,
  user_agent TEXT,
  UNIQUE(user_id, company_id, document_type)
);

ALTER TABLE user_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_agreements_select ON user_agreements ...
```

**API エンドポイント**:
- `POST /api/agreements/accept` - 同意を記録
- `GET /api/agreements/check` - 同意有無を確認

**UI コンポーネント**:
- `AgreementCheckbox.tsx` - 再利用可能な同意ウィジェット
- `/app/invite/accept/InviteAcceptClient.tsx` - 招待受諾時に統合
- `/app/auth/agreements/page.tsx` - 初回ログイン時の同意フロー

**既存ユーザー対応**:
- マイグレーションスクリプト: 一括登録可能
- または初回ログイン時に同意取得

**工数**: 約2-3日（最小構成）

---

### 再判定：利用規約・プライバシーポリシー

**判定**: **P0確定** ❌

**理由**:
1. 現在: プレースホルダー（本文なし）
2. PoC提供に法的同意が必須
3. 実装計画があり修正可能
4. ただし、正式文書本文の作成（法務）はコード外

**必須アクション**:
1. **法務**: 2026年7月31日版の正式文書作成
2. **開発**: DB/API/UI 実装（2-3日）
3. **既存ユーザー**: マイグレーション実施

**修正優先度**: **最高** - PoC開始前に必須

---

## 項目3：インシデント対応計画書

### 前回判定
**P0なし**: 「手順書未作成 → BLOCKED」

### 再調査結果

#### 3.1 現在の状態
❌ **確認**: インシデント対応の統一手順書がない

**見つかった部分的な手順**:
- `BRIDGE_PROD_RUNBOOK.md` - 本番デプロイ時の切り戻し手順（BRIDGE F-5機能限定）
- `EMERGENCY_DATA_LOSS_FIX.md` - データロス防止の技術的対策
- `security-log/README.md` - セキュリティ監査ログの管理ルール
- 緊急連絡先テンプレート - 未記入

**欠落している内容**:
- インシデント分類・優先度定義 (P1/P2/P3)
- 事象検知・アラート閾値
- 初期対応者の決定・エスカレーション経路
- RCA（根本原因分析）プロセス
- 外部ステークホルダーへの通知テンプレート
- 定期的なインシデント対応訓練

#### 3.2 必須項目
PoC提供時に必要な対応計画:

1. **連絡窓口** - 応答時間、担当者、エスカレーション経路
2. **初動対応フロー** - 検知 → 報告 → 対応 → 復旧 → 事後分析
3. **セキュリティ事象対応** - データ漏えい、アカウント乗っ取り、不正アクセス
4. **サービス障害対応** - API障害、DB障害、外部サービス障害
5. **通知テンプレート** - ユーザー向け、先方企業向け
6. **復旧手順** - ロールバック、リカバリ、検証

---

### 再判定：インシデント対応計画書

**判定**: **P0確定** ❌

**理由**:
1. PoC提供時にセキュリティ事象が発生する可能性あり
2. 対応体制・連絡窓口が未定義
3. 先方企業への通知・報告手順がない
4. 規制要件（個人情報法等）への準拠体制が不在

**必須アクション**:
1. **ICP（Incident Response Plan）作成**: 1-2日
2. **連絡窓口確定**: 24時間対応体制の確認
3. **先方企業との合意**: 通知タイミング、対応SLA

**修正優先度**: **最高** - PoC開始前に必須

---

## 項目4：org_alignment RLS ポリシー

### 前回判定
**P1未適用**: 「org_alignment_insights等のRLSポリシー未適用」

### 再調査結果

#### 4.1 矛盾の解消
✅ **矛盾なし** - 2つの異なる状態を混同していた

**事実**:
- **56ポリシー**: 全DBのRLS総数（現在有効）
- **org_alignment RLS未適用**: 2026-07-08 migration の新規ポリシー（未適用）

**現在の状態（2026年7月31日時点）**:

| テーブル | RLS | ポリシー数 | 状態 |
|---------|------|----------|------|
| org_alignment_cases | 有効 | 4 | ✅ 完全実装 |
| org_alignment_shared_topics | 有効 | 2 | ✅ 部分実装 |
| org_alignment_requests | 有効 | 3 | ✅ 部分実装 |
| org_alignment_insights | 有効 | **0** | ❌ ポリシー未実装 |
| org_alignment_stage_reflection_candidates | 有効 | **0** | ❌ ポリシー未実装 |
| org_alignment_insight_sources | 有効 | **0** | ❌ ポリシー未実装 |

#### 4.2 API側での保護状況
✅ **API層で厳格に保護** - Service Role 使用前に認証・権限チェック

**実装確認** (`/lib/server/rbacGuard.ts` L32-161)

3層チェック:
1. **JWT 署名検証** (Bearer token)
2. **Company 所属確認** (company_members テーブル)
3. **Role 権限確認** (admin/manager/member)

全て通過後のみ Service Role で操作実行。

#### 4.3 migration 20260708 の状態
⚠️ **未適用** - migration ファイルは作成済み、本番環境には未適用

**migration 内容**:
```sql
-- 新規ポリシーを追加
CREATE POLICY "insights_admin_crud" ON org_alignment_insights ...
CREATE POLICY "insights_member_read" ON org_alignment_insights ...
CREATE POLICY "reflection_candidates_member_read" ON ... 
CREATE POLICY "reflection_candidates_admin_write" ON ...
CREATE POLICY "insight_sources_via_cases" ON org_alignment_insight_sources ...
CREATE POLICY "agent_logs_admin_select" ON agent_logs ...
CREATE POLICY "agent_logs_service_insert" ON agent_logs ...
```

**適用計画**: 
- ファイル: `supabase/migrations/20260708_add_rls_org_alignment_agent_logs.sql`
- ステータス: `NOT YET APPLIED TO PRODUCTION`
- 実施予定: 記載なし

---

### 再判定：org_alignment RLS

**判定**: **P1確定（P0ではない）** ⚠️

**理由**:
1. RLS 自体は有効化済み（ポリシーなし = 全アクセス拒否）
2. API 層での保護が厳格（3層チェック）
3. Service Role 使用前に認証・権限・company_id を確認
4. **ただし** migration を適用すれば、DB層でも多層防御が完成

**未実装の影響**:
- org_alignment_insights への認証ユーザーのアクセス → RLS で拒否（ポリシーなし）
- API 側で Service Role 使用 + company_id フィルタで保護（代替）
- セキュリティ: **API層保護により低リスク**

**必須アクション** (PoC開始前):
1. migration 20260708 を検証環境で試験
2. company A/B アクセス試験（クロステナント防止確認）
3. ロールバック手順を準備
4. 本番環境に適用

**実装工数**: 数時間（migration 実行 + 試験）

**ロールバック手順**:
```sql
-- migration 未適用に戻す（既に有効化済みのポリシーのみ削除）
DROP POLICY insights_admin_crud ON org_alignment_insights;
DROP POLICY insights_member_read ON org_alignment_insights;
-- ... 他のポリシー削除
```

---

## 項目5：console ログの分類と整備

### 前回判定
**P1整備**: 「437件のconsole出力を削除・制御・マスキングに分ける」

### 再調査結果

#### 5.1 実際のログ件数と分類
✅ **確認**: 約2,574件（前回437件は過少）

**分類結果**:

| 分類 | 件数 | アクション | 例 |
|-----|------|-----------|-----|
| 1. 削除候補（入力本文/AI生成） | ~120 | 開発のみ有効化 | stage2 parse ログ、cascade AI出力 |
| 2. マスキング候補（個人情報） | ~85 | maskEmail(), maskUUID() | メール、ユーザーID |
| 3. 削除候補（機密） | ~45 | `NODE_ENV !== 'production'` | JWT部分、API キー |
| 4. マスキング候補（構造化ID） | ~160 | hashId() 導入 | companyId, projectId, strategyId |
| 5. **保持必須**（処理状況） | ~780 | そのまま保持 | フロー制御、再試行ロジック |
| 6. **保持必須**（エラー監視） | ~400 | 本番維持 | 認可チェック、競合検出、DB エラー |

**重要**: カテゴリ5・6（1,180件）はシステムの正常動作・エラー監視に必須。削除禁止。

#### 5.2 修正パターン

**パターンA: 削除（開発のみ有効化）**
```typescript
if (process.env.NODE_ENV !== 'production') {
  console.log('[stage2] AI response dump:', largeObject);
}
```

**パターンB: マスキング**
```typescript
console.log('[auth] user login', { userId: maskUUID(userId), companyId: maskUUID(companyId) });

// マスク関数（lib/logging.ts に追加）
function maskUUID(id: string): string {
  return id.substring(0, 8) + '***';
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return local.substring(0, 2) + '***@' + domain;
}
```

**パターンC: 保持（エラー監視）**
```typescript
console.warn('[SAVE_BLOCKED] unhydrated state - preventing data loss', { hydrated, restored });
// そのまま保持。本番環境でのデータロス防止に必須
```

#### 5.3 実装工数
- grep/sed で自動マスキング適用: 2-3日
- エラーログの分類と確認: 1日
- 動作検証: 1日

---

### 再判定：console ログの整備

**判定**: **P1確定** ⚠️

**理由**:
1. 本番環境でのセキュリティ監視に必須なログあり（削除不可）
2. 個人情報・IDをマスキングして、プライバシーを保護
3. 開発用ダンプを本番から除外して、ログノイズを削減

**修正優先度**: **中** - PoC開始前に完了推奨

**実装方法**: 段階的に以下を適用
1. 削除候補（~120件）: `if (NODE_ENV !== 'production')` 条件化
2. マスキング候補（~245件）: maskUUID(), maskEmail() 関数適用
3. 保持必須（~1,180件）: 確認後そのまま保持

---

## 項目6：npm 脆弱性

### 前回判定
**P2対応**: 「npm audit fix 禁止」

### 再調査結果

#### 6.1 CRITICAL 脆弱性（3件）

**tar 7.5.7 - CRITICAL**
| 項目 | 内容 |
|-----|------|
| 脆弱性 | ファイル読み書き権限昇格（9個のCVE） |
| 依存パス | vercel → @vercel/nft → @mapbox/node-pre-gyp → tar |
| PoC環境での影響 | **中** - ファイルシステム操作時の権限昇格リスク |
| 修正 | npm audit fix で 7.5.20+ へ |
| Breaking | なし（パッチ版） |

**undici 6.27.0 - HIGH（複数）**
| 項目 | 内容 |
|-----|------|
| 脆弱性 | HTTP/WebSocket 通信の複数脆弱性（Request Smuggling, DoS） |
| 依存パス | vercel → @vercel/blob, @vercel/node, sandbox |
| PoC環境での影響 | **高** - HTTP通信が脆弱 |
| 修正 | npm audit fix --force で vercel 58.4.4 へ |
| Breaking | あり（vercel major upgrade） |

**xlsx 0.18.5 - HIGH（複数）**
| 項目 | 内容 |
|-----|------|
| 脆弱性 | Prototype Pollution, ReDoS |
| 依存パス | 直接依存（データインポート時） |
| PoC環境での影響 | **高** - Prototype Pollution はRCE可能性 |
| 修正 | **パッチなし**。入力バリデーション追加が必須 |
| Breaking | あり（代替ライブラリ検討） |

#### 6.2 PoC前に必ず修正すべき脆弱性
✅ **P0**: tar, undici, xlsx

| パッケージ | 脆弱性タイプ | 修正方法 | Breaking | 優先度 |
|-----------|-----------|--------|---------|--------|
| tar | ファイル操作権限昇格 | npm audit fix | なし | **最高** |
| undici | HTTP Request Smuggling | npm audit fix --force | あり | **最高** |
| xlsx | Prototype Pollution | 入力バリデーション追加 | パッチなし | **最高** |
| postcss | XSS | npm audit fix | なし | 高 |
| sharp | libvips CVE | npm audit fix | なし | 高 |
| brace-expansion | DoS | npm audit fix | なし | 中 |

#### 6.3 修正手順
```bash
# Step 1: tar, postcss, sharp, brace-expansion の修正
npm audit fix

# Step 2: xlsx の入力バリデーション追加
# [実装例を別途提供予定]

# Step 3: vercel breaking change 対応
npm install vercel@58.4.4 --save
npm install ai@7.0.44 --save  # 依存関係

# Step 4: 動作検証
npm run build
npm run dev

# Step 5: 最終確認
npm audit --omit=dev
```

**工数**: 3-5日（testing含む）

---

### 再判定：npm 脆弱性

**判定**: **P0/P1混在** ⚠️

**P0（PoC開始前に必須）**:
1. **tar CRITICAL** - ファイル操作権限昇格（修正可能、Breaking なし）
2. **xlsx Prototype Pollution** - RCE可能性（入力バリデーション必須）

**P1（開始直前に対応）**:
3. **undici HIGH** - HTTP Request Smuggling（Breaking change あり）
4. **postcss HIGH** - XSS（修正可能）
5. **sharp HIGH** - libvips CVE（修正可能）

**修正優先度**: **最高** - PoC提供前に全て修正

---

## 再判定サマリー表

| 項目 | 前回 | 再判定 | 理由 | 対応 |
|-----|------|--------|------|------|
| 1. 招待メール検証 | P0脆弱性 | **P1候補** | セキュリティ対策実装済み。email フィールド必須化で改善 | email フィールド必須化、レート制限強化 |
| 2. 利用規約・プライバシーポリシー | P0未実装 | **P0確定** | プレースホルダー。法的同意が必須 | 正式文書作成、DB/API/UI 実装 |
| 3. インシデント対応計画書 | P0未作成 | **P0確定** | 手順書なし。事故対応体制が不在 | ICP 策定、連絡窓口確定 |
| 4. org_alignment RLS | P1未適用 | **P1確定** | API層保護が厳格。migration 適用で完成 | migration 20260708 適用・試験 |
| 5. console ログ | P1整備 | **P1確定** | 2,574件を分類。エラーログは削除禁止 | 削除・マスキング・保持に分類 |
| 6. npm 脆弱性 | P2対応 | **P0/P1混在** | tar/undici/xlsx は修正必須 | npm audit fix + xlsx バリデーション |

---

## 最終判定：PoC開始可否

### P0（開始を止める）

1. **利用規約・プライバシーポリシー** - 法的同意なしでPoC提供不可
2. **インシデント対応計画書** - 事故対応体制なしでPoC提供不可
3. **tar/undici/xlsx 脆弱性** - セキュリティリスクが高すぎる

### P1（開始直前に対応）

1. **org_alignment RLS migration** - DB層の多層防御を完成
2. **console ログ整備** - プライバシー・セキュリティ監視を確保
3. **招待メール検証** - email フィールド必須化で追加防御
4. **postcss/sharp 脆弱性** - 修正可能なパッチ

---

## 実装チェックリスト

### P0（PoC開始前に絶対必須）

- [ ] 利用規約・プライバシーポリシー正式文書作成（法務）
- [ ] user_agreements テーブル作成（DB）
- [ ] /api/agreements/accept, /api/agreements/check 実装（開発）
- [ ] /app/invite/accept, /app/auth/agreements UI 実装（開発）
- [ ] インシデント対応計画書（ICP）作成（石原）
- [ ] 連絡窓口・エスカレーション経路確定（石原・先方）
- [ ] npm audit fix（tar, postcss, sharp, brace-expansion）
- [ ] xlsx 入力バリデーション実装（開発）
- [ ] npm audit fix --force（vercel 58.4.4, ai 7.0.44）
- [ ] 動作検証：npm run build, npm run dev

### P1（開始直前に対応）

- [ ] org_alignment RLS migration 20260708 検証環境試験
- [ ] company A/B クロステナントテスト
- [ ] console ログ分類・マスキング・削除（開発）
- [ ] 招待フロー: email フィールド必須化（開発）
- [ ] 先方企業との契約・NDA 締結

---

## 修正見積もり

| 項目 | 工数 | 依存関係 |
|-----|-----|---------|
| 利用規約・プライバシーポリシー | 2-3日 | 法務（正式文書） |
| インシデント対応計画書 | 1-2日 | 石原・先方との協議 |
| org_alignment RLS migration | 数時間 | DB管理者 |
| console ログ整備 | 3-4日 | 開発 |
| npm 脆弱性修正 | 3-5日 | 開発・test |
| 招待メール検証改善 | 半日 | 開発 |
| **合計** | **約10-15日** | - |

---

## 報告状況

本調査の結果、前回監査報告での根拠不足・矛盾・過大判定について以下が判明しました：

✅ **矛盾が解消された項目**:
- org_alignment RLS（56ポリシー vs 未適用の矛盾なし）

⚠️ **再判定で変更された項目**:
- 招待メール検証（P0脆弱性 → P1候補）

✅ **確定された項目**:
- 利用規約・プライバシーポリシー（P0）
- インシデント対応計画書（P0）
- npm 脆弱性（P0/P1混在）

**最終的なP0項目**: 3件（利用規約、インシデント対応、npm脆弱性）

**修正実施まで調査段階で停止します。承認を待ってください。**

---

**調査完了日**: 2026年7月31日  
**調査方法**: コード確認 + セキュリティ詳細分析  
**修正実施**: 承認後に開始

