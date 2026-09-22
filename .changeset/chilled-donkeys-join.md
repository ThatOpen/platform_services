---
"@thatopen/services": patch
---

App template: join the platform channel at the start of boot, not the end. A stalled startup request (project data, the first world) used to leave the app booted-looking but silently unreachable to external tools — `channelPublish` acks came back `{ delivered: 0 }` with nothing in the console, because a join that is never requested also never times out loudly. The template now joins right after `client.setup()`, and the project-data fetch is bounded so a hung response cannot park the rest of boot either. This release also ships `src/core/examples/` (the channel walkthrough the 0.16.0 docs referenced but did not include).
