import { seededId } from './okrModels';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('seededId（画面を開き直しても同じKRのIDになる）', () => {
  it('同じ入力からは同じUUIDの形のIDを返す', () => {
    const id = seededId('d1::p1::kr::売上を伸ばす');
    expect(id).toMatch(UUID_SHAPE);
    expect(seededId('d1::p1::kr::売上を伸ばす')).toBe(id);
  });

  it('入力が違えば、違うIDを返す（部門・施策・文言のどれが違っても）', () => {
    const base = seededId('d1::p1::kr::売上を伸ばす');
    expect(seededId('d2::p1::kr::売上を伸ばす')).not.toBe(base);
    expect(seededId('d1::p2::kr::売上を伸ばす')).not.toBe(base);
    expect(seededId('d1::p1::kr::解約率を下げる')).not.toBe(base);
  });
});
