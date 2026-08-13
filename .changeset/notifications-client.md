---
'@thatopen/services': minor
---

Add notification methods to `PlatformClient`: `getNotifications`,
`getUnreadNotificationCount`, `markNotificationsRead`,
`markAllNotificationsRead`, `getNotificationSubscriptions` and
`unsubscribeFromAutomation`. All scoped to the signed-in user via the
bearer token an app already has.

The notification types are re-exported from the backend repo rather than
copied into `src/types`, so the contract cannot drift from what the API
sends. Run `yarn types:update` to move the pin.
