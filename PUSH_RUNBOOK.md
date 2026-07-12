# Push Runbook — Phase 20C

Everything below is ready to go. **No database work remains** — `0011`, `0012`, and the acceptance test all ran successfully.

## State as of now

- `origin/main` already contains **all of Phase 20B** (migrations `0006`–`0010`, social services, realtime). It is merged.
- `backend/phase-20c-creator` is **one commit ahead of `origin/main`** — Phase 20C.
- Local `main` is 13 commits behind `origin/main`. Harmless, but sync it so you are not reviewing a stale tree.
- Working tree is clean. Typecheck and the full build (renderer + Electron + Discord Activity) pass.

## The push

```bash
# 1. Push the branch (GitHub auth will prompt on first push)
git push -u origin backend/phase-20c-creator

# 2. Sync your local main so it is not 13 behind
git checkout main
git pull

# 3. Back to the branch
git checkout backend/phase-20c-creator
```

Then open the PR against `main` from the GitHub UI — GitHub will offer a "Compare & pull request" button for the branch.

Suggested PR title:

```
Phase 20C — creator clubs, bounties, and moderation
```

Suggested PR body:

```
Clubs (owner/moderator/member), bounties as an audited status machine,
submissions, voting, a moderation queue, an append-only audit log, and
notifications. capabilities.creatorClubs now probes list_my_clubs.

Database: migrations 0011 and 0012 are already applied to the project, and
supabase/tests/phase20c_rls_test.sql passes against it.

Scope boundary per the handoff: no payments, cash rewards, YouTube account
scopes, downloads, subscriptions, or channel administration. Enforced
structurally — there is no amount/currency/payout column in the schema, and
the test asserts none exists.

See PHASE_20C_BACKEND_STATUS.md.
```

## One thing to verify before you merge

`0010_social_realtime.sql` is merged **in code**, but I never confirmed it was **applied to the database**. If it was not, every realtime subscription connects and then silently receives nothing — no error anywhere, which is the worst failure mode. Check in the SQL Editor:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('messages', 'friend_requests');
```

Two rows = applied. Fewer = run `supabase/migrations/0010_social_realtime.sql`.

## After the merge

Phase 20 (B and C) is done on the backend. What remains, in the order I would take it:

1. **Notification emitters.** The `notifications` table has readers but no writer — nothing emits "your submission was accepted" or "X sent you a friend request". Small, and it is what makes clubs feel alive rather than inert.
2. **System messages.** `messages.kind = 'system'` exists but nothing writes join/leave/rename notices.
3. **Club discovery.** Create/join-by-id/list-mine only; no public directory. Deliberately deferred, since a directory needs its own moderation story.

The frontend lane has `frontend/phase-20b-profile-social` in flight against this backend. `PHASE_20B_BACKEND_STATUS.md` and `PHASE_20C_BACKEND_STATUS.md` on `main` are the contracts they build against.
