// /utils/financeSimulation.ts

/* =========================================================
 * 荳ｻ隕゜PI縺ｮ譛域ｬ｡繝・Ν繧ｿ 竊・譛域ｬ｡/蟷ｴ谺｡PL縺ｮ險育ｮ暦ｼ磯ｲ蛹也沿・・
 * ---------------------------------------------------------
 * - 謨ｰ驥湘怜腰萓｡ﾃ礼ｶ咏ｶ夂紫 繧貞渕譛ｬ縺ｫ 螢ｲ荳・繧堤ｮ怜・
 * - CHURN(隗｣邏・縺ｨRETENTION(邯咏ｶ・縺ｮ荳｡邉ｻ邨ｱ縺ｫ蟇ｾ蠢・
 * - 螟牙虚雋ｻ縺ｯ縲碁≡鬘阪崎ｶｳ縺苓ｾｼ縺ｿ or 縲檎紫・・ogsRate・峨肴欠螳壹・荳｡蟇ｾ蠢・
 * - 逶ｸ荵怜柑譫・謚戊ｳ・・邁｡譏灘渚譏・域・蜉溽紫縺ｯ蟆・擂諡｡蠑ｵ・・
 *
 * 笘・・繧､繝ｳ繝茨ｼ井ｻ雁屓菫ｮ豁｣・俄・
 * - OKR縺ｮ繧､繝ｳ繝代け繝茨ｼ・eltas・峨′螳悟・縺ｫ 0 縺ｮ縺ｨ縺阪・縲・
 *   繝吶・繧ｹ霆碁％・・aseTrajectory・峨◎縺ｮ縺ｾ縺ｾ縺ｮPL繧定ｿ斐☆縲・
 *   竊・OKR繧剃ｽ輔ｂ蜈･繧後※縺・↑縺・→縺阪↓縲∝｣ｲ荳翫′蜍晄焔縺ｫ邵ｮ蟆上＠縺ｪ縺・・
 * - deltas 縺後≠繧九→縺阪〒繧ゅ・
 *   縲後・繝ｼ繧ｹ謨ｰ驥・qtyMonthly 縺ｯ縺昴・縺ｾ縺ｾ邯ｭ謖√阪＠縲・
 *   縺昴・荳翫↓ 窶懷｢玲ｸ帛・ deltaQty窶・繧堤ｴｯ遨阪☆繧区婿蠑上↓螟画峩縲・
 *   竊・隗｣邏・紫・・hurn・峨・蠖ｱ髻ｿ縺ｯ蠅玲ｸ帛・縺縺代↓蜉ｹ縺上◆繧√・
 *      OKR縺ｮ險ｭ螳壹′縲後・繝ｼ繧ｹ蜈ｨ菴薙・蟠ｩ螢翫阪↓縺ｯ縺ｪ繧峨↑縺・・
 * ========================================================= */

import type { Ym, DeltasByMonth } from './stage6Bridge';

/* ========== 蜈･蜉帙ョ繝ｼ繧ｿ螳夂ｾｩ ========== */
// 繝吶・繧ｹ縺ｮ譛域ｬ｡繝医Λ繝・け・・KR莉句・縺檎┌縺九▲縺溷ｴ蜷医・霆碁％・・
export type BaseTrajectory = {
  startYm: Ym;
  endYm: Ym;
  // 謨ｰ驥擾ｼ井ｾ具ｼ壽怏蜉ｹ鬘ｧ螳｢謨ｰ or 雋ｩ螢ｲ謨ｰ驥擾ｼ峨・譛域ｬ｡繝吶・繧ｹ蛟､
  qtyMonthly: Record<Ym, number>;
  // 蜊倅ｾ｡・亥・・・
  arpuMonthly: Record<Ym, number>;
  // 譛域ｬ｡隗｣邏・紫・・.02=2%・・
  churnMonthly: Record<Ym, number>;
  // 繧ｳ繧ｹ繝茨ｼ亥・・・
  fixedCostMonthly: Record<Ym, number>;
  variableCostMonthly: Record<Ym, number>; // 驥鷹｡阪〒縺ｮ繝吶・繧ｹ・育紫謖・ｮ壹・蝣ｴ蜷医・蜿り・→縺励※菴ｿ逕ｨ・・
  personnelCostMonthly: Record<Ym, number>;
  // 蜿り・ｼ壹・繝ｼ繧ｹ螢ｲ荳奇ｼ域怦谺｡・峨√≠繧後・邇・耳螳壹↓菴ｿ逕ｨ
  revenueMonthly?: Record<Ym, number>;
};

// 繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ縺ｮ險育ｮ励が繝励す繝ｧ繝ｳ
export type SimulationOptions = {
  // 逶ｸ荵怜柑譫懶ｼ・ynergy・峨・驕ｩ逕ｨ蜈茨ｼ亥ｰ・擂諡｡蠑ｵ蜿ｯ・・
  applySynergyTo?: Array<'revenue' | 'cost'>;
  // 謌仙粥邇・・謇ｱ縺・ｼ域兜雉・柑譫懊∈謗帙￠繧九√↑縺ｩ縺ｮ蟆・擂諡｡蠑ｵ逕ｨ・・
  investEffectAlpha?: number; // 謚戊ｳ・・蠖捺悄雋ｻ逕ｨ蛹悶・蜑ｲ蜷茨ｼ・縲・縲∵圻螳夲ｼ・
};

// 譛域ｬ｡邨先棡
export type MonthlyPL = {
  ym: Ym;
  qty: number;
  arpu: number;
  churn: number; // 螳溷柑隗｣邏・紫・・縲・・・
  // 螢ｲ荳・
  revenue: number;
  // 繧ｳ繧ｹ繝茨ｼ亥・・・
  fixed_cost: number;
  variable_cost: number;
  personnel_cost: number;
  // 險・
  cogs: number;         // 螟牙虚雋ｻ繧・COGS 縺ｨ莉ｮ鄂ｮ縺・
  sga: number;          // 蝗ｺ螳夲ｼ倶ｺｺ莉ｶ雋ｻ繧・SG&A 縺ｨ莉ｮ鄂ｮ縺・
  gross_profit: number;
  op_income: number;
  margin: number;       // 蝟ｶ讌ｭ蛻ｩ逶顔紫
};

// 蟷ｴ谺｡髮・ｨ・
export type YearlyPL = {
  year: number;
  revenue: number;
  cogs: number;
  sga: number;
  gross_profit: number;
  op_income: number;
  margin: number;
};

/* ========== 繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ・亥ｹｴ譛亥・逅・ｼ・========== */
function ymToYearMonth(y: Ym) {
  const [Y, M] = y.split('-').map(Number);
  return { Y, M };
}
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function nextYm(y: Ym): Ym {
  const { Y, M } = ymToYearMonth(y);
  const nM = M === 12 ? 1 : M + 1;
  const nY = M === 12 ? Y + 1 : Y;
  return `${nY}-${pad(nM)}` as Ym;
}
function ymRange(startYm: Ym, endYm: Ym): Ym[] {
  const out: Ym[] = [];
  let cur = startYm;
  while (cur <= endYm) {
    out.push(cur);
    cur = nextYm(cur);
  }
  return out;
}

/* ========== 螳牙・繧ｯ繝ｪ繝・・遲・========== */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const nz = (v?: number) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;

/* =========================================================
 * OKR縺ｮ繝・Ν繧ｿ繧偵・繝ｼ繧ｹ霆碁％縺ｫ蜿肴丐縺励∵怦谺｡PL繧堤函謌撰ｼ域僑蠑ｵ迚茨ｼ・
 * ---------------------------------------------------------
 * - retention/churn 荳｡蟇ｾ蠢・
 * - variable_cost 繧偵碁≡鬘阪腔r縲檎紫・・ogsRate・峨阪・荳｡譁ｹ縺ｫ蟇ｾ蠢・
 * - synergy・・邇・ｼ峨・螢ｲ荳翫・縺ｿ・上さ繧ｹ繝医↓繧る←逕ｨ縺ｮ謖・ｮ壹ｒ繧ｵ繝昴・繝・
 *
 * 笘・ｻ雁屓縺ｮ驥崎ｦ∽ｻ墓ｧ倪・
 * - deltas 縺悟・譛滄俣繝ｻ蜈ｨ鬆・岼縺ｧ 0 縺ｮ蝣ｴ蜷医・縲・
 *   BaseTrajectory 繧偵◎縺ｮ縺ｾ縺ｾPL蛹悶＠縺ｦ霑斐☆・茨ｼ昴・繝ｼ繧ｹ繝ｩ繧､繝ｳ縺ｨ蜷後§・峨・
 *   竊・OKR縺御ｽ輔ｂ險ｭ螳壹＆繧後※縺・↑縺・憾諷九〒縺ｯ縲後・繝ｼ繧ｹ160蜆・・縺ｾ縺ｾ・上う繝ｳ繝代け繝・縲阪↓縺ｪ繧九・
 * - deltas 縺後≠繧句ｴ蜷医〒繧ゅ√・繝ｼ繧ｹ謨ｰ驥・qtyMonthly 縺ｯ縺昴・縺ｾ縺ｾ谿九＠縲・
 *   縺昴・荳翫↓縲悟｢玲ｸ帛・ deltaQty縲阪ｒ邏ｯ遨阪＠縺ｦ縺・￥縲・
 *   竊・隗｣邏・紫縺ｮ蠖ｱ髻ｿ縺ｯ窶懷｢玲ｸ帛・窶昴↓縺縺大柑縺阪√・繝ｼ繧ｹ縺ｯ蟠ｩ螢翫＠縺ｪ縺・・
 * ========================================================= */
export function simulateMonthlyPL(
  base: BaseTrajectory,
  deltas: DeltasByMonth & {
    // 霑ｽ蜉: 邇・ｳｻ・亥ｭ伜惠縺吶ｌ縺ｰ菴ｿ逕ｨ・・
    retention?: Record<Ym, number>;   // +0.01 縺ｧ邯咏ｶ夂紫1pt謾ｹ蝟・ｼ亥ｮ溷柑churn繧剃ｸ九￡繧具ｼ・
    cogsRate?: Record<Ym, number>;    // 螟牙虚雋ｻ邇・・蠅玲ｸ幢ｼ・0.01縺ｧ1pt謔ｪ蛹厄ｼ・
  },
  opt?: SimulationOptions
): MonthlyPL[] {
  const applySynergyTo = opt?.applySynergyTo ?? ['revenue']; // 譌｢螳壹・螢ｲ荳雁・縺ｮ縺ｿ
  const months = ymRange(base.startYm, base.endYm);

  /* ---------- 1. deltas 縺悟ｮ悟・縺ｫ 0 縺九←縺・°繧貞愛螳・---------- */
  const hasAnyDelta = months.some((ym) => {
    const vals = [
      deltas.acq?.[ym],
      deltas.arpu?.[ym],
      deltas.churn?.[ym],
      deltas.retention?.[ym],
      deltas.revenue?.[ym],
      deltas.fixed_cost?.[ym],
      deltas.variable_cost?.[ym],
      deltas.personnel_cost?.[ym],
      deltas.synergy?.[ym],
      deltas.cogsRate?.[ym],
      deltas.invest?.[ym],
    ];
    return vals.some((v) => typeof v === 'number' && Math.abs(v) > 1e-9);
  });

  /* ---------- 2. 繝・Ν繧ｿ縺ｪ縺・竍・繝吶・繧ｹ霆碁％縺昴・縺ｾ縺ｾ繧定ｿ斐☆ ---------- */
  if (!hasAnyDelta) {
    const out: MonthlyPL[] = [];

    for (const ym of months) {
      const baseQty    = Math.max(0, nz(base.qtyMonthly[ym]));
      const baseArpu   = Math.max(0, nz(base.arpuMonthly[ym]));
      const baseChurn  = clamp01(nz(base.churnMonthly[ym]));
      const baseFixed  = Math.max(0, nz(base.fixedCostMonthly[ym]));
      const baseVarAmt = Math.max(0, nz(base.variableCostMonthly[ym]));
      const basePers   = Math.max(0, nz(base.personnelCostMonthly[ym]));

      const revenue =
        Math.max(0, nz(base.revenueMonthly?.[ym])) ||
        Math.max(0, baseQty * baseArpu);

      const variable = baseVarAmt;
      const fixed = baseFixed;
      const personnel = basePers;

      const cogs = variable;
      const sga = fixed + personnel;
      const gross_profit = revenue - cogs;
      const op_income = revenue - (cogs + sga);
      const margin = revenue > 0 ? op_income / revenue : 0;

      out.push({
        ym,
        qty: baseQty,
        arpu: baseArpu,
        churn: baseChurn,
        revenue,
        fixed_cost: fixed,
        variable_cost: variable,
        personnel_cost: personnel,
        cogs,
        sga,
        gross_profit,
        op_income,
        margin,
      });
    }

    return out;
  }

  /* ---------- 3. 繝・Ν繧ｿ縺ゅｊ 竍・繝吶・繧ｹ・句｢玲ｸ帛・deltaQty縺ｧ繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ ---------- */
  const out: MonthlyPL[] = [];

  // 繝吶・繧ｹ縺九ｉ縺ｮ縲悟｢玲ｸ帛・縲阪・縺ｿ繧堤ｴｯ遨阪☆繧・
  let deltaQtyPrev = 0;

  for (const ym of months) {
    const baseQty    = Math.max(0, nz(base.qtyMonthly[ym]));
    const baseArpu   = Math.max(0, nz(base.arpuMonthly[ym]));
    const baseChurn  = clamp01(nz(base.churnMonthly[ym])); // 諠・ｱ縺ｨ縺励※菫晄戟
    const baseFixed  = Math.max(0, nz(base.fixedCostMonthly[ym]));
    const baseVarAmt = Math.max(0, nz(base.variableCostMonthly[ym])); // 驥鷹｡阪・繝ｼ繧ｹ
    const basePers   = Math.max(0, nz(base.personnelCostMonthly[ym]));

    // 繝・Ν繧ｿ・医↑縺代ｌ縺ｰ0・・
    const dAcq      = nz(deltas.acq?.[ym]);
    const dArpu     = nz(deltas.arpu?.[ym]);
    const dChurn    = nz(deltas.churn?.[ym]);       // 邇・・螟牙喧・・縺ｧ謔ｪ蛹厄ｼ俄ｻ繝吶・繧ｹ縺九ｉ縺ｮ蟾ｮ蛻・→縺励※謇ｱ縺・
    const dRet      = nz(deltas.retention?.[ym]);   // 邇・・螟牙喧・・縺ｧ邯咏ｶ壽隼蝟・churn貂帛ｰ托ｼ・
    const dRevenue  = nz(deltas.revenue?.[ym]);     // 驥鷹｡・
    const dFixed    = nz(deltas.fixed_cost?.[ym]);  // 驥鷹｡・
    const dVarAmt   = nz(deltas.variable_cost?.[ym]);// 驥鷹｡阪→縺励※謇ｱ縺・・
    const dPers     = nz(deltas.personnel_cost?.[ym]);// 驥鷹｡・
    const dSynergy  = nz(deltas.synergy?.[ym]);     // 邇・ｼ・0.05縺ｧ+5%・・
    const dCogsRate = nz(deltas.cogsRate?.[ym]);    // 螟牙虚雋ｻ邇・・蠅玲ｸ幢ｼ・縺ｧ謔ｪ蛹厄ｼ・
    const invest    = nz(deltas.invest?.[ym]);      // 驥鷹｡搾ｼ夷ｱ荳驛ｨ雋ｻ逕ｨ蛹厄ｼ・

    // 螳溷柑churn邇・ｼ域ュ蝣ｱ逕ｨ・会ｼ喘aseChurn + 蟾ｮ蛻・
    const churnRate = clamp01(baseChurn + dChurn - dRet);

    // 笘・㍾隕・ｼ壽焚驥上・縲後・繝ｼ繧ｹ + 蠅玲ｸ帛・縲阪〒險育ｮ励☆繧・
    // - baseQty 縺ｯ縺昴・譛医・窶懃ｴ縺ｮ窶晁ｻ碁％・医・繝ｼ繧ｹ・・
    // - deltaQty 縺ｯ OKR 逕ｱ譚･縺ｮ蠅玲ｸ帛・縺縺代ｒ邏ｯ遨・
    const prevDeltaQty = deltaQtyPrev;
    const qPrev = baseQty + prevDeltaQty;

    // churn/retention 縺ｯ縲後・繝ｼ繧ｹ縺九ｉ縺ｮ蟾ｮ蛻・阪→縺励※縲・
    // 蠅玲ｸ帛・縺ｫ縺縺大柑縺九○繧九う繝｡繝ｼ繧ｸ・医・繝ｼ繧ｹ閾ｪ菴薙・蟠ｩ縺輔↑縺・ｼ・
    const churnDelta = dChurn - dRet; // >0 縺ｧ謔ｪ蛹悶・0 縺ｧ謾ｹ蝟・

    // 蠅玲ｸ帛・縺ｮ譖ｴ譁ｰ・單eltaQty_next = deltaQty_prev + 譁ｰ隕冗佐蠕・- (qPrev * churnDelta)
    const deltaQtyNext = Math.max(
      0,
      prevDeltaQty + dAcq - qPrev * churnDelta,
    );

    const qty = Math.max(0, baseQty + deltaQtyNext);
    deltaQtyPrev = deltaQtyNext;

    // 蜊倅ｾ｡・壹・繝ｼ繧ｹ・句ｷｮ蛻・
    const arpu = Math.max(0, baseArpu + dArpu);

    // 螢ｲ荳奇ｼ亥渕譛ｬ・会ｼ嘔ty * arpu
    let revenueCore = Math.max(0, qty * arpu);

    // 螢ｲ荳翫∈逶ｴ謗･蜉邂暦ｼ・EVENUE KR 遲会ｼ・
    revenueCore += Math.max(0, dRevenue);

    // 逶ｸ荵怜柑譫懶ｼ・邇・ｼ峨ｒ螢ｲ荳翫↓驕ｩ逕ｨ
    if (applySynergyTo.includes('revenue')) {
      revenueCore *= (1 + dSynergy);
    }
    const revenue = Math.max(0, revenueCore);

    // 螟牙虚雋ｻ・夐≡鬘崎ｶｳ縺苓ｾｼ縺ｿ or 邇・〒險育ｮ励・荳｡蟇ｾ蠢・
    let variable: number;
    if (dCogsRate !== 0) {
      // 繝吶・繧ｹ縺ｮ螟牙虚雋ｻ邇・ｒ謗ｨ螳夲ｼ亥庄閭ｽ縺ｪ繧峨・繝ｼ繧ｹ螢ｲ荳翫°繧峨∫┌縺代ｌ縺ｰ驥鷹｡・蜀・函螢ｲ荳翫〒霑台ｼｼ・・
      const baseSales =
        (base.revenueMonthly?.[ym] ??
          (baseQty * baseArpu)) ||
        (revenueCore - dRevenue);
      const safeSales = Math.max(1, baseSales); // 0蜑ｲ蝗樣∩
      const estBaseCogsRate = clamp01(baseVarAmt / safeSales);
      const appliedRate = clamp01(estBaseCogsRate + dCogsRate);
      variable = Math.max(0, appliedRate * revenueCore);
    } else {
      variable = Math.max(0, baseVarAmt + dVarAmt);
    }

    // 蝗ｺ螳夊ｲｻ繝ｻ莠ｺ莉ｶ雋ｻ・域兜雉・・荳驛ｨ蠖捺悄雋ｻ逕ｨ蛹厄ｼ・
    let fixed = Math.max(
      0,
      baseFixed + dFixed + invest * (opt?.investEffectAlpha ?? 0),
    );
    let personnel = Math.max(0, basePers + dPers);

    // 繧ｳ繧ｹ繝亥・縺ｫ繧ら嶌荵怜柑譫懊ｒ驕ｩ逕ｨ縺吶ｋ謖・ｮ壹↑繧・
    if (applySynergyTo.includes('cost')) {
      fixed *= (1 + dSynergy);
      variable *= (1 + dSynergy);
      personnel *= (1 + dSynergy);
    }

    const cogs = variable;
    const sga = fixed + personnel;
    const gross_profit = revenue - cogs;
    const op_income = revenue - (cogs + sga);
    const margin = revenue > 0 ? op_income / revenue : 0;

    out.push({
      ym,
      qty,
      arpu,
      churn: churnRate,
      revenue,
      fixed_cost: fixed,
      variable_cost: variable,
      personnel_cost: personnel,
      cogs,
      sga,
      gross_profit,
      op_income,
      margin,
    });
  }

  return out;
}

/**
 * 蟷ｴ谺｡髮・ｨ茨ｼ域圜蟷ｴ縺ｧ蜊倡ｴ泌粋邂暦ｼ・
 * - 12繝ｶ譛域悴貅縺ｮ遶ｯ謨ｰ蟷ｴ縺ｯ蜈･縺｣縺ｦ縺・ｋ蛻・□縺大粋邂・
 */
export function aggregateYearly(monthlies: MonthlyPL[]): YearlyPL[] {
  const byYear = new Map<number, YearlyPL>();

  for (const m of monthlies) {
    const year = Number(m.ym.slice(0, 4));
    const prev = byYear.get(year) ?? {
      year,
      revenue: 0, cogs: 0, sga: 0,
      gross_profit: 0, op_income: 0, margin: 0,
    };

    prev.revenue += m.revenue;
    prev.cogs += m.cogs;
    prev.sga += m.sga;
    prev.gross_profit += m.gross_profit;
    prev.op_income += m.op_income;

    byYear.set(year, prev);
  }

  // margin 蜀崎ｨ育ｮ・
  const out: YearlyPL[] = [];
  for (const y of Array.from(byYear.keys()).sort((a, b) => a - b)) {
    const v = byYear.get(y)!;
    v.margin = v.revenue > 0 ? v.op_income / v.revenue : 0;
    out.push(v);
  }
  return out;
}
