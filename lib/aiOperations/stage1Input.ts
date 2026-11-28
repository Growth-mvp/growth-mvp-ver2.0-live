// 利用者の明確な入力・修正依頼を、STAGE1の入力操作として決定的に読み取る（AIは呼ばない）。
// 対象（事業・経営課題・年度・項目）や値が特定・検証できない場合は、保存せず確認を求める。
import { industryOptions } from '@/utils/industryTemplates';
import { EMPLOYEE_BANDS, OVERSEAS_LOCATION, PREFECTURES } from '@/lib/stage1/companyProfile';
import { OVERSEAS_REGION_OPTIONS } from '@/lib/stage1/businessExpansion';
import { BS_FIELDS, PL_FIELDS } from '@/lib/stage1/financeFields';
import { normalizeFiscalYearEnd } from '@/utils/stage6/fiscalYear';
import { ISSUE_DESCRIPTION_MAX, ISSUE_TITLE_MAX, isNegatedOrDeferred } from './consultOperation';
import { parseYenAmounts } from './instruction';

export type ProfileField = 'companyName' | 'industry' | 'location' | 'employees' | 'fiscalYearEnd';
export type SegmentTextField = 'summary' | 'keyCustomers' | 'overseasRegions';
export type FinanceTable = 'pl' | 'bs';
export type IssueEditField = 'title' | 'description' | 'scope' | 'linkedMetrics';

export type StageOp =
  | { kind: 'profile'; field: ProfileField; value: string; display: string }
  | { kind: 'segment.add'; name: string }
  | { kind: 'segment.rename'; from: string; to: string }
  | { kind: 'segment.set'; name: string; field: SegmentTextField; value: string | string[] | null }
  | { kind: 'segment.remove'; id: string; name: string }
  | { kind: 'finance'; table: FinanceTable; key: string; label: string; year: number; yen: number | null; segment?: string; expectedBefore?: number | null }
  | { kind: 'wacc'; pct: number | null }
  | { kind: 'issue.add'; title: string; description: string }
  | { kind: 'issue.edit'; title: string; field: IssueEditField; value: string | string[] | null }
  | { kind: 'issue.remove'; title: string }
  | { kind: 'valuation' };

export type ChatStageAction = { kind: 'handover' } | { kind: 'save' } | { kind: 'undo' };

export type RemovalTarget = { type: 'segment' | 'issue'; name: string };

export type Stage1InputResult =
  | { kind: 'op'; op: StageOp; confirm: boolean }
  | { kind: 'action'; action: ChatStageAction }
  | { kind: 'remove'; target: RemovalTarget }
  | { kind: 'clarify'; message: string };

export type Stage1InputContext = {
  segmentNames: string[];
  issueTitles: string[];
  financeYen: (args: { table: FinanceTable; key: string; year: number; segment?: string }) => number | null;
};

const SEGMENT_MAX = 10;
const SEGMENT_NAME_MAX = 40;
const KEY_CUSTOMERS_MAX = 3;
const KEY_CUSTOMER_MAX = 40;
const SUMMARY_MAX = 200;
const COMPANY_NAME_MAX = 100;

const ISSUE_METRICS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'operatingMargin', label: '営業利益率' },
  { key: 'revenueCAGR', label: '売上成長率' },
  { key: 'debtEquityRatio', label: 'D/Eレシオ' },
  { key: 'roic', label: 'ROIC' },
  { key: 'wacc', label: 'WACC' },
  { key: 'pbr', label: 'PBR' },
];

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const unquote = (s: string) => s.replace(/^[「『"'\s]+|[」』"'\s]+$/g, '');
const sameName = (a: string, b: string) => norm(unquote(a)) === norm(unquote(b));

// 「に変更してください」「です」など、指示の語尾。語尾が無い発言は指示として扱わない
const DIRECTIVE_TAIL =
  /(?:に|へ)?(?:変更|修正|訂正|更新|登録|設定|記入|入力)(?:して|し|する|します)?(?:ください|おいて|しておいて|しておく|お願いします|ほしい)?$|(?:に|へ)?(?:して|する)(?:ください|おいて|お願いします)?$|(?:です|でした|でお願いします|でお願い)$/;
// 仮定・検討・希望の発言は、入力の指示として扱わない
const HYPOTHETICAL = /もし|かも|かな|べき|たい|検討|考え|でしょう|ではないか|どうか/;
const AMOUNT_BODY = /^(?:[\d,.億万千百十円▲△\-−\s]|マイナス|赤字|損失)+$/;

function directiveValue(rest: string): string | null {
  const s = norm(rest).replace(/^[、,，\s]+/, '').replace(/[。.!！]+$/, '');
  if (!DIRECTIVE_TAIL.test(s)) return null;
  const value = unquote(s.replace(DIRECTIVE_TAIL, ''));
  return value === '' ? null : value;
}

/** 金額の文言（「500万円」「▲300万円」「1億6,000万円」）を円の符号付きの値にする。金額が1つに決まらなければ null */
function amountValue(rest: string): number | null {
  const s = norm(rest).replace(/[。.!！]+$/, '');
  const body = (DIRECTIVE_TAIL.test(s) ? s.replace(DIRECTIVE_TAIL, '') : s).trim();
  if (!AMOUNT_BODY.test(body)) return null;
  const amounts = parseYenAmounts(body);
  if (amounts.length !== 1) return null;
  const negative = /▲|△|マイナス|赤字|損失|[-−]/.test(body);
  return negative ? -amounts[0] : amounts[0];
}

function employeeBandOf(n: number): string | null {
  if (n < 1) return null;
  if (n < 20) return '1〜19';
  if (n < 50) return '20〜49';
  if (n < 100) return '50〜99';
  if (n < 300) return '100〜299';
  if (n < 1000) return '300〜999';
  return '1000以上';
}

const clarify = (message: string): Stage1InputResult => ({ kind: 'clarify', message });

function profileResult(field: ProfileField, value: string): Stage1InputResult {
  if (field === 'companyName') {
    if (value.length > COMPANY_NAME_MAX || /[\r\n]/.test(value)) return clarify(`会社名は${COMPANY_NAME_MAX}字以内で指示してください。`);
    return { kind: 'op', op: { kind: 'profile', field, value, display: value }, confirm: false };
  }
  if (field === 'industry') {
    const hit = industryOptions.find((o) => o.label === value || o.labelShort === value || o.value === value);
    if (!hit) return clarify(`業種は「${industryOptions.map((o) => o.label).join('」「')}」の中から指示してください。`);
    return { kind: 'op', op: { kind: 'profile', field, value: hit.value, display: hit.label }, confirm: false };
  }
  if (field === 'location') {
    if ((PREFECTURES as readonly string[]).includes(value)) {
      return { kind: 'op', op: { kind: 'profile', field, value, display: value }, confirm: false };
    }
    const overseas = value.match(/^海外(?:[:：]\s*(.*))?$/);
    if (overseas) {
      const detail = (overseas[1] ?? '').trim().slice(0, 100);
      const stored = detail ? `${OVERSEAS_LOCATION}：${detail}` : OVERSEAS_LOCATION;
      return { kind: 'op', op: { kind: 'profile', field, value: stored, display: stored }, confirm: false };
    }
    return clarify('本社所在地は都道府県（例：東京都）か「海外」で指示してください。');
  }
  if (field === 'employees') {
    const band = EMPLOYEE_BANDS.find((b) => b.value === value || b.label === value);
    if (band) return { kind: 'op', op: { kind: 'profile', field, value: band.value, display: band.label }, confirm: false };
    const m = value.match(/^(\d{1,7})\s*(?:名|人)?$/);
    const band2 = m ? employeeBandOf(Number(m[1])) : null;
    if (!m || !band2) return clarify('従業員数は人数（例：30名）で指示してください。');
    const label = EMPLOYEE_BANDS.find((b) => b.value === band2)?.label ?? band2;
    return { kind: 'op', op: { kind: 'profile', field, value: band2, display: `${Number(m[1])}名（${label}）` }, confirm: false };
  }
  const m = value.match(/^(\d{1,2})\s*月?\s*(?:末|決算)?$/);
  const month = m ? normalizeFiscalYearEnd(Number(m[1])) : '';
  if (!month) return clarify('決算月は1〜12月で指示してください（例：3月決算）。');
  return { kind: 'op', op: { kind: 'profile', field, value: month, display: `${Number(month)}月` }, confirm: false };
}

function findSegment(names: string[], name: string): string | null {
  return names.find((n) => sameName(n, name)) ?? null;
}

/** 文の先頭が登録中の事業名で、続く部分が指定の形に合うものを探す（「製造事業」のように名前に「事業」を含む場合も切り分ける） */
function segmentPrefix(names: string[], text: string, rest: RegExp): { name: string; m: RegExpMatchArray } | null {
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    if (!n || !text.startsWith(n)) continue;
    const m = text.slice(n.length).match(rest);
    if (m) return { name: n, m };
  }
  return null;
}

function findIssue(titles: string[], title: string): string | null {
  return titles.find((t) => sameName(t, title)) ?? null;
}

function financeLabelMatch(label: string): { table: FinanceTable; key: string; label: string } | null {
  const pl = PL_FIELDS.find((f) => f.label === label);
  if (pl) return { table: 'pl', key: pl.key, label: pl.label };
  const bs = BS_FIELDS.find((f) => f.label === label);
  if (bs) return { table: 'bs', key: bs.key, label: bs.label };
  return null;
}

function financeResult(
  target: { table: FinanceTable; key: string; label: string },
  year: number,
  yen: number,
  ctx: Stage1InputContext,
  segment?: string,
): Stage1InputResult {
  const before = ctx.financeYen({ table: target.table, key: target.key, year, segment });
  const confirm =
    before !== null && before !== 0 && (Math.sign(yen) !== Math.sign(before) || Math.abs(yen - before) > Math.abs(before) * 0.5);
  const op: StageOp = {
    kind: 'finance',
    table: target.table,
    key: target.key,
    label: target.label,
    year,
    yen,
    ...(segment ? { segment } : {}),
    ...(confirm ? { expectedBefore: before } : {}),
  };
  return { kind: 'op', op, confirm };
}

function isValidYear(text: string): number | null {
  const year = Number(text);
  return year >= 1990 && year <= 2100 ? year : null;
}

/** 利用者の発言を、STAGE1の入力操作として読み取る。入力操作でなければ null（通常の相談に任せる） */
export function resolveStage1Input(raw: string, ctx: Stage1InputContext): Stage1InputResult | null {
  const text = norm(raw).replace(/[。.!！]+$/, '');
  if (!text || text.length > 300) return null;
  // 取り消しの依頼は、「取り消し」という語を含むが否定ではない
  if (/^(?:直前の|さっきの|今の)?(?:入力|変更|反映|内容)?を?(?:取り消して|取り消し|取り消す|取消して|元に戻して|戻して)$/.test(text)) {
    return { kind: 'action', action: { kind: 'undo' } };
  }
  if (isNegatedOrDeferred(text) || HYPOTHETICAL.test(text) || /[?？]$|か$/.test(text)) return null;

  if (/^(?:STAGE2)(?:に|へ)(?:進|移|引き渡|引渡)/.test(text)) return { kind: 'action', action: { kind: 'handover' } };
  if (/^(?:この内容を)?保存(?:して|してください|しておいて)?$/.test(text)) return { kind: 'action', action: { kind: 'save' } };
  if (/初期化|全データ|全部(?:消|削除)/.test(text)) return clarify('全データの初期化は、この画面からは行えません。');

  // 登録済みの事業・経営課題の削除（影響は、確認の前に調べる）
  const segmentRemove = text.match(/^事業(?:セグメント)?[「『]?(.+?)[」』]?を削除(?:して|してください)?$/);
  if (segmentRemove) {
    const name = findSegment(ctx.segmentNames, segmentRemove[1]);
    if (!name) return clarify(`事業「${unquote(segmentRemove[1])}」が見つかりません。登録中の事業: ${ctx.segmentNames.join('、') || 'なし'}`);
    return { kind: 'remove', target: { type: 'segment', name } };
  }
  const issueRemove = text.match(/^経営課題[「『](.+?)[」』]を削除(?:して|してください)?$/);
  if (issueRemove) {
    const title = findIssue(ctx.issueTitles, issueRemove[1]);
    if (!title) return clarify(`経営課題「${unquote(issueRemove[1])}」が見つかりません。登録中の経営課題の題名を「」で示してください。`);
    return { kind: 'remove', target: { type: 'issue', name: title } };
  }
  if (/^(?:先ほど|さっき)?の?経営課題を削除/.test(text)) {
    return clarify('どの経営課題を削除するかを「」で示してください（例：「経営課題「新規顧客の獲得が鈍い」を削除して」）。');
  }
  if (/^企業価値分析を(?:更新|再計算|計算し直|計算|やり直)(?:して|し直して)?(?:ください)?$/.test(text)) {
    return { kind: 'op', op: { kind: 'valuation' }, confirm: false };
  }

  // 経営課題の題名・説明・対象範囲・根拠となる指標の修正（対象は「」で示された題名で特定する）
  const issueEdit = text.match(/^経営課題[「『](.+?)[」』]の(説明文|説明|題名|タイトル|対象範囲|根拠となる指標|根拠|指標)を(.+)$/);
  if (issueEdit) {
    const title = findIssue(ctx.issueTitles, issueEdit[1]);
    if (!title) {
      return clarify(`経営課題「${unquote(issueEdit[1])}」が見つかりません。登録中の経営課題の題名を「」で示してください。`);
    }
    const target = issueEdit[2];
    if (target === '対象範囲') {
      const v = directiveValue(issueEdit[3]);
      if (v !== '全社' && v !== '事業') return clarify('対象範囲は「全社」か「事業」で指示してください。');
      return { kind: 'op', op: { kind: 'issue.edit', title, field: 'scope', value: v === '全社' ? 'company' : 'business' }, confirm: false };
    }
    if (target === '根拠となる指標' || target === '根拠' || target === '指標') {
      const v = directiveValue(issueEdit[3]);
      const keys = (v ?? '').split(/[、,，・\s]+|と|および/).map((s) => s.trim()).filter(Boolean);
      const mapped = keys.map((k) => ISSUE_METRICS.find((m) => m.label === k || m.key === k)?.key);
      if (!v || keys.length === 0 || mapped.some((k) => !k)) {
        return clarify(`根拠となる指標は「${ISSUE_METRICS.map((m) => m.label).join('」「')}」から指示してください。`);
      }
      return { kind: 'op', op: { kind: 'issue.edit', title, field: 'linkedMetrics', value: mapped as string[] }, confirm: false };
    }
    const v = directiveValue(issueEdit[3]);
    if (!v) return clarify(`変更後の文を「〜に修正して」の形で教えてください。`);
    if (target === '説明文' || target === '説明') {
      if (v.length > ISSUE_DESCRIPTION_MAX) return clarify(`説明文は${ISSUE_DESCRIPTION_MAX}字以内で指示してください。`);
      return { kind: 'op', op: { kind: 'issue.edit', title, field: 'description', value: v }, confirm: false };
    }
    if (v.length > ISSUE_TITLE_MAX) return clarify(`題名は${ISSUE_TITLE_MAX}字以内で指示してください。`);
    if (ctx.issueTitles.some((t) => sameName(t, v))) return clarify('同じ題名の経営課題がすでにあるため、変更しません。');
    return { kind: 'op', op: { kind: 'issue.edit', title, field: 'title', value: v }, confirm: false };
  }
  if (/^(?:先ほど|さっき|前の|今の|この)?(?:の)?経営課題の(?:説明文|説明|題名|タイトル|対象範囲|根拠となる指標|根拠|指標)を/.test(text)) {
    return clarify('どの経営課題かを「」で示してください（例：「経営課題「新規顧客の獲得が鈍い」の説明を〜に修正して」）。');
  }

  const wacc = text.match(/^WACC(?:は|を)?(\d+(?:\.\d+)?)(?:%|パーセント)?(?:です|に(?:変更|修正|訂正|更新)(?:して|し|する|します)?(?:ください)?|に(?:して|する)(?:ください)?)?$/i);
  if (wacc) {
    const pct = Number(wacc[1]);
    if (!(pct > 0 && pct < 100)) return clarify('WACCは0より大きく100未満のパーセントで指示してください。');
    return { kind: 'op', op: { kind: 'wacc', pct }, confirm: false };
  }

  // 事業セグメント：追加・名称変更
  const add = text.match(/^事業(?:セグメント)?(?:に|へ)(.+?)を(?:追加|登録|新設)(?:して|し|する)?(?:ください|おいて)?$/);
  if (add) {
    const name = unquote(add[1]);
    if (!name || name.length > SEGMENT_NAME_MAX) return clarify(`事業名は1〜${SEGMENT_NAME_MAX}字で指示してください。`);
    if (ctx.segmentNames.some((n) => sameName(n, name))) return clarify(`「${name}」という事業はすでにあります。`);
    if (ctx.segmentNames.length >= SEGMENT_MAX) return clarify(`事業は${SEGMENT_MAX}件までです。`);
    return { kind: 'op', op: { kind: 'segment.add', name }, confirm: false };
  }
  const renameA = segmentPrefix(
    ctx.segmentNames,
    text,
    /^(?:事業|事業セグメント)?の(?:事業名|名称|名前)を(.+?)に(?:変更|修正|訂正)(?:して|し|する|します)?(?:ください)?$/,
  );
  const renameB = renameA ? null : text.match(/^事業名を(.+?)から(.+?)に(?:変更|修正)(?:してください|する)?$/);
  const renamePair = renameA
    ? { from: renameA.name, to: renameA.m[1] }
    : renameB
      ? { from: renameB[1], to: renameB[2] }
      : null;
  if (renamePair) {
    const from = findSegment(ctx.segmentNames, renamePair.from);
    if (!from) return clarify(`事業「${unquote(renamePair.from)}」が見つかりません。登録中の事業: ${ctx.segmentNames.join('、') || 'なし'}`);
    const to = unquote(renamePair.to);
    if (!to || to.length > SEGMENT_NAME_MAX) return clarify(`事業名は1〜${SEGMENT_NAME_MAX}字で指示してください。`);
    if (ctx.segmentNames.some((n) => !sameName(n, from) && sameName(n, to))) return clarify(`「${to}」という事業はすでにあります。`);
    return { kind: 'op', op: { kind: 'segment.rename', from, to }, confirm: false };
  }

  // 事業別の財務（年度・項目・金額）
  const segFinance = segmentPrefix(ctx.segmentNames, text, /^(?:事業|事業セグメント)?の(\d{4})年度の(.+?)は(.+)$/);
  const segFinanceLoose = segFinance ? null : text.match(/^(.+?)事業の(\d{4})年度の(.+?)は(.+)$/);
  if (segFinance || segFinanceLoose) {
    const m = segFinance ? segFinance.m.slice(1) : (segFinanceLoose as RegExpMatchArray).slice(2);
    const name = segFinance ? segFinance.name : (segFinanceLoose as RegExpMatchArray)[1];
    const target = financeLabelMatch(m[1]);
    if (target) {
      const seg = segFinance ? segFinance.name : findSegment(ctx.segmentNames, name);
      if (!seg) return clarify(`事業「${unquote(name)}」が見つかりません。先に事業として追加してください。`);
      const yen = amountValue(m[2]);
      if (yen === null) return null;
      const year = isValidYear(m[0]);
      if (year === null) return clarify('年度は1990〜2100年の西暦で指示してください。');
      return financeResult(target, year, yen, ctx, seg);
    }
  }

  // 事業の説明・顧客・展開地域
  const segTextPrefix = segmentPrefix(
    ctx.segmentNames,
    text,
    /^(?:事業|事業セグメント)?の(主な顧客|主要顧客|事業概要|概要|海外展開地域|海外の展開地域|展開地域|主な展開地域)(?:は|を)(.+)$/,
  );
  const segTextLoose = segTextPrefix ? null : text.match(/^(.+?)事業の(主な顧客|主要顧客|事業概要|概要|海外展開地域|海外の展開地域|展開地域|主な展開地域)(?:は|を)(.+)$/);
  if (segTextPrefix || segTextLoose) {
    const segName = segTextPrefix ? segTextPrefix.name : (segTextLoose as RegExpMatchArray)[1];
    const seg = segTextPrefix ? segTextPrefix.name : findSegment(ctx.segmentNames, segName);
    if (!seg) return clarify(`事業「${unquote(segName)}」が見つかりません。先に「事業に${unquote(segName)}を追加して」と指示してください。`);
    const body = segTextPrefix ? segTextPrefix.m.slice(1) : (segTextLoose as RegExpMatchArray).slice(2);
    const v = directiveValue(body[1]);
    if (!v) return clarify('内容は「〜です」か「〜に変更して」の形で指示してください。');
    const field = body[0];
    if (field === '主な顧客' || field === '主要顧客') {
      const list = v.split(/[、,，・]/).map((s) => s.trim()).filter(Boolean);
      if (list.length === 0 || list.length > KEY_CUSTOMERS_MAX) return clarify(`主な顧客は1〜${KEY_CUSTOMERS_MAX}件で指示してください。`);
      if (list.some((c) => c.length > KEY_CUSTOMER_MAX)) return clarify(`顧客の名称は${KEY_CUSTOMER_MAX}字以内で指示してください。`);
      return { kind: 'op', op: { kind: 'segment.set', name: seg, field: 'keyCustomers', value: list }, confirm: false };
    }
    if (field === '事業概要' || field === '概要') {
      if (v.length > SUMMARY_MAX) return clarify(`事業概要は${SUMMARY_MAX}字以内で指示してください。`);
      return { kind: 'op', op: { kind: 'segment.set', name: seg, field: 'summary', value: v }, confirm: false };
    }
    const regions = v.split(/[、,，・]/).map((s) => s.trim()).filter(Boolean);
    const unknown = regions.filter((r) => !(OVERSEAS_REGION_OPTIONS as readonly string[]).includes(r));
    if (regions.length === 0 || unknown.length > 0) {
      return clarify(`展開地域は「${(OVERSEAS_REGION_OPTIONS as readonly string[]).join('」「')}」から指示してください。`);
    }
    return { kind: 'op', op: { kind: 'segment.set', name: seg, field: 'overseasRegions', value: regions }, confirm: false };
  }

  // 全社の財務（年度・項目・金額）。売上高は、全社売上高の入力として従来の解釈に任せる
  const finance = text.match(/^(\d{4})年度の(.+?)は(.+)$/);
  if (finance && finance[2] !== '売上高') {
    const target = financeLabelMatch(finance[2]);
    if (target) {
      const yen = amountValue(finance[3]);
      if (yen === null) return null;
      const year = isValidYear(finance[1]);
      if (year === null) return clarify('年度は1990〜2100年の西暦で指示してください。');
      return financeResult(target, year, yen, ctx);
    }
  }

  // 会社の基本情報
  const profile = text.match(/^(会社名|業種|本社所在地|所在地|従業員数|決算月)(?:を|は)(.+)$/);
  if (profile) {
    const field: ProfileField =
      profile[1] === '会社名'
        ? 'companyName'
        : profile[1] === '業種'
          ? 'industry'
          : profile[1] === '従業員数'
            ? 'employees'
            : profile[1] === '決算月'
              ? 'fiscalYearEnd'
              : 'location';
    const v = directiveValue(profile[2]);
    if (!v) return clarify(`${profile[1]}は「〜に変更して」か「〜です」の形で指示してください。`);
    return profileResult(field, v);
  }

  return null;
}
