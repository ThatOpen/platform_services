---
'@thatopen/services': minor
---

`thatopen mcp`: a desktop MCP server over the platform channel. Register it in any MCP client (`npx @thatopen/services mcp`) and an LLM can drive a running That Open app: `platform-status` and `send-app-command` (`ping`, `get-loaded-models`, or whatever the app declares), with the project named per call. Credentials from `thatopen login` or `THATOPEN_TOKEN`/`THATOPEN_API_URL`.

Sockets now connect WebSocket-only with the token in the auth payload (the SDK's execution progress socket, the MCP, and the quickstart's external-tool example): the long-polling handshake could die across the platform's load-balanced instances. Needs a platform with PR #520's backend; against older backends the handshake is refused.

The dev server dedupes `three` and compiles beta engine libraries from source when their `src` sits next to the resolved `dist`.
