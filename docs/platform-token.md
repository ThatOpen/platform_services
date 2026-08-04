# Logging in to That Open Platform

Everything else in these guides needs this, and it is the same three lines every time, so it lives
here rather than in each of them.

## Get the token

Say this to the user, and wait:

> "To log in I need a That Open Platform **access token**. You create it yourself:
> **https://platform.thatopen.com/dashboard/data → API Tokens → create → copy**, then paste it
> here."

**Never print it back, never write it into a file, never commit it.** Not into a script, not into a
`.env` you are about to show, not into a chat message quoting the command you ran.

## Log in

```bash
thatopen login --token <TOKEN>
```

Credentials go to `~/.thatopen/config.json`, as `accessToken` and `apiUrl`. `--local` writes them to
a `.thatopen` file in the project instead, which is what a scaffolded project uses.

You do not need an npm account or an npm token for the private packages. The CLI derives access to
them from this one.

## Production and dev are separate worlds

Two platforms, not two views of one. Separate accounts, separate tokens, separate projects. A token
from one is refused by the other, and a model published to the wrong one is somewhere the user's
team cannot see — while every command reports success.

| | |
|---|---|
| **Production** | `https://platform.thatopen.com` — the default, and what almost everybody wants |
| **Dev** | `https://dev.platform.thatopen.com` — only if the user's team works there |

```bash
thatopen login --token <TOKEN>                                          # production
thatopen login --token <TOKEN> --api-url https://dev.platform.thatopen.com   # dev
```

The dashboard for dev is the same page on that host:
`https://dev.platform.thatopen.com/dashboard/data`.

## Say which one you are on

**`login` prints "Logged in successfully" and does not name the environment.** Nothing on screen
will contradict a wrong assumption, so make the statement yourself: read `apiUrl` from
`~/.thatopen/config.json` and tell the user in plain words — *"you are on production"* or *"you are
on dev"*.

Do this **even when the machine is already logged in**, and especially then. A saved login is
whoever used this machine last, not an answer to a question you have asked. If you find dev, offer
production before going any further; moving needs a **production** token, so the user has to create
one on the production dashboard first.

## When it fails

- **`Unauthorized`** — the token is invalid, expired, or from the other environment. Production
  tokens use no `--api-url`; dev tokens need it. Ask for a fresh one from the same environment as
  the URL you are using.
- **HTTP 403 on `item/folder?projectId=…`** — login worked. The account simply has no access to that
  project, or the project is in the other environment. Confirm the project id with the user before
  assuming anything is broken.
- **A private package fails to install** — you are not logged in, or logged in to the environment
  that does not have it. Log in again and retry; there is no separate npm login to do.
