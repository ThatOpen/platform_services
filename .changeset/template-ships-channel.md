---
"@thatopen/services": minor
---

Scaffolded apps ship wired to the platform channel: a typed command map
(`ping`, `get-loaded-models`) that external tools of the account (an MCP
server, a CLI, a desktop LLM) can call with typed replies, plus a joined
collaboration room, in `src/setups/channel.ts`. Extending the surface is one
entry in `AppCommands` and its handler.

Docs: the AI quickstart gains section 5b (driving the running app from
outside, with a working socket.io driver) and the Chrome "Local network
access" note without which the dev loop fails silently. The `localStorage`
advice is gone from every doc that gave it: the production sandbox runs apps
on an opaque origin where all origin storage throws; drafts live in memory
and the platform is the only persistence.
