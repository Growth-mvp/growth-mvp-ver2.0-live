'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

/* ===== 調整ノブ（ピラミッドや線は固定、ボタンだけ微調整） ===== */

const VBW = 1500; // viewBox width
const VBH = 750;  // viewBox height

const TRI = {
  apex:  { x: 500, y: 90 },
  left:  { x: 160, y: 660 },
  right: { x: 840, y: 660 },
  div1Ratio: 0.34,   // TOP/MIDDLE
  div2Ratio: 0.66,   // MIDDLE/BOTTOM
  lineInset: 1,
  label: {
    size: 30,
    weight: 700,
    trackEm: 0.05,
    topYOffset: +30,
    midYOffset: +20,
    botYOffset: +15,
  },
  stroke: {
    boundary: { w: 1.2, color: 'rgba(0,0,0,0.16)' },
    divider:  { w: 1.0, color: 'rgba(0,0,0,0.12)' },
    connect:  { w: 1.2, color: 'rgba(0,0,0,0.26)' },
  },
};

// 接続線の終点（=ボタン左端のX）。*線とボタンはここで同じXに*
const LINE_TO_X_PCT = 65;

/** ボタンデータ
 *  y は “接続線の高さ”（固定） / dy は “ボタンだけ” の微調整（-上 +下）
 *  subtitle, status は任意。
 */
type Status = 'not_started' | 'in_progress' | 'done';
type Connect = {
  y: number;
  label: string;
  href: string;
  dy?: number;
  subtitle?: string;
  status?: Status;
};
const CONNECTS: Connect[] = [
  { y: 180, label: 'STAGE 1：経営基本情報', href: '/strategy',      dy: 10, subtitle: '基本情報・MVV' },
  { y: 250, label: 'STAGE 2：経営戦略策定', href: '/story-process',         subtitle: '仮説→最終ストーリー' },
  { y: 360, label: 'STAGE 3：部門戦略策定', href: '/cascade',      dy: -15, subtitle: '部門ミッション/PJ' },
  { y: 530, label: 'STAGE 4：実行計画策定', href: '/okr',          dy: -50, subtitle: '目標・成果(OKR)' },
  { y: 590, label: 'STAGE 5：実行支援',     href: '/execution',    dy: -48, subtitle: '実行・可視化' },
];

/* ===== 計算系 ===== */
const lerp = (a:number,b:number,t:number)=>a+(b-a)*t;
const TRI_H = TRI.right.y - TRI.apex.y;
const Y_DIV1 = TRI.apex.y + TRI_H * TRI.div1Ratio;
const Y_DIV2 = TRI.apex.y + TRI_H * TRI.div2Ratio;
const xOnEdge = (p1:{x:number;y:number}, p2:{x:number;y:number}, y:number) => {
  const t = (y - p1.y) / (p2.y - p1.y);
  return lerp(p1.x, p2.x, t);
};
const lineX1 = (y:number) => xOnEdge(TRI.apex, TRI.left,  y) + TRI.lineInset;
const lineX2 = (y:number) => xOnEdge(TRI.apex, TRI.right, y) - TRI.lineInset;
const Y_L_TOP = ((TRI.apex.y + Y_DIV1) / 2)           + TRI.label.topYOffset;
const Y_L_MID = ((Y_DIV1     + Y_DIV2) / 2)           + TRI.label.midYOffset;
const Y_L_BOT = ((Y_DIV2     + TRI.right.y) / 2)      + TRI.label.botYOffset;
const LINE_TO_X = (LINE_TO_X_PCT / 100) * VBW;

/* ========================================================= */

export default function PyramidNavigator() {
  // ホバー/フォーカス中の行を保持して、線を強調表示
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  return (
    <div className="relative mx-auto w-full max-w-6xl">
      <div className="relative hidden md:block">
        <div className="relative aspect-[5/3]">
          {/* 背景SVG（線やピラミッドはここで固定） */}
          <svg
            viewBox={`0 0 ${VBW} ${VBH}`}
            className="absolute inset-0 h-full w-full pointer-events-none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="gloss" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.60" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>

            <polygon
              points={`${TRI.apex.x},${TRI.apex.y} ${TRI.left.x},${TRI.left.y} ${TRI.right.x},${TRI.right.y}`}
              fill="rgba(255,255,255,0.66)"
              stroke={TRI.stroke.boundary.color}
              strokeWidth={TRI.stroke.boundary.w}
            />
            <polygon
              points={`${TRI.apex.x},${TRI.apex.y} ${TRI.left.x},${TRI.left.y} ${TRI.right.x},${TRI.right.y}`}
              fill="url(#gloss)"
              opacity={0.20}
            />

            {/* 区切り線 */}
            <line x1={lineX1(Y_DIV1)} x2={lineX2(Y_DIV1)} y1={Y_DIV1} y2={Y_DIV1}
                  stroke={TRI.stroke.divider.color} strokeWidth={TRI.stroke.divider.w} />
            <line x1={lineX1(Y_DIV2)} x2={lineX2(Y_DIV2)} y1={Y_DIV2} y2={Y_DIV2}
                  stroke={TRI.stroke.divider.color} strokeWidth={TRI.stroke.divider.w} />

            {/* ラベル */}
            <text x={TRI.apex.x} y={Y_L_TOP} textAnchor="middle"
                  fontSize={TRI.label.size} fontWeight={TRI.label.weight}
                  fill="#0f172a" style={{ letterSpacing: `${TRI.label.trackEm}em` }}>TOP</text>
            <text x={TRI.apex.x} y={Y_L_MID} textAnchor="middle"
                  fontSize={TRI.label.size} fontWeight={TRI.label.weight}
                  fill="#0f172a" style={{ letterSpacing: `${TRI.label.trackEm}em` }}>MIDDLE</text>
            <text x={TRI.apex.x} y={Y_L_BOT} textAnchor="middle"
                  fontSize={TRI.label.size} fontWeight={TRI.label.weight}
                  fill="#0f172a" style={{ letterSpacing: `${TRI.label.trackEm}em` }}>BOTTOM</text>

            {/* 接続線（高さは CONNECTS.y に厳密追従）。フォーカス時は強調 */}
            {CONNECTS.map((c, i) => {
              const fromX = xOnEdge(TRI.apex, TRI.right, c.y);
              const active = i === activeIdx;
              return (
                <g key={`connect-${i}`}>
                  <line
                    x1={fromX}
                    y1={c.y}
                    x2={LINE_TO_X}
                    y2={c.y}
                    stroke={active ? 'rgba(0,0,0,0.45)' : TRI.stroke.connect.color}
                    strokeWidth={active ? 1.8 : TRI.stroke.connect.w}
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* ボタン側の小さなドット（視認性UP） */}
                  <circle
                    cx={LINE_TO_X}
                    cy={c.y}
                    r={active ? 3.5 : 2.5}
                    fill={active ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.30)'}
                  />
                </g>
              );
            })}
          </svg>

          {/* ボタン（dy でだけ微調整。線は一切いじらない） */}
          {CONNECTS.map((c, i) => {
            const topPct = (c.y / VBH) * 100;
            const dy = c.dy ?? 0;

            // ステータス表示（任意）
            const statusLabel =
              c.status === 'done' ? '✓ 完了' :
              c.status === 'in_progress' ? '進行中' :
              c.status === 'not_started' ? '未着手' : undefined;

            const statusClass =
              c.status === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
              c.status === 'in_progress' ? 'bg-amber-50 border-amber-200 text-amber-700' :
              'bg-neutral-50 border-neutral-200 text-neutral-600';

            return (
              <motion.div
                key={`btn-${i}`}
                className="absolute"
                style={{
                  top: `calc(${topPct}% + ${dy}px)`,
                  left: `${LINE_TO_X_PCT}%`,
                  transform: 'translateY(-50%)',
                }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 22 }}
              >
                <Link
                  href={c.href}
                  prefetch
                  title={`${c.label}${c.subtitle ? ` — ${c.subtitle}` : ''}`}
                  aria-label={`${c.label}${c.subtitle ? `（${c.subtitle}）` : ''}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseLeave={() => setActiveIdx(null)}
                  onFocus={() => setActiveIdx(i)}
                  onBlur={() => setActiveIdx(null)}
                  className="
                    group inline-flex items-center gap-3 rounded-full border
                    border-neutral-300 bg-white/95 hover:bg-white shadow-sm hover:shadow
                    pl-4 pr-3 py-2 focus:outline-none focus-visible:ring-2
                    focus-visible:ring-neutral-400 focus-visible:ring-offset-2
                    transition
                  "
                >
                  <div className="flex flex-col leading-tight">
                    <span className="text-[13px] font-medium text-neutral-900">{c.label}</span>
                    {c.subtitle && (
                      <span className="text-[11px] text-neutral-500 -mt-0.5">{c.subtitle}</span>
                    )}
                  </div>

                  {/* ステータス（任意） */}
                  {statusLabel && (
                    <span
                      className={`ml-1 text-[10px] px-2 py-0.5 rounded-full border ${statusClass}`}
                    >
                      {statusLabel}
                    </span>
                  )}

                  {/* 初回誘導（任意：STAGE1が未完なら） */}
                  {c.href === '/strategy' && c.status !== 'done' && (
                    <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full bg-neutral-900 text-white">
                      まずはここから
                    </span>
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
