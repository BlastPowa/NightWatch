# Browser account testing

The packaged Electron app completes Discord OAuth through the
`nightwatch://auth-callback` deep link. The browser build uses the same PKCE
flow with a same-origin callback so two browser profiles can be used for
multi-account testing.

## Supabase redirect URLs

In Supabase Dashboard → Authentication → URL Configuration, add every URL
used for local testing:

```text
http://localhost:5173/auth/callback
http://127.0.0.1:5173/auth/callback
nightwatch://auth-callback
```

Set **Site URL** to the production web origin, then add its exact callback
path, for example:

```text
https://nightwatch.example.com/auth/callback
```

For a Vercel deployment, add the production URL (and any custom domain)
instead of relying on a temporary preview URL. Preview testing can use an
explicit preview callback URL, but it must also be added to the allow-list.
Keep the existing Supabase provider callback URL in Discord's OAuth
application; the browser callback above is the final redirect back into
NightWatch, not a replacement for the provider callback.

## Testing two accounts

1. Start the browser build with the normal `.env` Supabase values, or deploy
   the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel build
   variables.
2. Open NightWatch in two separate browser profiles or one normal window and
   one private window.
3. Use **Settings → Account → Connect Discord** in each profile.
4. After the callback returns, the Account chip should say **NightWatch
   account**, not only **Discord connected**.
5. Create/join the same room and test room chat, reactions, People, friend
   requests, and ScreenWatch readiness.

Local/Drive Movie Watch remains Electron-only because file paths, Drive tokens,
and playback leases are held by the secure desktop media bridge. Browser
accounts can still test YouTube rooms and social features.
