---
'@thatopen/services': minor
---

Add `subscribeToAutomation` and `updateAutomationSubscription`, so an app can
create a subscription rather than only listing and cancelling one.

Add `onNotification`, a live socket subscription for the signed-in user.
Unlike `onExecutionProgress` it stays connected for the session rather than
closing on a terminal event, and it returns a function that disconnects.
