// /components/home/PyramidNavigator.tsx
'use client';

import React from 'react';
import Link from 'next/link';

const VBW = 1500;
const VBH = 780;

const TRI = {
  apex: { x: 500, y: 40 },
  left: { x: 60, y: 760 },
  right: { x: 940, y: 760 },
  div1Ratio: 0.34,
  div2Ratio: 0.66,
  lineInset: 1,
  label: {
    size: 32,
    weight: 700,
    trackEm: 0.05,
    topYOffset: 30,
    midYOffset: 20,
    botYOffset: 16,
  },
  stroke: {
    boundary: { w: 1.25, color: 'rgba(15,28,38,0.88)' },
    divider: { w: 1.05, color: 'rgba(15,28,38,0.65)' },
  },
};

const LAYER_FILLS = {
  top: 'rgba(15,23,42,0.032)',
  mid: 'rgba(15,23,42,0.042)',
  bot: 'rgba(15,23,42,0.052)',
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TRI_H = TRI.right.y - TRI.apex.y;
const Y_DIV1 = TRI.apex.y + TRI_H * TRI.div1Ratio;
const Y_DIV2 = TRI.apex.y + TRI_H * TRI.div2Ratio;

const xOnEdge = (p1: { x: number; y: number }, p2: { x: number; y: number }, y: number) => {
  const t = (y - p1.y) / (p2.y - p1.y);
  return lerp(p1.x, p2.x, t);
};

const xLeftAt = (y: number) => xOnEdge(TRI.apex, TRI.left, y);
const xRightAt = (y: number) => xOnEdge(TRI.apex, TRI.right, y);

const Y_L_TOP = (TRI.apex.y + Y_DIV1) / 2 + TRI.label.topYOffset;
const Y_L_MID = (Y_DIV1 + Y_DIV2) / 2 + TRI.label.midYOffset;
const Y_L_BOT = (Y_DIV2 + TRI.right.y) / 2 + TRI.label.botYOffset;

const btnClass =
  'flex h-[48px] w-[180px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 shadow-sm transition-colors hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2';

const desktopButtons = [
  { href: '/stage1', label: 'STAGE1：企業価値分析', title: '企業価値分析' },
  { href: '/stage2', label: 'STAGE2：経営戦略策定', title: '経営戦略策定' },
  { href: '/cascade', label: 'STAGE3：部門戦略策定', title: '部門戦略策定' },
  { href: '/okr', label: 'STAGE4：実行計画策定', title: '実行計画策定' },
];

const stageGuide = [
  {
    stage: 'STAGE1',
    title: '企業価値分析',
    description: '現状の業績、資本効率、成長課題を整理し、変革が必要な論点を見える化します。',
    owner: '主に：経営層・財務責任者',
  },
  {
    stage: 'STAGE2',
    title: '経営戦略策定',
    description: '全社の勝ち筋と戦略ストーリーを定め、どの方向へ進むかを明確にします。',
    owner: '主に：経営陣・事業責任者',
  },
  {
    stage: 'STAGE3',
    title: '部門戦略策定',
    description: '各部門の役割、ミッション、重点施策を設計し、全社戦略を現場へ展開します。',
    owner: '主に：部門長・マネージャー',
  },
  {
    stage: 'STAGE4',
    title: '実行計画策定',
    description: 'プロジェクトとKPIに落とし込み、誰が何を実行するかを具体化します。',
    owner: '主に：プロジェクト責任者・現場担当者',
  },
];

export default function PyramidNavigator() {
  return (
    <div className="relative mx-auto w-full max-w-6xl">
      {/* desktop : B案（relative + absolute） */}
      <div className="hidden lg:block">
        <div className="relative min-h-[430px]">
          {/* pyramid area */}
          <div className="absolute left-0 top-0 h-[430px] w-[88%]">
            <div className="flex h-full items-start justify-center">
              <div className="relative h-[470px] w-full max-w-[860px]">
                <svg
                  viewBox={`0 0 ${VBW} ${VBH}`}
                  className="absolute inset-0 h-full w-full"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <polygon
                    points={[
                      `${TRI.apex.x},${TRI.apex.y}`,
                      `${xRightAt(Y_DIV1)},${Y_DIV1}`,
                      `${xLeftAt(Y_DIV1)},${Y_DIV1}`,
                    ].join(' ')}
                    fill={LAYER_FILLS.top}
                  />
                  <polygon
                    points={[
                      `${xLeftAt(Y_DIV1)},${Y_DIV1}`,
                      `${xRightAt(Y_DIV1)},${Y_DIV1}`,
                      `${xRightAt(Y_DIV2)},${Y_DIV2}`,
                      `${xLeftAt(Y_DIV2)},${Y_DIV2}`,
                    ].join(' ')}
                    fill={LAYER_FILLS.mid}
                  />
                  <polygon
                    points={[
                      `${xLeftAt(Y_DIV2)},${Y_DIV2}`,
                      `${xRightAt(Y_DIV2)},${Y_DIV2}`,
                      `${TRI.right.x},${TRI.right.y}`,
                      `${TRI.left.x},${TRI.left.y}`,
                    ].join(' ')}
                    fill={LAYER_FILLS.bot}
                  />

                  <polygon
                    points={`${TRI.apex.x},${TRI.apex.y} ${TRI.left.x},${TRI.left.y} ${TRI.right.x},${TRI.right.y}`}
                    fill="transparent"
                    stroke={TRI.stroke.boundary.color}
                    strokeWidth={TRI.stroke.boundary.w}
                  />

                  <line
                    x1={xLeftAt(Y_DIV1) + TRI.lineInset}
                    y1={Y_DIV1}
                    x2={xRightAt(Y_DIV1) - TRI.lineInset}
                    y2={Y_DIV1}
                    stroke={TRI.stroke.divider.color}
                    strokeWidth={TRI.stroke.divider.w}
                  />
                  <line
                    x1={xLeftAt(Y_DIV2) + TRI.lineInset}
                    y1={Y_DIV2}
                    x2={xRightAt(Y_DIV2) - TRI.lineInset}
                    y2={Y_DIV2}
                    stroke={TRI.stroke.divider.color}
                    strokeWidth={TRI.stroke.divider.w}
                  />

                  <text
                    x={TRI.apex.x}
                    y={Y_L_TOP}
                    textAnchor="middle"
                    fontSize={TRI.label.size}
                    fontWeight={TRI.label.weight}
                    fill="#0f172a"
                    style={{ letterSpacing: `${TRI.label.trackEm}em` }}
                  >
                    TOP
                  </text>
                  <text
                    x={TRI.apex.x}
                    y={Y_L_MID}
                    textAnchor="middle"
                    fontSize={TRI.label.size}
                    fontWeight={TRI.label.weight}
                    fill="#0f172a"
                    style={{ letterSpacing: `${TRI.label.trackEm}em` }}
                  >
                    MIDDLE
                  </text>
                  <text
                    x={TRI.apex.x}
                    y={Y_L_BOT}
                    textAnchor="middle"
                    fontSize={TRI.label.size}
                    fontWeight={TRI.label.weight}
                    fill="#0f172a"
                    style={{ letterSpacing: `${TRI.label.trackEm}em` }}
                  >
                    BOTTOM
                  </text>
                </svg>
              </div>
            </div>
          </div>

          {/* buttons area */}
          <div className="absolute left-[60%] top-1/2 flex -translate-y-1/2 flex-col gap-6">
            {desktopButtons.map((item) => (
              <Link key={item.href} href={item.href} prefetch className={btnClass} title={item.title}>
                <span className="block w-full whitespace-nowrap text-center text-[13px] font-semibold leading-none text-neutral-900">
                  {item.label}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-2 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-5">
          <div className="text-[12px] font-semibold tracking-[0.12em] text-neutral-500">GUIDE</div>
          <div className="mt-1 text-sm font-semibold text-neutral-900">戦略策定の流れ</div>
          <div className="mt-4 space-y-3">
            {stageGuide.map((item) => (
              <div
                key={item.stage}
                className="grid grid-cols-[108px_1fr] gap-3 border-t border-neutral-200/80 pt-3 first:border-t-0 first:pt-0"
              >
                <div className="text-[12px] font-semibold text-neutral-700">
                  {item.stage}
                  <div className="mt-0.5 text-[11px] font-medium text-neutral-500">{item.title}</div>
                </div>
                <div>
                  <div className="text-[12px] leading-5 text-neutral-600">{item.description}</div>
                  <div className="mt-1 text-[11px] font-medium text-neutral-500">{item.owner}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* tablet / mobile */}
      <div className="mt-4 space-y-3 lg:hidden">
        {desktopButtons.map((b) => (
          <Link
            key={b.href}
            href={b.href}
            className="flex items-center justify-between rounded-2xl border border-neutral-300 bg-white px-5 py-3 shadow-sm transition-colors hover:bg-neutral-100"
          >
            <span className="text-base font-semibold text-neutral-900">{b.label}</span>
            <span className="text-neutral-400">→</span>
          </Link>
        ))}

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4">
          <div className="text-[12px] font-semibold tracking-[0.12em] text-neutral-500">GUIDE</div>
          <div className="mt-1 text-sm font-semibold text-neutral-900">戦略策定の流れ</div>
          <div className="mt-3 space-y-3">
            {stageGuide.map((item) => (
              <div key={item.stage} className="border-t border-neutral-200/80 pt-3 first:border-t-0 first:pt-0">
                <div className="text-[12px] font-semibold text-neutral-700">
                  {item.stage}：{item.title}
                </div>
                <div className="mt-1 text-[12px] leading-5 text-neutral-600">{item.description}</div>
                <div className="mt-1 text-[11px] font-medium text-neutral-500">{item.owner}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}