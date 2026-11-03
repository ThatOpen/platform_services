---
description: "Authenticate with the ThatOpen platform by validating an access token against the API. Saves credentials globally (~/.thatopen/config.json) by default, or locally to the project's .thatopen file with --local. Local config takes priority over global."
---

## thatopen login

Validates an access token against the platform API and saves the credentials. Run this once globally before using any other command, or per-project with `--local`.

Without a token, it signs you in through your browser, as the Revit plugin does: it shows a code, opens the platform, and you confirm the code there. The session renews itself, and appears under **Connected apps** in your account, where you can disconnect it.

To use a token from the dashboard instead:
1. Go to [https://platform.thatopen.com](https://platform.thatopen.com)
2. In the header, click **Data**
3. Find the **Tokens** card and create a new token
4. Enable the permissions: **Apps**, **Components**, and **Storage**
5. Copy the token

**Usage:**
```bash
thatopen login [flags]
```

**Flags:**

- `--token <token>` — Access token from the dashboard. Without one, you sign in through your browser.
- `--api-url <url>` — Platform API URL. Default: `https://platform.thatopen.com` (production). Pass `https://dev.platform.thatopen.com` to target the dev environment.
- `--local` — Save credentials to `.thatopen` in the current directory instead of the global config. Use this inside a project to override the global token for that project only.

**Examples:**
```bash
thatopen login
thatopen login --token my-token
thatopen login --token my-token --local
npm run login -- --token my-token    # from inside a scaffolded project
```
