# Google media setup

Last updated: 2026-07-16.

This runbook configures NightWatch's Electron-only Google Drive picker and the
optional read-only YouTube account connection. It never requires an OAuth
access token, refresh token, service-account key, or Supabase secret in the
repository.

## Google Cloud project

Use one owner-controlled Google Cloud project and complete these steps:

1. Enable **Google Drive API** and **Google Picker API**.
2. Enable **YouTube Data API v3** only if the optional YouTube account card will
   be enabled.
3. Configure the OAuth consent screen. Keep it in Testing while developing and
   list every account that will perform packaged acceptance.
4. Create an OAuth client with application type **Desktop app**.
5. Create an API key and restrict its API access to **Google Picker API**.
6. Copy the Google Cloud project number for Picker's application id.

NightWatch requests grants separately:

- Drive connection: `https://www.googleapis.com/auth/drive.file`
- Optional YouTube account connection:
  `https://www.googleapis.com/auth/youtube.readonly`

Connecting one feature never silently grants the other scope. The YouTube
connection reads channel identity only and does not sign into, configure, or
alter the official embedded player.

### Error 403 while the OAuth app is in Testing

Google limits an OAuth app in **Testing** to accounts explicitly listed by the
project owner. If the browser shows **Error 403**, **Access blocked**, or says
the app is available only to approved testers:

1. Open [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience)
   in the same Google Cloud project used by NightWatch.
2. Confirm **Publishing status** is **Testing**.
3. Under **Test users**, choose **Add users**.
4. Add the exact Google email address that will connect Drive or YouTube, then
   save the audience.
5. Retry the connection from NightWatch. Using a different Google account
   requires adding that account separately.

For access beyond the testing list, complete Google's verification steps where
required and publish the OAuth app to **Production**. Do not work around the
block by changing NightWatch's scopes, sharing credentials, disabling PKCE, or
embedding a refresh token in the application.

## Local development

Create a gitignored `.env` beside `package.json` and fill the public
configuration names documented in `.env.example`:

```text
NIGHTWATCH_ENABLE_LOCAL_FILES=1
NIGHTWATCH_ENABLE_DRIVE=1
NIGHTWATCH_ENABLE_LIBRARY=1
NIGHTWATCH_GOOGLE_CLIENT_ID=...
NIGHTWATCH_GOOGLE_PICKER_API_KEY=...
NIGHTWATCH_GOOGLE_APP_ID=...
NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT=1
```

The optional desktop client secret should normally be omitted. A secret
embedded in a desktop application is not confidential and NightWatch's PKCE
flow does not depend on one.

Never add these values to renderer localStorage, Supabase tables, room events,
logs, screenshots, or support messages. OAuth refresh tokens are written only
after Electron `safeStorage` encrypts them beneath the current user's
application-data directory.

## GitHub release configuration

The release workflow must receive the same public configuration through
repository **Actions variables**, not committed source files:

- `NIGHTWATCH_ENABLE_LOCAL_FILES`
- `NIGHTWATCH_ENABLE_DRIVE`
- `NIGHTWATCH_ENABLE_LIBRARY`
- `NIGHTWATCH_GOOGLE_CLIENT_ID`
- `NIGHTWATCH_GOOGLE_PICKER_API_KEY`
- `NIGHTWATCH_GOOGLE_APP_ID`
- `NIGHTWATCH_ENABLE_YOUTUBE_ACCOUNT`
- `NIGHTWATCH_MAX_MEDIA_BYTES` (optional)

The build must inject only these public desktop configuration values. It must
never inject an OAuth refresh token, access token, authorization code, PKCE
verifier, service-account credential, or Supabase service-role key.

## Packaged acceptance

Before enabling Drive in a public release:

1. Install the packaged application on Windows.
2. Connect Drive through the system browser and verify the loopback callback
   returns to NightWatch.
3. Open Picker, select an authorized MP4/WebM file, play it, and seek through
   multiple byte ranges.
4. Restart NightWatch and confirm the encrypted connection can refresh.
5. Revoke the Google grant and confirm NightWatch reports expiry/reconnect
   without exposing provider details.
6. Disconnect and confirm Picker access, local credentials, and active Drive
   playback leases are removed.
7. Repeat with a second Google account. Each participant must independently
   have access to the same Drive file or select a local copy with the matching
   SHA-256 fingerprint.

Missing capability flags or Google public configuration return immediately as
`capability-disabled` or `not-configured`; they do not start an OAuth listener.
Once the system browser opens, NightWatch waits up to five minutes for Google
to return to its random `127.0.0.1` callback. A timeout is reported as the
retryable `auth-timeout` outcome and normally indicates that the browser,
firewall, VPN, or endpoint protection prevented the local callback.

Local/Drive room synchronization remains separately gated until the
`media:v1:*` room-event integration and two-client tests are complete. The
current Library surface is a private device preview and never relays media
bytes through NightWatch, Supabase, or another participant.
