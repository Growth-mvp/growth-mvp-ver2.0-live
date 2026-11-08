import type { FinanceEffect } from '@/types/strategy';
import { buildFinanceEffectCandidate } from './financeEffectCandidate';
import {
  answerMeaning,
  answerOperatingIncome,
  answerTiming,
  answerValidity,
  effectiveAnswers,
  nextFinanceQuestion,
  readyToConfirm,
  resetAnswer,
  syncEffectWithAssumptions,
} from './financeQuestions';

const AI_REVENUE = { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 };
const AI_COST = { currentCostMJPY: 120, reductionRatePct: 10 };

function candidate(role: 'REVENUE' | 'COST' = 'REVENUE'): FinanceEffect {
  const r = buildFinanceEffectCandidate({
    role,
    assumptions: role === 'REVENUE' ? AI_REVENUE : AI_COST,
    rationale: '既存顧客の保守契約更新（架空）',
    origin: 'AI_PROPOSED',
  });
  if (!r.ok) throw new Error(r.reason);
  return r.effect;
}

describe('AIの質問：次の1問だけを選ぶ', () => {
  it('売上の候補は、まず数字の妥当性を聞く', () => {
    expect(nextFinanceQuestion('REVENUE', candidate())).toBe('validity');
  });

  it('回答の順序は、妥当性 → 売上の意味 → 発生時期 → 営業利益（任意）', () => {
    let e = candidate();
    e = answerValidity(e, 'OK');
    expect(nextFinanceQuestion('REVENUE', e)).toBe('meaning');
    e = answerMeaning(e, 'YES');
    expect(nextFinanceQuestion('REVENUE', e)).toBe('timing');
    e = answerTiming(e, { startYm: '2026-04', amountBasis: 'ANNUAL' });
    expect(nextFinanceQuestion('REVENUE', e)).toBe('operatingIncome');
    e = answerOperatingIncome(e, 'UNKNOWN');
    expect(nextFinanceQuestion('REVENUE', e)).toBeNull();
  });

  it('既存売上に含まれると答えた場合は、続きを聞かず財務試算に加えない', () => {
    const e = answerMeaning(answerValidity(candidate(), 'OK'), 'NO');
    expect(nextFinanceQuestion('REVENUE', e)).toBeNull();
    expect(readyToConfirm('REVENUE', e)).toBe(false);
  });

  it('費用削減は、妥当性と発生時期の2問だけ聞く（売上の意味・営業利益は聞かない）', () => {
    let e = candidate('COST');
    expect(nextFinanceQuestion('COST', e)).toBe('validity');
    e = answerValidity(e, 'OK');
    expect(nextFinanceQuestion('COST', e)).toBe('timing');
    e = answerTiming(e, { startYm: '2026-04', amountBasis: 'ANNUAL' });
    expect(nextFinanceQuestion('COST', e)).toBeNull();
  });

  it('確認済みの効果は、質問しない（既存の確認済みデータを守る）', () => {
    const e: FinanceEffect = { ...candidate(), confirmed: true };
    expect(nextFinanceQuestion('REVENUE', e)).toBeNull();
  });

  it('利用者が入力したが回答のない効果では、既存の値から回答を推定し、同じ質問を繰り返さない', () => {
    const legacy: FinanceEffect = {
      kind: 'REVENUE_UP',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 120_000_000,
      source: 'USER_INPUT',
      confirmed: false,
      meetingBasisConfirmed: true,
      isIncremental: true,
      amountBasis: 'ANNUAL',
      startYm: '2026-04',
    };
    expect(effectiveAnswers(legacy)).toMatchObject({ validity: 'OK', meaning: 'YES', timing: 'SET' });
    expect(nextFinanceQuestion('REVENUE', legacy)).toBe('operatingIncome');
  });

  it('NOT_FINANCIAL（非財務）や投資（FUTURE）では質問しない', () => {
    expect(nextFinanceQuestion('REVENUE', { ...candidate(), kind: 'NOT_FINANCIAL' })).toBeNull();
    expect(nextFinanceQuestion('FUTURE', candidate())).toBeNull();
  });
});

describe('AIの質問：「まだ分からない」は記録し、数値を埋めない', () => {
  it('「まだ分からない」は回答として残り、次の質問に進む（同じ質問を繰り返さない）', () => {
    const e = answerValidity(candidate(), 'UNKNOWN');
    expect(effectiveAnswers(e).validity).toBe('UNKNOWN');
    expect(e.meetingBasisConfirmed).toBe(false);
    expect(nextFinanceQuestion('REVENUE', e)).toBe('meaning');
  });

  it('発生時期が分からない場合は、開始月と単位を空のままにする', () => {
    const e = answerTiming(candidate(), 'UNKNOWN');
    expect(e.startYm).toBeUndefined();
    expect(e.amountBasis).toBeUndefined();
    expect(effectiveAnswers(e).timing).toBe('UNKNOWN');
  });

  it('営業利益が分からない場合は未算定のまま（利益を推定しない）', () => {
    const e = answerOperatingIncome(candidate(), 'UNKNOWN');
    expect(e.operatingIncomeEffectYen).toBeUndefined();
  });

  it('営業利益の入力は百万円から円に換算する', () => {
    expect(answerOperatingIncome(candidate(), 30).operatingIncomeEffectYen).toBe(30_000_000);
  });
});

describe('回答の取り消し', () => {
  it('売上の意味を取り消すと、同じ質問を聞き直せる（既存売上に含まれる → 追加に変えられる）', () => {
    const no = answerMeaning(answerValidity(candidate(), 'OK'), 'NO');
    const reset = resetAnswer(no, 'meaning');
    expect(nextFinanceQuestion('REVENUE', reset)).toBe('meaning');
    expect(readyToConfirm('REVENUE', answerMeaning(reset, 'YES'))).toBe(false);
  });

  it('妥当性を取り消すと、推定に戻らず聞き直す（妥当性は既存フラグからも推定されない）', () => {
    const ok = answerValidity(candidate(), 'OK');
    expect(nextFinanceQuestion('REVENUE', resetAnswer(ok, 'validity'))).toBe('validity');
  });

  it('発生時期を取り消すと、開始月と単位も空に戻る', () => {
    const set = answerTiming(candidate(), { startYm: '2026-04', amountBasis: 'ANNUAL' });
    const reset = resetAnswer(set, 'timing');
    expect(reset.startYm).toBeUndefined();
    expect(reset.amountBasis).toBeUndefined();
  });
});

describe('確認ボタンの条件', () => {
  const complete = (e: FinanceEffect) => answerTiming(answerMeaning(answerValidity(e, 'OK'), 'YES'), { startYm: '2026-04', amountBasis: 'ANNUAL' });

  it('売上は、妥当性・既存売上への追加・発生時期がそろうと確認できる', () => {
    expect(readyToConfirm('REVENUE', complete(candidate()))).toBe(true);
  });

  it('妥当性を修正して確認した場合も確認できる', () => {
    const e = complete(answerValidity(candidate(), 'EDITED'));
    expect(readyToConfirm('REVENUE', e)).toBe(true);
  });

  it('一つでも「まだ分からない」があれば確認できない', () => {
    expect(readyToConfirm('REVENUE', answerValidity(candidate(), 'UNKNOWN'))).toBe(false);
    expect(readyToConfirm('REVENUE', answerMeaning(answerValidity(candidate(), 'OK'), 'UNKNOWN'))).toBe(false);
    expect(readyToConfirm('REVENUE', answerTiming(answerMeaning(answerValidity(candidate(), 'OK'), 'YES'), 'UNKNOWN'))).toBe(false);
  });

  it('費用削減は、既存売上の確認を求めない', () => {
    const e = answerTiming(answerValidity(candidate('COST'), 'OK'), { startYm: '2026-04', amountBasis: 'ANNUAL' });
    expect(readyToConfirm('COST', e)).toBe(true);
  });
});

describe('算定前提の修正を、未確認の候補に反映する', () => {
  const prevOrigin = 'AI_PROPOSED' as const;
  const rationale = '既存顧客の保守契約更新（架空）';

  it('対象顧客数を変えると、未確認の候補の計算値が新しい前提に変わり、妥当性の回答は取り消す', () => {
    const e = answerValidity(candidate(), 'OK');
    const next = syncEffectWithAssumptions({
      effect: e,
      role: 'REVENUE',
      prevAssumptions: AI_REVENUE,
      nextAssumptions: { ...AI_REVENUE, targetCustomers: 40 },
      rationale,
      prevOrigin,
      nextOrigin: 'USER_INPUT',
    });
    expect(next).toMatchObject({ meetingsPerPeriod: 40, winRatePct: 20, averageDealYen: 20_000_000, meetingBasisConfirmed: false });
    expect(effectiveAnswers(next!).validity).toBeUndefined();
    expect(next!.sourceNote).toContain('算定式：40社 × 20% × 20百万円 = 160百万円');
  });

  it('修正後は出所を利用者の入力として記録し、AI提案の確認条件を緩めない（出所の表示を正しくする）', () => {
    const next = syncEffectWithAssumptions({
      effect: candidate(),
      role: 'REVENUE',
      prevAssumptions: AI_REVENUE,
      nextAssumptions: { ...AI_REVENUE, targetCustomers: 40 },
      rationale,
      prevOrigin,
      nextOrigin: 'USER_INPUT',
    });
    expect(next!.source).toBe('USER_INPUT');
    expect(next!.sourceNote).toContain('利用者が入力・修正');
  });

  it('利用者が入力した時期・営業利益・根拠文は残す', () => {
    const e: FinanceEffect = {
      ...answerOperatingIncome(answerTiming(candidate(), { startYm: '2026-07', amountBasis: 'MONTHLY' }), 5),
      sourceNote: '取引先ヒアリングの結果を追記',
    };
    const next = syncEffectWithAssumptions({
      effect: e,
      role: 'REVENUE',
      prevAssumptions: AI_REVENUE,
      nextAssumptions: { ...AI_REVENUE, targetCustomers: 40 },
      rationale,
      prevOrigin,
      nextOrigin: 'USER_INPUT',
    });
    expect(next).toMatchObject({ startYm: '2026-07', amountBasis: 'MONTHLY', operatingIncomeEffectYen: 5_000_000 });
    expect(next!.sourceNote).toBe('取引先ヒアリングの結果を追記');
  });

  it('確認済みの効果は、前提を変えても変わらない', () => {
    const e: FinanceEffect = { ...candidate(), confirmed: true };
    expect(
      syncEffectWithAssumptions({
        effect: e,
        role: 'REVENUE',
        prevAssumptions: AI_REVENUE,
        nextAssumptions: { ...AI_REVENUE, targetCustomers: 40 },
        rationale,
        prevOrigin,
        nextOrigin: 'USER_INPUT',
      }),
    ).toBeUndefined();
  });

  it('数値が変わらなければ、何もしない', () => {
    expect(
      syncEffectWithAssumptions({
        effect: candidate(),
        role: 'REVENUE',
        prevAssumptions: AI_REVENUE,
        nextAssumptions: { ...AI_REVENUE },
        rationale,
        prevOrigin,
        nextOrigin: 'AI_PROPOSED',
      }),
    ).toBeUndefined();
  });
});
