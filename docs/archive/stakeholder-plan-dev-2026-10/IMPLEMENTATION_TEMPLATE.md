# 実装テンプレート（v2・未更新）

> **注意（v5 との不一致）**: 本書は v2 の「署名付きドラフト＋ `/save` API」を前提にしています。
> v5 では次のとおり変わったため、§1（署名）・§2（draftToken）・§5（/save）は**使用しません**。
> - 生成APIが保存する（再保存用の `/save` は作らない）。新しい秘密情報は追加しない
> - 会社移動は切り離さず、読み取り時に照合する
> 現在有効な設計は `DESIGN_PLAN_STORAGE.md`（v5）を参照してください。

**注意**: このファイルは実装時の参考コードです。今回の作業では適用しません。
設計の根拠は `DESIGN_PLAN_STORAGE.md`、適用前の確認事項は `FINAL_DESIGN_REVIEW.md` を参照してください。
前版にあった GET 方式・クライアント送信の sections・`upsert(onConflict)` は廃止しました。

---

## 1. 署名付きドラフト（`lib/server/planDraftToken.ts`）

```typescript
import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

const TTL_MS = 30 * 60 * 1000;

export type DraftPayload = {
  u: string; // userId
  c: string; // companyId
  s: string; // strategyId
  a: 'bank' | 'shareholder' | 'employee';
  h: string; // sha256(generatedText) hex
  r: number | null; // strategy revision at generation
  g: string; // generatedAt ISO
  exp: number; // epoch ms
};

function getSecret(): string {
  const secret = process.env.PLAN_DRAFT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('PLAN_DRAFT_SECRET is missing or too short');
  }
  return secret;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function signDraft(input: Omit<DraftPayload, 'exp'>): string {
  const payload: DraftPayload = { ...input, exp: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyDraft(token: string): DraftPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: DraftPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}
```

---

## 2. 生成APIの追加部分（`app/api/plans/[audience]/generate/route.ts`）

成功レスポンスに `draftToken` を追加する。`sections` は生成API内で既に作っている値を使う。

```typescript
import { signDraft, sha256Hex } from '@/lib/server/planDraftToken';

// 既存の成功レスポンス直前に追加
const draftToken = signDraft({
  u: userId,
  c: body.companyId,
  s: body.strategyId,
  a: audience as 'bank' | 'shareholder' | 'employee',
  h: sha256Hex(generatedText),
  r: typeof strategyRow.data.revision === 'number' ? strategyRow.data.revision : null,
  g: generatedAt,
});

return NextResponse.json({
  audience,
  companyId: body.companyId,
  strategyId: body.strategyId,
  generatedText,
  sections,
  generatedAt,
  sourceRevision: typeof strategyRow.data.revision === 'number' ? strategyRow.data.revision : null,
  draftToken,
});
```

**注意**: `sections` を生成API外（保存API）で再計算するため、セクション分割ロジックを `lib/` の純関数に切り出す。生成APIとの二重実装は禁止。

---

## 3. 共通の入力スキーマと検証（`utils/supabase/generated-plans.ts`）

```typescript
import { z } from 'zod';

export const AudienceSchema = z.enum(['bank', 'shareholder', 'employee']);

export const ScopeSchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  audience: AudienceSchema,
});

export const SaveSchema = ScopeSchema.extend({
  draftToken: z.string().min(10).max(4000),
  generatedText: z.string().min(1).max(200_000),
  expectedVersion: z.number().int().min(1).nullable(),
});
```

---

## 4. 保存済み取得 API（`app/api/plans/[audience]/saved/route.ts`）

```typescript
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ScopeSchema } from '@/utils/supabase/generated-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ audience: string }> }
) {
  const userId = await getAuthUserIdFromBearer(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let input: z.infer<typeof ScopeSchema>;
  try {
    input = ScopeSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { audience: urlAudience } = await params;
  if (urlAudience !== input.audience) {
    return NextResponse.json({ error: 'Audience mismatch' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const membership = await requireMembership(admin, userId, input.companyId);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: strategy } = await admin
    .from('strategy_data')
    .select('id, revision')
    .eq('id', input.strategyId)
    .eq('company_id', input.companyId)
    .maybeSingle();
  if (!strategy) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: plan, error } = await admin
    .from('generated_plans')
    .select('generated_text, sections, generated_at, source_revision, version, updated_at')
    .eq('company_id', input.companyId)
    .eq('strategy_id', input.strategyId)
    .eq('audience', input.audience)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
  if (!plan) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    generatedText: plan.generated_text,
    sections: plan.sections,
    generatedAt: plan.generated_at,
    sourceRevision: plan.source_revision,
    currentRevision: strategy.revision ?? null,
    isStale:
      plan.source_revision !== null &&
      strategy.revision !== null &&
      plan.source_revision !== strategy.revision,
    version: plan.version,
    updatedAt: plan.updated_at,
  });
}
```

---

## 5. 保存 API（`app/api/plans/[audience]/save/route.ts`）

```typescript
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { sha256Hex, verifyDraft } from '@/lib/server/planDraftToken';
import { SaveSchema } from '@/utils/supabase/generated-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ audience: string }> }
) {
  const userId = await getAuthUserIdFromBearer(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let input: z.infer<typeof SaveSchema>;
  try {
    input = SaveSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { audience: urlAudience } = await params;
  if (urlAudience !== input.audience) {
    return NextResponse.json({ error: 'Audience mismatch' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const membership = await requireMembership(admin, userId, input.companyId);
  if (!membership || !['admin', 'manager'].includes(membership.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const draft = verifyDraft(input.draftToken);
  if (
    !draft ||
    draft.u !== userId ||
    draft.c !== input.companyId ||
    draft.s !== input.strategyId ||
    draft.a !== input.audience ||
    draft.h !== sha256Hex(input.generatedText)
  ) {
    return NextResponse.json({ error: 'Draft invalid or expired' }, { status: 400 });
  }

  const { data: strategy } = await admin
    .from('strategy_data')
    .select('id')
    .eq('id', input.strategyId)
    .eq('company_id', input.companyId)
    .maybeSingle();
  if (!strategy) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // sections は本文から再計算する（クライアント値は受け取らない）
  const sections = splitSections(input.generatedText); // 生成APIと共通の純関数

  const base = {
    generated_text: input.generatedText,
    sections,
    generated_at: draft.g,
    source_revision: draft.r,
    updated_by: userId,
  };

  if (input.expectedVersion === null) {
    const { data, error } = await admin
      .from('generated_plans')
      .insert({
        ...base,
        company_id: input.companyId,
        strategy_id: input.strategyId,
        audience: input.audience,
        created_by: userId,
      })
      .select('version, updated_at')
      .single();

    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Conflict' }, { status: 409 });
    }
    if (error || !data) {
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
    await audit(userId, input, 'PLAN_SAVED');
    return NextResponse.json({ version: data.version, updatedAt: data.updated_at });
  }

  const { data, error } = await admin
    .from('generated_plans')
    .update(base)
    .eq('company_id', input.companyId)
    .eq('strategy_id', input.strategyId)
    .eq('audience', input.audience)
    .eq('version', input.expectedVersion)
    .select('version, updated_at');

  if (error) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Conflict' }, { status: 409 });
  }

  await audit(userId, input, 'PLAN_UPDATED');
  return NextResponse.json({ version: data[0].version, updatedAt: data[0].updated_at });
}

async function audit(
  userId: string,
  input: z.infer<typeof SaveSchema>,
  action: string
) {
  try {
    await logAuditEvent({
      actorUserId: userId,
      action,
      companyId: input.companyId,
      targetType: 'generated_plan',
      metadata: { audience: input.audience, strategyId: input.strategyId },
    });
  } catch {
    // 監査ログの失敗で保存結果を変えない（ログ側で別途検知する）
  }
}

declare function splitSections(text: string): string[];
```

**注意**:
- `update(...).eq(version)` は楽観ロック。0件なら 409。
- トリガーが `version` を +1 するため、API は `version` を送らない。
- `base` に `company_id` / `strategy_id` / `audience` / `created_by` を含めない（不変性トリガーの対象）。
- `declare function splitSections` は説明用のプレースホルダ。実装では `lib/` の共通関数を import する。

---

## 6. UI の状態管理（`app/report/bank-plan/page.tsx` の要点）

```typescript
type PlanState = {
  key: string;                 // `${companyId}|${strategyId}|${audience}`
  generatedText: string;
  sections: string[];
  generatedAt: string | null;
  sourceRevision: number | null;
  isStale: boolean;
  version: number | null;      // null = 未保存（初回）
  draftToken: string | null;   // 生成直後のみ保持。期限切れ後は再生成が必要
  saveStatus: 'saved' | 'unsaved' | 'save_failed' | 'draft_expired';
};

const currentKey = `${companyId}|${strategyId}|bank`;
const visible = state && state.key === currentKey ? state : null;

useEffect(() => {
  setState(null); // 会社・戦略切替で即時クリア
  const ac = new AbortController();
  // fetch(..., { signal: ac.signal }) で saved を取得し、
  // 応答時に key を照合してから setState する
  return () => ac.abort();
}, [companyId, strategyId]);
```

- 生成成功時: `state` に `draftToken` と `version: null` を入れ、直ちに `/save` を呼ぶ
- 保存 HTTP エラー時: `saveStatus: 'save_failed'`、本文は残す、「再保存」で同じ `draftToken` を再送
- 保存 409 時: 最新を取得し直す（上書きしない）
- `draft_expired`（400 かつ期限切れ）時: 再保存ボタンを隠し、「再生成が必要」を表示

---

## 7. 検証用の固定データ方針

- 本番DBには接続しない。テストはステージングまたはローカルの使い捨て Postgres で実施
- トークンの期限切れ・改ざんは、`TTL_MS` を差し替えた単体テストで確認
- 詳細は `DESIGN_PLAN_STORAGE.md` §12 の T1〜T17
