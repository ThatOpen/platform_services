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

## Everyone is on production

**Do not ask the user which environment they want.** Production is the answer, it is the default,
and the plain command above is already correct. Asking turns a decision nobody has into a question
they cannot answer, at the worst possible moment — the first thing you say to them.

There is a `dev` platform, and it exists for the people building That Open Platform itself. If the
user is one of them they already know, and they will tell you without being asked.

Everything below this line is for that case only. If nothing has mentioned dev, skip it.

<details>
<summary>Dev, for the platform team</summary>

Two platforms, not two views of one. Separate accounts, separate tokens, separate projects. A token
from one is refused by the other, and a model published to the wrong one lands somewhere the user's
team cannot see — while every command reports success.

```bash
thatopen login --token <TOKEN> --api-url https://dev.platform.thatopen.com
```

Its dashboard is the same page on that host: `https://dev.platform.thatopen.com/dashboard/data`.

</details>

## Check, do not ask

**`login` prints "Logged in successfully" and does not name the environment**, so nothing on screen
would contradict a wrong assumption. Read `apiUrl` from `~/.thatopen/config.json` yourself.

If it says production — which it will — say nothing about it and carry on. There is no decision to
report.

**Only if it says dev**, and the user has not told you they work there, is there anything to say:

> "This machine is pointed at the dev platform, which is the one the That Open team builds on. I'll
> move it to production — that will need a token from **https://platform.thatopen.com/dashboard/data**,
> since dev tokens are not accepted there."

Check this **even when the machine is already logged in**, and especially then. A saved login is
whoever used this machine last, not an answer to a question you have asked.

## When it fails

- **`Unauthorized`** — the token is invalid, expired, or from the other environment. Production
  tokens use no `--api-url`; dev tokens need it. Ask for a fresh one from the same environment as
  the URL you are using.
- **HTTP 403 on `item/folder?projectId=…`** — login worked. The account simply has no access to that
  project, or the project is in the other environment. Confirm the project id with the user before
  assuming anything is broken.
- **A private package fails to install** — you are not logged in, or logged in to the environment
  that does not have it. Log in again and retry; there is no separate npm login to do.
