# NightWatch — Manual Setup Tutorial

This is a one-time walkthrough of everything you need to create by hand — accounts, credentials, and local tools — before Phase 1 coding starts. Nothing here involves writing code; it's all clicking through dashboards and saving a few values (URLs, IDs, keys) that the app will need later.

Do these roughly in order. Steps 1–4 are required for MVP. Step 5 is optional and only needed once we build in-app YouTube search (§5.11).

---

## 1. Install Node.js

NightWatch's tooling (Electron, React, Vite) all run on Node.js.

1. Go to **https://nodejs.org**.
2. Download the **LTS** version (not "Current") for Windows.
3. Run the installer, accepting the defaults.
4. Verify it worked — open a terminal (PowerShell) and run:
   ```
   node -v
   npm -v
   ```
   Both should print a version number.

---

## 2. Clone the GitHub Repository

Your repo: **https://github.com/BlastPowa/NightWatch.git**

1. If you don't have Git installed, get it from **https://git-scm.com/downloads**.
2. Open a terminal in the folder where you want the project to live, then run:
   ```
   git clone https://github.com/BlastPowa/NightWatch.git
   ```
3. If the repo is currently empty (no commits yet), that's fine — it just means the clone will produce an empty folder, and the first commit will happen when Phase 1 coding begins.

---

## 3. Create the Supabase Project

Supabase provides NightWatch's realtime sync (chat, presence, playback broadcasts) and authentication — for free.

1. Go to **https://supabase.com** and click **Start your project** (sign up or log in — GitHub login is the fastest option).
2. Click **New Project**.
3. Fill in:
   - **Name**: `nightwatch` (or anything memorable)
   - **Database Password**: generate/save a strong one (you likely won't need it directly for MVP since there are no custom tables yet, but save it anyway)
   - **Region**: pick whichever is closest to you/your friend group
4. Click **Create new project** and wait ~1-2 minutes for it to provision.
5. Once it's ready, go to **Project Settings → API** (gear icon in the left sidebar → API).
6. Save these two values somewhere safe — the app will need them later:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public** key (a long string under "Project API keys") — this one is safe to embed in the app later; it is *not* a secret key.
7. Realtime is enabled by default on new projects — no extra step needed. You can double check under **Database → Replication** if you want to confirm.

---

## 4. Create the Discord Application

This single Discord Application will be reused for three things later: Discord login (OAuth), Discord Rich Presence, and (if you ever add it) a Discord Activity.

1. Go to **https://discord.com/developers/applications**.
2. Click **New Application**, give it a name (e.g. "NightWatch"), agree to the terms, and click **Create**.
3. On the **General Information** page, you can optionally upload an app icon now (or later) — this is what shows up in Rich Presence.
4. Go to the **OAuth2** tab in the left sidebar.
5. Under **Client information**, copy and save:
   - **Client ID**
   - **Client Secret** (click "Reset Secret" if one isn't shown yet, then copy it — treat this like a password, don't share it)
6. Now go set up the Discord provider in Supabase:
   - In your Supabase project, go to **Authentication → Providers**.
   - Find **Discord** in the list and click to expand it.
   - Toggle it **on**.
   - Supabase will show you a **Redirect URL** (looks like `https://xxxxxxxxxxxx.supabase.co/auth/v1/callback`) — copy it.
7. Back in the Discord Developer Portal, on the **OAuth2** tab, under **Redirects**, click **Add Redirect**, and paste in the Supabase redirect URL from the previous step. Save changes.
8. Back in Supabase's Discord provider settings, paste in the **Client ID** and **Client Secret** from step 5, then click **Save**.

At this point, Discord login is fully wired up on the backend side — no code needed for that part.

---

## 5. (Optional, Deferred) Google Cloud / YouTube Data API v3 Key

Skip this until we're actually building the in-app YouTube search feature (§5.11) — it's not needed for the core watch-party experience, since video playback itself (via the YouTube IFrame Player) never requires an API key.

When we do get to that feature:

1. Go to **https://console.cloud.google.com/**.
2. Create a new project (top-left project dropdown → New Project).
3. Go to **APIs & Services → Library**, search for **"YouTube Data API v3"**, and click **Enable**.
4. Go to **APIs & Services → Credentials → Create Credentials → API Key**.
5. Click **Restrict Key** and limit it to the YouTube Data API v3 (good practice, prevents misuse if it ever leaked).
6. **Important**: this key does **not** get pasted into the Electron app. Per ARCHITECTURE.md §7.6, it gets stored as a secret on a Supabase Edge Function, which proxies search requests server-side. I'll walk you through that specific step when we build that feature — for now, just keep the key saved somewhere safe (e.g. a password manager) if you generate it early.

---

## 6. Where Things Stand

Once steps 1–4 are done, you have everything needed to start Phase 1 (Electron + React + Vite scaffolding):

- ✅ Node.js installed
- ✅ Repo cloned locally
- ✅ Supabase project created, with Project URL + anon key saved
- ✅ Discord Application created, with Discord login wired into Supabase Auth

Nothing above requires writing any code — that's the next phase, and it needs its own approval per the phased workflow in CLAUDE.md before it begins.
