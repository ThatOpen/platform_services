---
'@thatopen/services': patch
---

Add `outcome`, `groupKey` and `groupLabel` to `NotificationDto`, matching what
the API already returns.

`outcome` is how an automation run ended, and it is the field to read rather
than matching on the copy: `title` is built from the user's own automation
name, so an automation called "Failover sync" makes every successful run look
failed to anything parsing the text. `groupKey` and `groupLabel` are what a
client needs to collapse a busy automation's runs into one row.
