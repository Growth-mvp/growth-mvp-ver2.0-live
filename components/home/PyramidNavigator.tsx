// /components/home/PyramidNavigator.tsx
'use client';

import React from 'react';
import Link from 'next/link';

/* ===== ピラミッド幾何（バランスは既存のまま） ===== */

const VBW = 1500;
const VBH = 750;

const TRI = {
  apex:  { x: 500, y: 90 },
  left:  { x: 160, y: 660 },
  right: { x: 840, y: 660 },
  div1Ratio: 0.34,
  div2Ratio: 0.66,
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
    boundary: { w: 1.2, color: 'rgba(15,28,38,0.90)' },
    divider:  { w: 1.0, color: 'rgba(15,28,38,0.70)' },
  },
};

// ごく薄い層の色（Apple風＝低彩度・低不透明）
const LAYER_FILLS = {
  top: 'rgba(15,23,42,0.035)',
  mid: 'rgba(15,23,42,0.045)',
  bot: 'rgba(15,23,42,0.055)',
};

// 位置計算
const lerp = (a:number,b:number,t:number)=>a+(b-a)*t;
const TRI_H = TRI.right.y - TRI.apex.y;
const Y_DIV1 = TRI.apex.y + TRI_H * TRI.div1Ratio;
const Y_DIV2 = TRI.apex.y + TRI_H * TRI.div2Ratio;

const xOnEdge = (p1:{x:number;y:number}, p2:{x:number;y:number}, y:number) => {
  const t = (y - p1.y) / (p2.y - p1.y);
  return lerp(p1.x, p2.x, t);
};
const xLeftAt  = (y:number) => xOnEdge(TRI.apex, TRI.left,  y);
const xRightAt = (y:number) => xOnEdge(TRI.apex, TRI.right, y);

const Y_L_TOP = ((TRI.apex.y + Y_DIV1) / 2)      + TRI.label.topYOffset;
const Y_L_MID = ((Y_DIV1     + Y_DIV2) / 2)      + TRI.label.midYOffset;
const Y_L_BOT = ((Y_DIV2     + TRI.right.y) / 2) + TRI.label.botYOffset;

/* ===== ボタン配置（デザイン準拠） ===== */
// STAGE1/2 を縦並びで STAGE3/4 と同じ列に合わせ、少し下げる
const ROW_TOP_Y = 210;  // ← 200 から下げた
const ROW_MID_Y = 360;  // STAGE3
const ROW_BOT_Y = 520;  // STAGE4（上げ済み）
const LEFT_PCT  = 58;   // 全列で統一（STAGE3/4 と同じ列）

// Apple風：余白/角丸/フォントを少し大きく（押しやすい）
const btnClass =
  'inline-flex items-center rounded-xl border border-neutral-300 ' +
  'bg-white px-6 py-3 shadow-sm hover:bg-neutral-100 transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2';

export default function PyramidNavigator() {
  return (
    <div className="relative mx-auto w-full max-w-6xl">
      {/* デスクトップ */}
      <div className="relative hidden md:block">
        <div className="relative aspect-[5/3]">
          {/* 背景SVG：淡い層塗り + 枠・区切り・ラベル（コネクタ無し） */}
          <svg
            viewBox={`0 0 ${VBW} ${VBH}`}
            className="absolute inset-0 h-full w-full pointer-events-none"
            aria-hidden="true"
          >
            {/* 層の色分け（ごく淡い） */}
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

            {/* 輪郭 */}
            <polygon
              points={`${TRI.apex.x},${TRI.apex.y} ${TRI.left.x},${TRI.left.y} ${TRI.right.x},${TRI.right.y}`}
              fill="transparent"
              stroke={TRI.stroke.boundary.color}
              strokeWidth={TRI.stroke.boundary.w}
            />

            {/* 区切り線 */}
            <line
              x1={xLeftAt(Y_DIV1)+TRI.lineInset}
              y1={Y_DIV1}
              x2={xRightAt(Y_DIV1)-TRI.lineInset}
              y2={Y_DIV1}
              stroke={TRI.stroke.divider.color}
              strokeWidth={TRI.stroke.divider.w}
            />
            <line
              x1={xLeftAt(Y_DIV2)+TRI.lineInset}
              y1={Y_DIV2}
              x2={xRightAt(Y_DIV2)-TRI.lineInset}
              y2={Y_DIV2}
              stroke={TRI.stroke.divider.color}
              strokeWidth={TRI.stroke.divider.w}
            />

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
          </svg>

          {/* 行1：STAGE1 & STAGE2（縦並び／列位置はSTAGE3/4に合わせる） */}
          <div
            className="absolute flex flex-col gap-3"
            style={{
              top: `${(ROW_TOP_Y / VBH) * 100}%`,
              left: `${LEFT_PCT}%`,
              transform: 'translateY(-50%)',
            }}
          >
            <Link href="/strategy" prefetch className={btnClass} title="基本情報・MVV">
              <span className="text-[15px] font-semibold text-neutral-900">STAGE1：経営基本情報</span>
            </Link>
            <Link href="/story-process" prefetch className={btnClass} title="仮説→最終ストーリー">
              <span className="text-[15px] font-semibold text-neutral-900">STAGE2：経営戦略策定</span>
            </Link>
          </div>

          {/* 行2：STAGE3 */}
          <div
            className="absolute"
            style={{
              top: `${(ROW_MID_Y / VBH) * 100}%`,
              left: `${LEFT_PCT}%`,
              transform: 'translateY(-50%)',
            }}
          >
            <Link href="/cascade" prefetch className={btnClass} title="部門ミッション/PJ">
              <span className="text-[15px] font-semibold text-neutral-900">STAGE3：部門戦略策定</span>
            </Link>
          </div>

          {/* 行3：STAGE4 */}
          <div
            className="absolute"
            style={{
              top: `${(ROW_BOT_Y / VBH) * 100}%`,
              left: `${LEFT_PCT}%`,
              transform: 'translateY(-50%)',
            }}
          >
            <Link href="/okr" prefetch className={btnClass} title="目標・成果(OKR)">
              <span className="text-[15px] font-semibold text-neutral-900">STAGE4：実行計画策定</span>
            </Link>
          </div>
        </div>
      </div>

      {/* モバイル：縦リスト（従来通り） */}
      <div className="md:hidden mt-6 space-y-3">
        {[
          { href: '/strategy', label: 'STAGE1：経営基本情報' },
          { href: '/story-process', label: 'STAGE2：経営戦略策定' },
          { href: '/cascade', label: 'STAGE3：部門戦略策定' },
          { href: '/okr', label: 'STAGE4：実行計画策定' },
        ].map((b) => (
          <Link
            key={b.href}
            href={b.href}
            className="flex items-center justify-between rounded-2xl border border-neutral-300 bg-white px-5 py-3 shadow-sm hover:bg-neutral-100 transition-colors"
          >
            <span className="text-base font-semibold text-neutral-900">{b.label}</span>
            <span className="text-neutral-400">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
