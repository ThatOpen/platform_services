# That Open — Revit Collaboration Quickstart (for AI assistants)

You are an AI assistant. A user pointed you at this guide so you can set up or join
**real‑time Revit collaboration** through the That Open platform. Follow the steps **in
order**. Ask the user for anything you don't already have. **You may run the setup commands
yourself** (install the CLI, install the add‑in, launch Revit) — do it, don't just tell the
user to, *except* where a step says only the user can. Everything is driven by the
`thatopen` CLI.

## What this does
Multiple people work on **one shared Revit central model** using Revit's native
worksharing. The central lives on the That Open platform. Each person has their own local;
when they **sync**, their changes go up and their teammates' come down. All syncs are
**queued**, so the central never conflicts or diverges.

## Rules (follow throughout)
- **Never** print, echo, store, or commit the user's access token.
- **Ask, don't assume.** Missing a project id, file path, or central name? Ask first.
- **Use only the `thatopen` CLI** for platform actions. Don't call HTTP APIs by hand.
- You may **install software and launch Revit** on the user's machine — briefly tell the
  user what you're about to run before you run it.
- After each command, **check the output** before moving on.

---

## Step 0 — Ask what the user wants to do
Ask the user:
> "What would you like to do?
> (A) **Share** a Revit model with my team for the first time.
> (B) **Join** a shared model a teammate already uploaded.
> (C) I **already have my local open** in Revit — just sync it."

Then collect the inputs for their choice (ask now — you'll need them below):
- **(A) Share:** the **absolute path** to the `.rvt` to share, and a short lowercase
  **name** for the shared central (e.g. `tower-central`).
- **(B) Join:** the **central name** the teammate gave them.
- **(A) and (B):** the platform **Project ID** (from the platform dashboard / project URL).
- **(C):** nothing extra — Revit must have their local open.

Do **not** ask for the access token yet (that's Step 2).

---

## Step 1 — Make sure the tools are ready (do this yourself)
1. **CLI.** Run:
   ```
   npm install -g @thatopen/services@latest
   ```
   Verify `thatopen --version` prints a version. (Needs Node.js 18+; if `node -v` fails,
   ask the user to install Node.js, then continue.)

2. **Revit + add‑in.** Run:
   ```
   thatopen revit status
   ```
   - Prints `"loaded": true` → the add‑in is running. Go to **Step 2**.
   - Errors **"The That Open Revit add‑in is not running"** → work through (a) then (b):

   **(a) Is Revit 2026 open?** If not, launch it (Windows):
   ```
   powershell -Command "Start-Process 'C:\Program Files\Autodesk\Revit 2026\Revit.exe'"
   ```
   Cold start can take 1–3 minutes. Wait, then re‑run `thatopen revit status`. If it now
   says `"loaded": true`, go to Step 2.

   **(b) Revit is open but status still errors → the add‑in isn't installed. Install it:**
   - The add‑in files ship in **this same folder** as this guide (`install.ps1`,
     `Bt3Addin.dll`, `Bt3Core.dll`, `bt3.addin`). From this folder, run:
     ```
     powershell -ExecutionPolicy Bypass -File install.ps1
     ```
     *(If you don't have those files, download the plugin zip here, unzip it, then run
     `install.ps1` from the unzipped folder:
     https://drive.google.com/file/d/1HL_Ti7N_qN0Q-X7vNYOQst3yEgIY-xXO/view?usp=drive_link )*
   - **Restart Revit** so it loads the add‑in: close Revit, then launch it again with the
     `Start-Process` command above.
   - On the first launch after installing, Revit shows an **"unsigned add‑in"** prompt.
     **Only the user can click it — ask them to choose "Always Load".**
   - Re‑run `thatopen revit status` every ~10s until it prints `"loaded": true`.

---

## Step 2 — Log in
The user needs a personal **access token** from the That Open platform. Ask them for it and
tell them exactly where to get it:

> "To log in I need your That Open **access token**. To create one:
> 1. Open your That Open dashboard in a browser — **production:** https://platform.thatopen.com
>    · **dev:** https://dev.platform.thatopen.com (use the one that matches your team).
> 2. Go to **Data → API Tokens**.
> 3. Click **Create a new token** and **copy** it.
> 4. Paste it here."

**Never print, echo, or store the token.** Once the user pastes it, run:
```
thatopen login --token <TOKEN>
```
- **Production is the default.** For the **dev** environment, also add:
  `--api-url https://dev.platform.thatopen.com`
- Success prints `Logged in successfully…`. If it fails with **"Unauthorized"**, the token
  is invalid or for the other environment — see **Troubleshooting**, then ask for a fresh
  token and retry.

---

## Step 3 — Do the action

### (A) Share a model — `publish-central`
```
thatopen revit publish-central --project <PROJECT> --doc <DOC> --file "<FILE>"
```
`<DOC>` is the short central name from Step 0; `<FILE>` is the `.rvt` path. This enables
worksharing, saves it as a central, uploads it, and opens **your** local in Revit
(takes a bit). Success: `Published. Central: … (version N).` Tell teammates to join with:
`thatopen revit join --project <PROJECT> --doc <DOC>`.

### (B) Join a model — `join`
```
thatopen revit join --project <PROJECT> --doc <DOC>
```
Downloads the central, creates the user's **local**, and opens it in Revit.
Success: `Joined. Your local was created and opened in Revit: …`.

### (C) Already have a local open — `sync`
```
thatopen revit sync
```
Reads everything from the open local. Nothing else needed.

---

## Step 4 — Work, then sync
Tell the user to **model normally** in the local Revit opened. To send their changes to the
team and pull the team's changes, run:
```
thatopen revit sync
```
…or click **"Sync to team"** in the **"That Open"** panel of Revit's **Add‑Ins** tab.
Success: `Synced.  vN → vM.` Repeat as often as they like; syncs are queued, no conflicts.

---

## Troubleshooting
- **`thatopen login` fails with "Unauthorized"** → the token is invalid/expired, or it's
  for a different environment than `--api-url`. Ask the user to generate a fresh token in
  the dashboard (Data → API Tokens) for the SAME environment: production tokens use **no**
  `--api-url`; dev tokens use `--api-url https://dev.platform.thatopen.com`. Then retry.
- **"add‑in not running"** after Revit is open → the add‑in isn't installed; do Step 1(b).
- **"Could not reach the Revit add‑in"** → Revit was closed; reopen it and retry.
- **"Not logged in"** → do Step 2.
- **publish/join says a value is missing** → you omitted an `--option`; re‑run with all of
  `--project`, `--doc`, and (for publish) `--file`.

## Rules recap (for the AI)
- Ask for every value you don't have — never guess a project id, file path, or central name.
- Never echo or store the user's token.
- You may install the CLI/add‑in and launch Revit yourself; only the "Always Load" prompt
  needs the user.
- Use only the `thatopen` CLI commands above; verify each command's output before proceeding.
