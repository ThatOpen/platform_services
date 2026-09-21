---
"@thatopen/services": minor
---

Add `client.channel` to `PlatformClient`: typed access, from inside an app, to the platform channel. `channel.collab<Events>()` is a collaboration room shared with other users of the app, with presence (`peers`, `onPeerJoined`, `onPeerLeft`). `channel.external<Commands>(kind?)` receives commands from external tools (MCP, CLI, Revit plugin); a handler's return value is sent back to the caller automatically, and a throw becomes an error reply. Rooms are opt-in through `join()` and `leave()`. Requires a platform whose channel gateway stamps `scope` and `kind` on messages; without it messages are still delivered by type.
