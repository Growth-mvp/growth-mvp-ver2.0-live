import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { createMemoryPlanDocumentStore, type PlanDocActor, type PlanDocKey } from './planDocumentStore';
import { persistDraft, type StoredState } from './persistDraft';
import { resolveUserEdits } from './mergeUserEdits';
import type { StrategyRow } from './projectResolver';

const CO_A = 'fict-co-a';
const CO_B = 'fict-co-b';
const KEY: PlanDocKey = { companyId: CO_A, strategyId: 'fict-strategy-a', projectId: 'fict-proj-renewal' };
const ALICE: PlanDocActor = { userId: 'alice', memberships: [{ companyId: CO_A, role: 'member' }] };
const BOB: PlanDocActor = { userId: 'bob', memberships: [{ companyId: CO_A, role: 'manager' }] };
const OUTSIDER: PlanDocActor = { userId: 'eve', memberships: [{ companyId: CO_B, role: 'admin' }] };
const DRAFT = { note: 'AI草案（凍結）' };

const strategies = (): StrategyRow[] => JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES.slice(0, 1)));
const makeStore = (storage?: { read: () => string | null; write: (v: string) => void }, getStrategies = strategies) =>
  createMemoryPlanDocumentStore({ getStrategies, now: () => '2026-11-10T00:00:00.000Z', storage });

describe('保存の契約（メモリ実装）', () => {
  it('作成→読み込み→更新で、版番号が上がり、AI草案は変わらない', async () => {
    const s = makeStore();
    const created = await s.create(ALICE, KEY, { aiDraft: DRAFT, userEdits: { 'action:1:title': '案A' }, adopted: false });
    expect(created.status).toBe('SAVED');
    const loaded = await s.load(BOB, KEY);
    expect(loaded.status === 'FOUND' && loaded.record.userEdits).toEqual({ 'action:1:title': '案A' });
    const up = await s.update(BOB, KEY, 1, { userEdits: { 'action:1:title': '案B' }, adopted: true });
    expect(up.status === 'SAVED' && up.record.version).toBe(2);
    const again = await s.load(ALICE, KEY);
    expect(again.status === 'FOUND' && again.record.aiDraft).toEqual(DRAFT);
  });

  it('古い版番号での更新は競合として、最新の内容を返す（上書きしない）', async () => {
    const s = makeStore();
    await s.create(ALICE, KEY, { aiDraft: DRAFT, userEdits: {}, adopted: false });
    await s.update(BOB, KEY, 1, { userEdits: { x: 'bob' }, adopted: false });
    const stale = await s.update(ALICE, KEY, 1, { userEdits: { x: 'alice' }, adopted: false });
    expect(stale.status === 'CONFLICT' && stale.current.userEdits).toEqual({ x: 'bob' });
    const after = await s.load(ALICE, KEY);
    expect(after.status === 'FOUND' && after.record.userEdits).toEqual({ x: 'bob' });
  });

  it('他社の会社のメンバーは、読むことも書くこともできない', async () => {
    const s = makeStore();
    await s.create(ALICE, KEY, { aiDraft: DRAFT, userEdits: {}, adopted: false });
    expect(await s.load(OUTSIDER, KEY)).toEqual({ status: 'DENIED' });
    expect(await s.update(OUTSIDER, KEY, 1, { userEdits: { x: 'y' }, adopted: false })).toEqual({ status: 'DENIED' });
    expect(await s.load(OUTSIDER, { ...KEY, companyId: CO_B })).toEqual({ status: 'DENIED' });
  });

  it('戦略が会社のものでなければ拒否する', async () => {
    const s = makeStore();
    expect(await s.load(ALICE, { ...KEY, strategyId: 'fict-strategy-b' })).toEqual({ status: 'DENIED' });
  });

  it('並び替え・名称変更の後も、同じプロジェクトIDで同じ計画に対応する', async () => {
    let raw: string | null = null;
    const storage = { read: () => raw, write: (v: string) => { raw = v; } };
    await makeStore(storage).create(ALICE, KEY, { aiDraft: DRAFT, userEdits: { k: 'v' }, adopted: false });
    const moved = (): StrategyRow[] => {
      const list = strategies();
      const depts = list[0].departments as Array<{ projects: Array<Record<string, unknown>> }>;
      depts[0].projects.reverse();
      depts[0].projects[1].title = '既存顧客との保守契約（名称変更後）';
      return list;
    };
    const loaded = await makeStore(storage, moved).load(ALICE, KEY);
    expect(loaded.status === 'FOUND' && loaded.record.userEdits).toEqual({ k: 'v' });
  });

  it('プロジェクトが存在しなければ、読み込みは何もない（NONE）、書き込みは対象なし（NOT_FOUND）', async () => {
    const s = makeStore();
    const missing = { ...KEY, projectId: 'no-such-project' };
    expect(await s.load(ALICE, missing)).toEqual({ status: 'NONE' });
    expect(await s.create(ALICE, missing, { aiDraft: DRAFT, userEdits: {}, adopted: false })).toEqual({ status: 'NOT_FOUND' });
  });

  it('保存の失敗は失敗として返し、保存先は変わらない', async () => {
    const s = makeStore();
    s.failNext('write');
    const out = await s.create(ALICE, KEY, { aiDraft: DRAFT, userEdits: {}, adopted: false });
    expect(out.status).toBe('FAILED');
    expect(s.records()).toHaveLength(0);
  });

  it('保存先の記録は、再起動（同じ保存先から作り直す）の後も残る', async () => {
    let raw: string | null = null;
    const storage = { read: () => raw, write: (v: string) => { raw = v; } };
    await makeStore(storage).create(ALICE, KEY, { aiDraft: DRAFT, userEdits: { a: '1' }, adopted: false });
    const reopened = await makeStore(storage).load(ALICE, KEY);
    expect(reopened.status === 'FOUND' && reopened.record.userEdits).toEqual({ a: '1' });
  });
});

describe('保存の手順（persistDraft）', () => {
  it('新規は作成し、版1で保存できたと返す', async () => {
    const s = makeStore();
    const r = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local: { a: '1' }, adopted: false, stored: null });
    expect(r.status === 'SAVED' && r.stored.version).toBe(1);
  });

  it('同時に別の人が保存していても、重ならない修正は自動で統合する', async () => {
    const s = makeStore();
    const first = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local: { a: '1', b: '1' }, adopted: false, stored: null });
    if (first.status !== 'SAVED') throw new Error('保存されるはず');
    s.simulateRemoteSave(KEY, { a: '1', b: '9' }, 'bob');
    const local = { a: '2', b: '1' };
    const r = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local, adopted: false, stored: first.stored });
    expect(r.status === 'SAVED' && r.mergedFromRemote).toBe(true);
    expect(r.status === 'SAVED' && r.userEdits).toEqual({ a: '2', b: '9' });
    expect(local).toEqual({ a: '2', b: '1' });
  });

  it('同じ項目を別々に変えていれば、競合として返し、自分の修正は残る', async () => {
    const s = makeStore();
    const first = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local: { a: '1' }, adopted: false, stored: null });
    if (first.status !== 'SAVED') throw new Error('保存されるはず');
    s.simulateRemoteSave(KEY, { a: 'bob の修正' }, 'bob');
    const local = { a: 'alice の修正' };
    const r = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local, adopted: false, stored: first.stored });
    expect(r.status === 'CONFLICT' && r.conflicts).toEqual(['a']);
    expect(local).toEqual({ a: 'alice の修正' });
    if (r.status !== 'CONFLICT') return;
    const resolved = resolveUserEdits({ base: first.stored.base, local: r.local, remote: r.remote.userEdits, picks: { a: 'local' } });
    const again = await persistDraft({
      store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local: resolved, adopted: false,
      stored: { version: r.remote.version, base: r.remote.userEdits, adopted: false },
    });
    expect(again.status === 'SAVED' && again.userEdits).toEqual({ a: 'alice の修正' });
  });

  it('保存に失敗したら FAILED を返し、編集は変わらない（成功と見せない）', async () => {
    const s = makeStore();
    const local = { a: '未保存の修正' };
    s.failNext('write');
    const r = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local, adopted: true, stored: null });
    expect(r.status).toBe('FAILED');
    expect(local).toEqual({ a: '未保存の修正' });
    expect(s.records()).toHaveLength(0);
  });

  it('他社の人の保存は DENIED を返す', async () => {
    const s = makeStore();
    const r = await persistDraft({ store: s, actor: OUTSIDER, key: KEY, aiDraft: DRAFT, local: {}, adopted: false, stored: null });
    expect(r).toEqual({ status: 'DENIED' });
  });

  it('同時に新規作成した場合は、競合として返す（上書きしない）', async () => {
    const s = makeStore();
    await s.create(BOB, KEY, { aiDraft: DRAFT, userEdits: { a: 'bob' }, adopted: false });
    const r = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local: { a: 'alice' }, adopted: false, stored: null });
    expect(r.status === 'CONFLICT' && r.remote.userEdits).toEqual({ a: 'bob' });
  });

  it('採用の状態も、保存の対象として保つ', async () => {
    const s = makeStore();
    const r = await persistDraft({ store: s, actor: ALICE, key: KEY, aiDraft: DRAFT, local: {}, adopted: true, stored: null });
    const loaded = await s.load(BOB, KEY);
    expect(r.status === 'SAVED' && r.adopted).toBe(true);
    expect(loaded.status === 'FOUND' && loaded.record.adopted).toBe(true);
    const stored: StoredState = r.status === 'SAVED' ? r.stored : { version: 0, base: {}, adopted: false };
    expect(stored.adopted).toBe(true);
  });
});
