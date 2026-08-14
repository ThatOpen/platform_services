---
'@thatopen/services': minor
---

Add notification methods to `PlatformClient`: `getNotifications`,
`getUnreadNotificationCount`, `markNotificationsRead`,
`markAllNotificationsRead`, `getNotificationSubscriptions` and
`unsubscribeFromAutomation`. All scoped to the signed-in user via the
bearer token an app already has.

The notification types mirror the backend's wire DTOs in `src/types`, the
same as every other type here.
