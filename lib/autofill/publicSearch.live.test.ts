/* 実際のOpenAI（Web検索）に接続する確認。通常の実行では動かさない。
 * 実行: LIVE_WEB_PROFILE=1 LIVE_WEB_COMPANY="会社名" npx jest publicSearch.live */
jest.mock('server-only', () => ({}));

import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { searchPublicCompanyProfile } from './publicSearch';
import { buildWebProfileCandidate } from './publicCandidate';

const live = process.env.LIVE_WEB_PROFILE === '1' ? describe : describe.skip;

function readEnvLocal(key: string): string | undefined {
  const file = path.join(__dirname, '..', '..', '.env.local');
  if (!fs.existsSync(file)) return process.env[key];
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : process.env[key];
}

live('実接続：非上場企業の公開情報の取得（1回だけ呼ぶ）', () => {
  it('会社名で検索し、出典つきの行と候補の結果を表示する', async () => {
    const name = process.env.LIVE_WEB_COMPANY ?? '';
    const apiKey = readEnvLocal('OPENAI_API_KEY');
    expect(name.length).toBeGreaterThan(1);
    expect(apiKey).toBeTruthy();
    const client = new OpenAI({ apiKey: apiKey as string });
    const result = await searchPublicCompanyProfile(client, name, new Date(), 60_000);
    process.stdout.write(`\n[LIVE] status=${result.status} facts=${result.facts.length}\n`);
    for (const f of result.facts) {
      process.stdout.write(`[LIVE] ${f.text}\n[LIVE]   sources=${f.sources.map((s) => s.url).join(' , ')}\n`);
    }
    const built = buildWebProfileCandidate({ query: name, facts: result.facts, confirmedOn: result.confirmedOn });
    process.stdout.write(`[LIVE] candidate=${JSON.stringify(built.status === 'FOUND' ? built.candidate : built.message)}\n`);
    expect(['completed', 'no_results']).toContain(result.status);
  }, 90_000);
});
