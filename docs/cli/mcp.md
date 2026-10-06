---
description: "Start an MCP server over stdio that lets an LLM on the desktop (Claude Desktop, Claude Code, any MCP client) drive a running That Open app through the platform channel: send it commands and read the replies."
---

## thatopen mcp

Runs an MCP (Model Context Protocol) server on stdio. Register it in an MCP
client's config and the LLM can command a running That Open app through the
platform channel — the same relay the app's `src/setups/channel.ts` listens
to, as one external channel of kind `mcp`.

**Usage (in the MCP client's config, not a terminal):**

```json
{
  "mcpServers": {
    "thatopen-platform": {
      "command": "npx",
      "args": ["-y", "@thatopen/services", "mcp"]
    }
  }
}
```

**Credentials:** resolved like every other CLI command — the project's
`.thatopen`, then `~/.thatopen/config.json` from `thatopen login`. Or inject
`THATOPEN_TOKEN` and `THATOPEN_API_URL` through the MCP server's `env`.

**Tools exposed:**

- `platform-status` — which API the server points at, whether credentials were
  found, and whether the channel subscription works. The first call to make
  when another tool fails.
- `send-app-command` — publish a command (`ping`, `get-loaded-models`, or
  whatever the app declares in `AppCommands`) to a running app and return its
  reply. Takes the project per call (id or dashboard URL); `app_id` is omitted
  while the app runs under `thatopen serve` and passed once it is published.

**The app must be open.** `delivered: 0` means no tab of that app has the
channel joined — the LLM is told to ask the user to open or reload the app
tab, the same rule as the raw socket in the quickstart's section 5b.
