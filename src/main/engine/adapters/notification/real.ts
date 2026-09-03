import { Notification as ElectronNotification } from 'electron'
import type { Notification, NotificationAdapter } from '../../adapters'

export function createRealNotificationAdapter(): NotificationAdapter {
  return {
    notify({ title, body, urgency }: Notification): void {
      if (!ElectronNotification.isSupported()) return

      new ElectronNotification({
        title,
        body,
        urgency,
        silent: urgency === 'low'
      }).show()
    }
  }
}
