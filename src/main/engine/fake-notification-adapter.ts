import type { Notification, NotificationAdapter } from './adapters'

export interface FakeNotificationAdapter extends NotificationAdapter {
  notifications: Notification[]
}

export function createFakeNotificationAdapter(): FakeNotificationAdapter {
  const notifications: Notification[] = []

  return {
    notifications,
    notify(notification: Notification): void {
      notifications.push(notification)
    }
  }
}
