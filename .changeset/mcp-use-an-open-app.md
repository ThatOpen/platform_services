---
"@thatopen/services": patch
---

`thatopen mcp`: using an app, not only building one. `send-app-command` reads the `app_id` from a dashboard URL that carries `/apps/<id>`, so the URL of the user's app tab is all a call needs, and its description tells the LLM to send `help` first and follow the app's own answer. The AI quickstart opens with a box for "use the app I have open" (MCP server, the tab's URL, `help` first) and `docs/cli/mcp.md` says the same.
