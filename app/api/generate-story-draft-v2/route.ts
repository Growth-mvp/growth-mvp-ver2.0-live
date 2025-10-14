// /app/api/generate-story-draft-v2/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// v2 は当面、v1 と同一ロジックを利用（片落ち防止のためラップ再輸出）
export { POST } from '@/app/api/generate-story-draft/route';
