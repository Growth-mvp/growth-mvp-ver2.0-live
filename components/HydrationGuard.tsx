'use client';
import { useEffect, useState, type ReactNode } from 'react';

export default function HydrationGuard({
  children,
  fallback = null,
}: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
}
