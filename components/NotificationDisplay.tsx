'use client';

import { useEffect, useState } from 'react';
import { useStrategyStore } from '@/store/strategyStore';

export default function NotificationDisplay() {
  const { notification, setNotification } = useStrategyStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (notification) {
      setVisible(true);

      const timer = setTimeout(() => {
        setVisible(false);
        setNotification('');
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [notification, setNotification]);

  if (!visible || !notification) return null;

  const isSuccess = notification.includes('✅');
  const isError = notification.includes('❌');

  return (
    <div className="fixed top-6 right-6 z-50">
      <div
        className={`px-4 py-2 rounded shadow-lg text-sm font-medium ${
          isSuccess ? 'bg-green-100 text-green-800' :
          isError ? 'bg-red-100 text-red-800' :
          'bg-blue-100 text-blue-800'
        }`}
      >
        {notification}
      </div>
    </div>
  );
}
