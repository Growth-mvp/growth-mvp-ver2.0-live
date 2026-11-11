/**
 * 分離Supabase（ローカル・127.0.0.1のみ）に対する保存・再読み込み・再確定の検証。
 * STAGE2_ISOLATED_DB_URL（ループバックのみ）と STAGE2_ISOLATED_DB_SERVICE_KEY が両方ある場合だけ実行する。
 * 本番DBは対象外（URLがループバック以外なら実行しない）。テスト用の戦略行は削除し、会社は論理削除する。
 */
import { randomUUID } from 'crypto';
import { buildDbRowFromState, buildStateFromDbRow } from '@/utils/supabase/strategy';
import {
  buildConfirmedDocumentEdits,
  buildStrategicAssumptions,
  findUnconfirmedChanges,
  markDraftChanged,
  mergeMidtermStrategyIntoDocumentEdits,
  pickDisplayedStory,
  resolveStrategicAssumptions,
  toConfirmedEdits,
} from './finalDocument';
import type { StoryChapter } from '@/types/strategy';

const DB_URL = process.env.STAGE2_ISOLATED_DB_URL ?? '';
const DB_KEY = process.env.STAGE2_ISOLATED_DB_SERVICE_KEY ?? '';
const isolated = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(DB_URL) && DB_KEY !== '';
const describeIsolated = isolated ? describe : describe.skip;

const chapters = (body: string): StoryChapter[] => [
  { title: '第1章：なぜ今、変わる必要があるのか', body },
  { title: '第2章：どこで、どう勝つのか', body: `${body}-2` },
  { title: '第3章：どんな未来を実現するのか', body: `${body}-3` },
  { title: '第4章：その実現に向けてどう行動するのか', body: `${body}-4` },
];

const targets = [
  { id: 'rev', label: '売上', unit: '百万円', base: 12000, low: 11000, high: 13000, dueYear: 2030 },
  { id: 'op', label: '営業利益', unit: '百万円', base: 50, low: 40, high: 60, dueYear: 2030 },
];

const topMidterm = {
  midtermConcept: '生成コンセプト',
  targetVisionForMidterm: '専門企業',
  priorityStrategicThemes: ['旧テーマ'],
  companyWideDecisionCriteria: ['旧基準'],
  deploymentPrinciplesForUnits: ['旧展開'],
};

const restHeaders = {
  apikey: DB_KEY,
  Authorization: `Bearer ${DB_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${DB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders, Prefer: 'return=representation', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** 状態 → 保存行（実際の変換関数）→ DB → 行 → 状態（実際の変換関数） */
function toRow(state: any, companyId: string, id: string, revision: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    ...buildDbRowFromState({ ...state, revision }),
    id,
    company_id: companyId,
    revision,
  };
  // 実際の保存処理と同じく、テーブルに無い勝ちパターン列は更新ペイロードから外す（PGRST204対策）
  for (const key of ['win_patterns', 'win_patterns_candidate', 'winPatterns', 'winPatternsCandidate']) delete row[key];
  return row;
}

async function readState(id: string): Promise<any> {
  const [row] = await rest(`strategy_data?id=eq.${id}&select=*`);
  return buildStateFromDbRow(row) as any;
}

/** 業績目標・事業データ・KPIなど、この検証で変えてはいけない列の一致を確かめるための指紋 */
const GUARDED_COLUMNS = ['departments', 'finance_pl', 'company_targets', 'okr_target_scores', 'simulation_results'];
async function guardedFingerprint(id: string): Promise<string> {
  const [row] = await rest(`strategy_data?id=eq.${id}&select=${GUARDED_COLUMNS.join(',')}`);
  return JSON.stringify(row);
}

describeIsolated('分離DB：旧確定版の保存・再読み込み・再確定', () => {
  let companyId = '';
  let strategyId = '';

  beforeAll(async () => {
    companyId = randomUUID();
    strategyId = randomUUID();
    const now = new Date().toISOString();
    await rest('companies', {
      method: 'POST',
      body: JSON.stringify([{ id: companyId, name: '検証用（分離DB）株式会社', created_at: now, updated_at: now }]),
    });
  });

  afterAll(async () => {
    // 物理削除は禁止されているため、会社は論理削除する（戦略行は検証用なので削除する）
    if (companyId) await rest(`strategy_data?company_id=eq.${companyId}`, { method: 'DELETE' }).catch(() => undefined);
    if (companyId) {
      await rest(`companies?id=eq.${companyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      }).catch(() => undefined);
    }
  });

  it('旧確定版 → 下書き保存 → 再読み込み → 再確定の流れで、確定版・ブリッジ・業績目標が正しく残る', async () => {
    const legacyBridge = { keyThemes: ['旧テーマ'], departmentIssues: [], kpiCriteria: [], commonBehaviorChanges: [], generatedAt: '2026-11-01T00:00:00.000Z' };
    // アプリの状態はキャメルケースで持ち、保存時に列名へ変換される
    const base = {
      departments: [],
      csvFinanceData: {},
      answers2: {},
      okrTargetScores: {},
      simulationResults: {},
      companyTargets: targets,
      financePL: [],
      answers12: [],
    };

    // 1. 旧確定版（確定スナップショットなし）を保存
    await rest('strategy_data', {
      method: 'POST',
      body: JSON.stringify([
        toRow(
          {
            ...base,
            story: [],
            final_story: chapters('旧確定本文'),
            finalStoryFinal: chapters('旧確定本文'),
            finalStoryEdited: chapters('旧の編集'),
            finalStoryDraft: chapters('AIたたき台'),
            finalStory: chapters('旧確定本文'),
            stage2FinalDocumentEdits: { conclusion: '旧確定の結論' },
            midtermStrategy: topMidterm,
            stage3_strategy_bridge: legacyBridge,
            stage2FinalGeneratedConclusion: 'AI結論',
          },
          companyId,
          strategyId,
          1,
        ),
      ]),
    });
    const fingerprintBefore = await guardedFingerprint(strategyId);

    // 2. 再読み込み：旧確定版が維持され、未確定扱いにならない
    const loaded = await readState(strategyId);
    expect(loaded.finalStoryFinal).toEqual(chapters('旧確定本文'));
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: loaded.finalStoryFinal,
        finalStoryEdited: loaded.finalStoryEdited,
        edits: loaded.stage2FinalDocumentEdits,
        midtermStrategy: loaded.midtermStrategy,
        aiGeneratedConclusion: loaded.stage2FinalGeneratedConclusion,
      }),
    ).toEqual({ chapters: false, document: false, midtermStrategy: false });
    expect(toConfirmedEdits(loaded.stage2FinalDocumentEdits)?.conclusion).toBe('旧確定の結論');

    // 3. 本文・結論・中計の重要項目を編集して下書き保存（確定はしない）
    const draftEdits = markDraftChanged(
      mergeMidtermStrategyIntoDocumentEdits(
        {
          ...loaded.stage2FinalDocumentEdits,
          conclusion: '下書きの結論',
          midtermStrategy: { ...topMidterm, priorityStrategicThemes: ['下書きテーマ'] },
        },
        loaded.midtermStrategy,
      ),
      '2026-11-11T01:00:00.000Z',
    );
    await rest(`strategy_data?id=eq.${strategyId}&revision=eq.1`, {
      method: 'PATCH',
      body: JSON.stringify(
        toRow(
          { ...loaded, finalStoryEdited: chapters('下書き本文'), stage2FinalDocumentEdits: draftEdits },
          companyId,
          strategyId,
          2,
        ),
      ),
    });

    // 4. 再読み込み：編集値が残り、旧確定版は変わらず、未確定の変更として判定される
    const saved = await readState(strategyId);
    expect(saved.finalStoryFinal).toEqual(chapters('旧確定本文'));
    expect(saved.finalStoryEdited[0].body).toBe('下書き本文');
    expect(saved.stage2FinalDocumentEdits.conclusion).toBe('下書きの結論');
    const unconfirmed = findUnconfirmedChanges({
      finalStoryFinal: saved.finalStoryFinal,
      finalStoryEdited: saved.finalStoryEdited,
      edits: saved.stage2FinalDocumentEdits,
      midtermStrategy: saved.midtermStrategy,
      aiGeneratedConclusion: saved.stage2FinalGeneratedConclusion,
    });
    expect(unconfirmed).toEqual({ chapters: true, document: true, midtermStrategy: true });
    expect(pickDisplayedStory(saved, unconfirmed)[0].body).toBe('下書き本文');
    // 下流（計画書・STAGE3引き渡し）は未確定の内容を使わない
    expect(toConfirmedEdits(saved.stage2FinalDocumentEdits)).toEqual({});
    expect(saved.stage3_strategy_bridge).toEqual(legacyBridge);

    // 5. 再確定：表示中の内容を確定し、確定時点の値・STAGE3ブリッジを保存する
    const toConfirm = pickDisplayedStory(saved, unconfirmed);
    const merged = mergeMidtermStrategyIntoDocumentEdits(saved.stage2FinalDocumentEdits, saved.midtermStrategy);
    const assumptions = resolveStrategicAssumptions(
      merged?.assumptions,
      buildStrategicAssumptions({ midtermStrategy: merged?.midtermStrategy }),
    );
    const confirmedEdits = buildConfirmedDocumentEdits({
      edits: merged,
      aiGeneratedConclusion: 'AI結論',
      assumptions,
      confirmedAt: '2026-11-11T02:00:00.000Z',
    });
    const newBridge = { keyThemes: ['下書きテーマ'], departmentIssues: [], kpiCriteria: [], commonBehaviorChanges: [], generatedAt: '2026-11-11T02:00:00.000Z' };
    await rest(`strategy_data?id=eq.${strategyId}&revision=eq.2`, {
      method: 'PATCH',
      body: JSON.stringify(
        toRow(
          {
            ...saved,
            finalStoryFinal: toConfirm,
            finalStoryEdited: toConfirm,
            finalStory: toConfirm,
            stage2FinalDocumentEdits: confirmedEdits,
            midtermStrategy: confirmedEdits.midtermStrategy ?? saved.midtermStrategy,
            stage3_strategy_bridge: newBridge,
          },
          companyId,
          strategyId,
          3,
        ),
      ),
    });

    // 6. 再確定後の確認
    const reconfirmed = await readState(strategyId);
    expect(reconfirmed.finalStoryFinal[0].body).toBe('下書き本文');
    expect(reconfirmed.finalStory[0].body).toBe('下書き本文');
    expect(reconfirmed.stage2FinalDocumentEdits.confirmed?.conclusion).toBe('下書きの結論');
    expect(reconfirmed.midtermStrategy.priorityStrategicThemes).toEqual(['下書きテーマ']);
    expect(reconfirmed.stage3_strategy_bridge.keyThemes).toEqual(['下書きテーマ']);
    expect(
      findUnconfirmedChanges({
        finalStoryFinal: reconfirmed.finalStoryFinal,
        finalStoryEdited: reconfirmed.finalStoryEdited,
        edits: reconfirmed.stage2FinalDocumentEdits,
        midtermStrategy: reconfirmed.midtermStrategy,
        aiGeneratedConclusion: 'AI結論',
      }),
    ).toEqual({ chapters: false, document: false, midtermStrategy: false });
    // 業績目標・財務・KPI・実行計画の列は、保存と再確定の前後で変わらない
    expect(await guardedFingerprint(strategyId)).toEqual(fingerprintBefore);
  });
});
