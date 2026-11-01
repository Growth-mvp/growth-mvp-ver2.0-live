/* STAGE1/2 snapshot が会社IDで区別され、会社IDのない旧 snapshot やログアウト後の残存データを使わないことを確認する。 */

export {};

import {
  getStage1DataWithFallback,
  isSnapshotOfCompany,
  loadStage1SnapshotFromLocalStorage,
  loadStage2SnapshotFromLocalStorage,
  saveStage1SnapshotToLocalStorage,
  saveStage2SnapshotToLocalStorage,
} from './stageSnapshot';
import { purgeGrowthShiftLocalStorage } from '@/components/LogoutButton';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STAGE1_KEY = 'growth.stage1.snapshot';
const STAGE2_KEY = 'growth.stage2.snapshot';

function createMemoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
    clear: () => memory.clear(),
    key: (i: number) => Array.from(memory.keys())[i] ?? null,
    get length() {
      return memory.size;
    },
    _memory: memory,
  };
}

let local: ReturnType<typeof createMemoryStorage>;
let session: ReturnType<typeof createMemoryStorage>;

beforeAll(() => {
  (globalThis as any).window = globalThis;
});

beforeEach(() => {
  local = createMemoryStorage();
  session = createMemoryStorage();
  (globalThis as any).localStorage = local;
  (globalThis as any).sessionStorage = session;
});

const stage1Issues = [{ id: 'i1', title: '論点', body: '本文' }] as any;
const stage2State = { mvv: {}, swot: {}, ceoIntent: '' } as any;

describe('R6: snapshot は会社IDで区別する', () => {
  it('会社IDのない STAGE1/2 の保存は行わない', () => {
    expect(saveStage1SnapshotToLocalStorage(stage1Issues, undefined, 'A社', undefined)).toBe(false);
    expect(saveStage2SnapshotToLocalStorage(stage2State, undefined)).toBe(false);
    expect(local.getItem(STAGE1_KEY)).toBeNull();
    expect(local.getItem(STAGE2_KEY)).toBeNull();
  });

  it('会社IDのない旧 snapshot は読み込まず、別会社への復元に使わない', () => {
    local.setItem(
      STAGE1_KEY,
      JSON.stringify({ savedAt: NOW(), issueBlocks: stage1Issues, metricsSummary: {}, companyName: 'A社' })
    );
    local.setItem(STAGE2_KEY, JSON.stringify({ savedAt: NOW(), state: stage2State }));

    expect(loadStage1SnapshotFromLocalStorage()).toBeNull();
    expect(loadStage2SnapshotFromLocalStorage()).toBeNull();
    expect(getStage1DataWithFallback(undefined, COMPANY_B).source).toBe('none');
  });

  it('会社Aの STAGE1 snapshot は会社Bの画面に読み込まれない', () => {
    saveStage1SnapshotToLocalStorage(stage1Issues, undefined, 'A社', COMPANY_A);

    expect(getStage1DataWithFallback(undefined, COMPANY_B).source).toBe('none');
    expect(getStage1DataWithFallback(undefined, null).source).toBe('none');
  });

  it('会社Aの STAGE1 snapshot は会社Aの画面では読み込まれる', () => {
    saveStage1SnapshotToLocalStorage(stage1Issues, undefined, 'A社', COMPANY_A);

    const result = getStage1DataWithFallback(undefined, COMPANY_A);
    expect(result.source).toBe('localStorage');
    expect(result.issueBlocks).toEqual(stage1Issues);
  });

  it('isSnapshotOfCompany は会社IDが一致する場合だけ true を返す', () => {
    expect(isSnapshotOfCompany({ companyId: COMPANY_A }, COMPANY_A)).toBe(true);
    expect(isSnapshotOfCompany({ companyId: COMPANY_A }, COMPANY_B)).toBe(false);
    expect(isSnapshotOfCompany({ companyId: undefined }, COMPANY_A)).toBe(false);
    expect(isSnapshotOfCompany(null, COMPANY_A)).toBe(false);
    expect(isSnapshotOfCompany({ companyId: COMPANY_A }, null)).toBe(false);
  });
});

describe('R7: ログアウトで会社固有の snapshot を消す', () => {
  it('purge は STAGE1/2 の snapshot と会社データを消し、無関係なキーは残す', () => {
    local.setItem(STAGE1_KEY, JSON.stringify({ savedAt: NOW(), issueBlocks: [] }));
    local.setItem(STAGE2_KEY, JSON.stringify({ savedAt: NOW(), state: stage2State }));
    local.setItem('strategy-store-v5', '{}');
    local.setItem('unrelated-key', 'keep');

    purgeGrowthShiftLocalStorage();

    expect(local.getItem(STAGE1_KEY)).toBeNull();
    expect(local.getItem(STAGE2_KEY)).toBeNull();
    expect(local.getItem('strategy-store-v5')).toBeNull();
    expect(local.getItem('unrelated-key')).toBe('keep');
  });
});

function NOW() {
  return '2026-10-30T00:00:00.000Z';
}
