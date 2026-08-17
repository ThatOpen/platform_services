---
'@thatopen/services': minor
---

Add notifications to `PlatformClient`.

Read and manage the signed-in user's notifications with `getNotifications`,
`getUnreadNotificationCount`, `markNotificationsRead` and
`markAllNotificationsRead`, and manage automation subscriptions with
`getNotificationSubscriptions`, `subscribeToAutomation`,
`updateAutomationSubscription` and `unsubscribeFromAutomation`. All scoped to
the signed-in user via the bearer token an app already has.

`onNotification` subscribes to new notifications live. Unlike
`onExecutionProgress` it stays connected for the session rather than closing on
a terminal event, and it returns a function that disconnects.

The notification types mirror the backend's wire DTOs in `src/types`, the same
as every other type here. Read `outcome` to tell how an automation run ended
rather than matching on the copy: `title` is built from the user's own
automation name, so an automation called "Failover sync" makes every successful
run look failed to anything parsing the text. `groupKey` and `groupLabel` are
what a client needs to collapse a busy automation's runs into one row.
