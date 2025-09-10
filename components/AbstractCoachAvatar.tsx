'use client';

import React from 'react';
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useSpring,
  useTransform,
  cubicBezier,
} from 'framer-motion';

type Status = 'idle' | 'thinking' | 'responding' | 'loading';

export interface AbstractCoachAvatarProps {
  size?: number;
  status?: Status;
  className?: string;
}

export default function AbstractCoachAvatar({
  size = 120,
  status = 'idle',
  className,
}: AbstractCoachAvatarProps) {
  const easeInOutFn = cubicBezier(0.42, 0, 0.58, 1);

  // === 時間・回転 ===
  const t = useMotionValue(0);
  const spin = useMotionValue(0);

  // === 状態ごとの設定（見た目強め） ===
  const cfg: Record<
    Status,
    {
      wobbleAmp: number; wobbleHz: number;
      yAmp: number; yHz: number;
      scaleAmp: number; scaleHz: number;
      spinDps: number;
      haloMaxR: number; haloMinR: number; haloOpacity: number;
      ringSpeed: number; ringWidth: number;
      satellites: number; orbitRadius: number; orbitSpeed: number; satelliteSize: number;
    }
  > = {
    idle: {
      wobbleAmp: 4, wobbleHz: 0.06, yAmp: 3, yHz: 0.07, scaleAmp: 0.08, scaleHz: 0.07, spinDps: 10,
      haloMaxR: 58, haloMinR: 52, haloOpacity: 0.18,
      ringSpeed: 0.4, ringWidth: 1.5,
      satellites: 0, orbitRadius: 0, orbitSpeed: 0, satelliteSize: 0,
    },
    thinking: {
      wobbleAmp: 12, wobbleHz: 0.10, yAmp: 6, yHz: 0.11, scaleAmp: 0.12, scaleHz: 0.10, spinDps: 18,
      haloMaxR: 64, haloMinR: 54, haloOpacity: 0.28,
      ringSpeed: 0.9, ringWidth: 2.0,
      satellites: 3, orbitRadius: 44, orbitSpeed: 36, satelliteSize: 2.8,
    },
    responding: {
      wobbleAmp: 10, wobbleHz: 0.14, yAmp: 7, yHz: 0.14, scaleAmp: 0.15, scaleHz: 0.14, spinDps: 22,
      haloMaxR: 66, haloMinR: 56, haloOpacity: 0.32,
      ringSpeed: 1.2, ringWidth: 2.2,
      satellites: 2, orbitRadius: 46, orbitSpeed: 48, satelliteSize: 3.0,
    },
    loading: {
      wobbleAmp: 0, wobbleHz: 0.10, yAmp: 3, yHz: 0.10, scaleAmp: 0.10, scaleHz: 0.10, spinDps: 60,
      haloMaxR: 60, haloMinR: 52, haloOpacity: 0.24,
      ringSpeed: 1.6, ringWidth: 2.4,
      satellites: 1, orbitRadius: 42, orbitSpeed: 90, satelliteSize: 2.6,
    },
  };
  const target = cfg[status];

  // === スプリング補間（先頭で一括定義）===
  const wobbleAmp   = useSpring(target.wobbleAmp,   { damping: 20, stiffness: 120 });
  const wobbleHz    = useSpring(target.wobbleHz,    { damping: 20, stiffness: 120 });
  const yAmp        = useSpring(target.yAmp,        { damping: 20, stiffness: 120 });
  const yHz         = useSpring(target.yHz,         { damping: 20, stiffness: 120 });
  const scaleAmp    = useSpring(target.scaleAmp,    { damping: 20, stiffness: 120 });
  const scaleHz     = useSpring(target.scaleHz,     { damping: 20, stiffness: 120 });
  const spinDps     = useSpring(target.spinDps,     { damping: 18, stiffness: 110 });

  const haloMaxR    = useSpring(target.haloMaxR,    { damping: 20, stiffness: 120 });
  const haloMinR    = useSpring(target.haloMinR,    { damping: 20, stiffness: 120 });
  const haloOpacity = useSpring(target.haloOpacity, { damping: 20, stiffness: 120 });

  const ringSpeed   = useSpring(target.ringSpeed,   { damping: 18, stiffness: 110 });
  const ringWidth   = useSpring(target.ringWidth,   { damping: 18, stiffness: 110 });

  const satellitesN = target.satellites;
  const orbitRadius = useSpring(target.orbitRadius, { damping: 18, stiffness: 110 });
  const orbitSpeed  = useSpring(target.orbitSpeed,  { damping: 18, stiffness: 110 });
  const satelliteSz = useSpring(target.satelliteSize, { damping: 18, stiffness: 110 });

  // === 時間更新 ===
  useAnimationFrame((_, deltaMs) => {
    const dt = Number(deltaMs) / 1000;
    t.set(Number(t.get()) + dt);
    spin.set(Number(spin.get()) + Number(spinDps.get()) * dt);
  });

  // === 波形 ===
  const sin2pi = (f: number, tt: number) => Math.sin(2 * Math.PI * f * tt);

  // 本体の派生値
  const wobble = useTransform([t, wobbleHz, wobbleAmp], (vals: any) => {
    const [tt, f, A] = vals as [number, number, number];
    return Number(A) * sin2pi(Number(f), Number(tt));
  });
  const bounceY = useTransform([t, yHz, yAmp], (vals: any) => {
    const [tt, f, A] = vals as [number, number, number];
    return Number(A) * sin2pi(Number(f), Number(tt));
  });
  const scale = useTransform([t, scaleHz, scaleAmp], (vals: any) => {
    const [tt, f, A] = vals as [number, number, number];
    return 1 + Number(A) * sin2pi(Number(f), Number(tt));
  });

  // 色グラデ
  const colorPhase = useTransform(t, (tt) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.05 * Number(tt)));
  const gradRanges: Record<Status, { c1: [string, string]; c2: [string, string] }> = {
    idle:       { c1: ['#FFFFFF', '#F4FAFF'], c2: ['#A7D8FF', '#7BB6E8'] },
    thinking:   { c1: ['#FFFFFF', '#EAF4FF'], c2: ['#8EC5FF', '#4F9EEA'] },
    responding: { c1: ['#FFFFFF', '#E6F2FF'], c2: ['#7BB6E8', '#3B82F6'] },
    loading:    { c1: ['#FFFFFF', '#EDF6FF'], c2: ['#A7D8FF', '#60A5FA'] },
  };
  const range = gradRanges[status];
  const stop0 = useTransform(colorPhase as any, [0, 1] as any, range.c1.slice() as any);
  const stop1 = useTransform(colorPhase as any, [0, 1] as any, range.c2.slice() as any);

  // ハロー半径（min↔max）
  const haloR = useTransform([t, haloMinR, haloMaxR], (vals: any) => {
    const [tt, r0, r1] = vals as [number, number, number];
    const base = (Math.sin(2 * Math.PI * 0.5 * Number(tt)) + 1) / 2;
    return Number(r0) + (Number(r1) - Number(r0)) * base;
  });

  // パルスリング
  const ringPhase = useTransform(t, (tt) => (Math.sin(2 * Math.PI * Number(ringSpeed.get()) * Number(tt)) + 1) / 2);

  // 衛星の公転角（親gで回す）＋ 半径→cx用変換はフックを1つだけ
  const orbitAngleDeg = useTransform(t, (tt) => (Number(orbitSpeed.get()) * Number(tt) * 360) / 60);
  const satCx = useTransform(orbitRadius, (R) => 60 + Number(R)); // 角度0位置のx
  const satOpacity = useTransform(t, (tt) => 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.8 * Number(tt)));

  return (
    <div
      className={className}
      style={{ width: `${size}px`, height: `${size}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width={size} height={size} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="coachGrad" cx="50%" cy="50%" r="50%">
            <motion.stop offset="0%" style={{ stopColor: stop0 as unknown as string }} />
            <motion.stop offset="100%" style={{ stopColor: stop1 as unknown as string }} />
          </radialGradient>
          <filter id="haloBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
          </filter>
        </defs>

        {/* 発光ハロー */}
        <motion.circle
          cx="60" cy="60" r={haloR as unknown as number}
          fill="url(#coachGrad)" filter="url(#haloBlur)"
          style={{ opacity: haloOpacity as unknown as number }}
        />

        {/* 本体 */}
        <motion.g style={{ transformOrigin: '60px 60px', rotate: spin }}>
          <motion.path
            d="M60,20 C80,20 100,40 100,60 C100,80 80,100 60,100 C40,100 20,80 20,60 C20,40 40,20 60,20"
            fill="url(#coachGrad)"
            style={{ transformOrigin: '60px 60px', rotate: wobble, y: bounceY, scale }}
          />
        </motion.g>

        {/* パルスリング */}
        <motion.circle
          cx="60" cy="60"
          r={useTransform(ringPhase, (p) => 38 + p * 16) as unknown as number}
          fill="none" stroke="url(#coachGrad)"
          style={{
            opacity: useTransform(ringPhase, (p) => 0.25 + 0.35 * (1 - Math.abs(p - 0.5) * 2)) as unknown as number,
            strokeWidth: ringWidth as unknown as number,
          }}
        />

        {/* 衛星ドット（Hookは先頭で定義／ここでは使うだけ） */}
        {satellitesN > 0 && (
          <motion.g
            style={{ transformOrigin: '60px 60px', rotate: orbitAngleDeg }}
          >
            {Array.from({ length: satellitesN }).map((_, i) => {
              const baseAngle = (360 / satellitesN) * i;
              return (
                <g key={i} transform={`rotate(${baseAngle} 60 60)`}>
                  <motion.circle
                    cx={satCx as unknown as number}
                    cy={60}
                    r={satelliteSz as unknown as number}
                    fill="url(#coachGrad)"
                    style={{ opacity: satOpacity as unknown as number }}
                  />
                </g>
              );
            })}
          </motion.g>
        )}
      </svg>
    </div>
  );
}
