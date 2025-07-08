'use client';
import { useStrategyStore } from '../store/strategyStore';

export default function NotificationDisplay() {
  const { notification } = useStrategyStore();

  if (!notification) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-green-100 border border-green-400 text-green-800 px-4 py-2 rounded shadow">
      {notification}
    </div>
  );
}
