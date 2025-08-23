import React, { useEffect, useState } from 'react';

export interface SnackBarNotification {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  duration: number;
}

// Create a global notification system
export const showSnackBar = (message: string, type: 'error' | 'warning' | 'info' = 'info', duration = 4000) => {
  const event = new CustomEvent('showSnackBar', {
    detail: {
      id: Date.now().toString(),
      message,
      type,
      duration
    }
  });
  window.dispatchEvent(event);
};

// Helper functions
export const showError = (message: string) => showSnackBar(message, 'error');
export const showWarning = (message: string) => showSnackBar(message, 'warning');
export const showInfo = (message: string) => showSnackBar(message, 'info');

const SnackBar: React.FC = () => {
  const [notifications, setNotifications] = useState<SnackBarNotification[]>([]);

  useEffect(() => {
    const handleShowSnackBar = (event: Event) => {
      const customEvent = event as CustomEvent<SnackBarNotification>;
      const notification = customEvent.detail;
      
      setNotifications(prev => [...prev, notification]);
      
      // Auto remove after duration
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== notification.id));
      }, notification.duration);
    };

    window.addEventListener('showSnackBar', handleShowSnackBar);
    
    return () => {
      window.removeEventListener('showSnackBar', handleShowSnackBar);
    };
  }, []);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs">
      {notifications.map(notification => (
        <div 
          key={notification.id}
          className={`
            p-3 rounded-md shadow-lg flex items-center gap-3 animate-fadeIn
            ${notification.type === 'error' ? 'bg-red-600' : 
              notification.type === 'warning' ? 'bg-amber-600' : 
              'bg-blue-600'} text-white
          `}
        >
          {notification.type === 'error' && (
            <span className="text-xl">❌</span>
          )}
          {notification.type === 'warning' && (
            <span className="text-xl">⚠️</span>
          )}
          {notification.type === 'info' && (
            <span className="text-xl">ℹ️</span>
          )}
          <span className="flex-1">{notification.message}</span>
        </div>
      ))}
    </div>
  );
};

export default SnackBar; 