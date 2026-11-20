/* 非上場企業の入力候補をブラウザ側で作る（PHASE 5B-2）。公開情報は会社名のAPI、資料は既存のSTAGE1資料読み込みAPIを使う。どちらも保存はしない。 */
import type { Stage1ImportCandidate } from '@/types/strategy';
import type { DocumentProfile } from '@/utils/stage1/importers/profileExtract';
import { buildDocumentCandidate, type PublicCandidate, type PublicCandidateResult } from './publicCandidate';

export type PublicProfileResponse =
  | { status: 'FOUND'; candidate: PublicCandidate; fetchedAt: string }
  | { status: 'NOT_FOUND' | 'SEARCH_TIMEOUT' | 'SEARCH_FAILED' | 'NOT_CONFIRMED' | 'QUERY_UNCLEAR'; message?: string };

export async function runPublicProfile(args: {
  name: string;
  companyId: string;
  strategyId: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<PublicProfileResponse> {
  const doFetch = args.fetchImpl ?? fetch;
  const res = await doFetch('/api/stage1/autofill/web', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.token}` },
    body: JSON.stringify({ companyId: args.companyId, strategyId: args.strategyId, name: args.name }),
  });
  const raw = await res.text();
  const json = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? `web_${res.status}`));
  return json as PublicProfileResponse;
}

export async function runDocumentFinance(args: {
  files: File[];
  token: string;
  now?: () => string;
  fetchImpl?: typeof fetch;
}): Promise<PublicCandidateResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const form = new FormData();
  for (const f of args.files) form.append('files', f);
  const res = await doFetch('/api/stage1/import', {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}` },
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    candidates?: Stage1ImportCandidate[];
    documentProfiles?: Array<{ fileName: string; profile: DocumentProfile }>;
    error?: string;
  };
  if (!res.ok || json.success === false) throw new Error(String(json.error ?? `import_${res.status}`));
  const fetchedAt = args.now ? args.now() : new Date().toISOString();
  return buildDocumentCandidate({
    candidates: json.candidates ?? [],
    profiles: (json.documentProfiles ?? []).map((p) => p.profile),
    fetchedAt,
  });
}
